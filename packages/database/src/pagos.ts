import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { aCentavos, importe } from "@nailnet/domain/catalogo";
import { hashToken } from "@nailnet/domain/credenciales";
import { asignarEn } from "@nailnet/domain/disponibilidad";
import { estadoPagoMercadoPago } from "@nailnet/domain/mercadopago";
import type { Llavero } from "@nailnet/domain/secretos";
import type { Database } from "./client.ts";
import { DatosInvalidos } from "./access.ts";
import { tokenMercadoPago, type RenovadorTokens } from "./configuracion.ts";
import { ConfiguracionIncompleta, cargarConsulta, type Pedido } from "./disponibilidad.ts";
import { ErrorPermanente, encolarJob } from "./jobs.ts";
import { LimiteExcedido, tokenConFormato } from "./publico.ts";
import { bloquearAgenda, conReintento, registrarEvento, type Tx } from "./reservas.ts";

/**
 * Seña online con Mercado Pago Checkout Pro (R04). Ver docs/23-pagos-mercadopago.md.
 *
 * - El portal pide una preferencia y redirige a Mercado Pago. El retorno al portal no confirma nada.
 * - Mercado Pago notifica al webhook; la notificación solo encola un trabajo.
 * - El worker consulta el pago a la API con las credenciales de la sede y lo aplica: valida cuenta,
 *   moneda y monto, y confirma la reserva con una transición condicional bajo lock.
 * - Pago tardío (retención vencida): se confirma si el horario sigue libre; si no, queda A_DEVOLVER.
 */

type Ambiente = "PRUEBA" | "PRODUCCION";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pago de Mercado Pago ya normalizado (lo arma @nailnet/integrations/mercadopago). */
export type PagoExterno = {
  id: string; status: string; statusDetail: string | null; monto: string; moneda: string;
  referenciaExterna: string | null; cobradorId: string | null; aprobadoEn: Date | null;
};
/** Lo que este módulo necesita de Mercado Pago. Se inyecta: las pruebas usan una versión falsa. */
export type PasarelaMercadoPago = {
  crearPreferencia(accessToken: string, p: { claveIdempotencia: string; titulo: string; monto: string; referenciaExterna: string; urlNotificacion: string | null; urlRetorno: string; expiraEn: Date; ahora: Date }, ambiente: Ambiente): Promise<{ id: string; url: string }>;
  obtenerPago(accessToken: string, id: string): Promise<PagoExterno>;
  /** Renovación de los tokens OAuth de la sede. Sin ella se usa el token guardado tal cual. */
  renovarTokens?: RenovadorTokens;
};

/** Staging y local cobran con credenciales de prueba; solo producción usa las reales. */
export const ambientePagos = (): Ambiente => (process.env.NAILNET_AMBIENTE === "produccion" ? "PRODUCCION" : "PRUEBA");

async function reservaDelToken(db: Database, token: string | null, ahora: Date) {
  if (!tokenConFormato(token)) throw new AccesoDenegado();
  const t = await db.tokenReserva.findFirst({ where: { tokenHash: hashToken(token), revocadoEn: null, expiraEn: { gt: ahora } }, select: { reservaId: true } });
  if (!t) throw new AccesoDenegado();
  return t.reservaId;
}

const sumarSenas = (items: { sena: { toFixed(n: number): string } | null }[]) => items.reduce((s, i) => s + (aCentavos(i.sena?.toFixed(2) ?? "0") ?? 0n), 0n);

/**
 * Link de pago de la seña para el invitado. Reutiliza la preferencia de la retención vigente: varios
 * clics no crean varias. Si la creación en Mercado Pago falla, la fila queda sin URL y el próximo
 * intento reusa su id como clave de idempotencia (Mercado Pago devuelve la misma preferencia).
 */
export async function iniciarPagoPublico(db: Database, pasarela: PasarelaMercadoPago, entrada: { token: string | null; urlApi: string; urlPortal: string }, ahora = new Date(), llavero?: Llavero): Promise<{ url: string }> {
  const reservaId = await reservaDelToken(db, entrada.token, ahora);
  const r = await db.reserva.findUniqueOrThrow({ where: { id: reservaId }, include: { sede: { select: { nombre: true } }, items: { orderBy: { posicion: "asc" }, include: { servicio: { select: { nombre: true } } } } } });
  if (r.estado !== "PENDIENTE_PAGO" || !r.expiraEn || r.expiraEn <= ahora) throw new DatosInvalidos("Esta reserva ya no está pendiente de pago");
  const monto = sumarSenas(r.items);
  if (monto <= 0n) throw new DatosInvalidos("Esta reserva no tiene seña para pagar");
  const ambiente = ambientePagos();
  const cuenta = await tokenMercadoPago(db, r.sedeId, ambiente, pasarela.renovarTokens ?? null, ahora, llavero);
  if (!cuenta) throw new DatosInvalidos("El pago online todavía no está habilitado en esta sede. Comunicate con la sede para confirmar el turno.");

  const expiraEn = r.expiraEn;
  const checkout = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${reservaId}`}, 0))) AS l`;
    return await tx.checkoutPago.findFirst({ where: { reservaId, ambiente, expiraEn }, orderBy: { createdAt: "desc" } })
      ?? await tx.checkoutPago.create({ data: { organizacionId: r.organizacionId, sedeId: r.sedeId, reservaId, proveedor: "MERCADO_PAGO", ambiente, monto: importe(monto), expiraEn } });
  });
  if (checkout.url) return { url: checkout.url };

  // Mercado Pago exige HTTPS para notificar; en local no hay webhook y la confirmación llega por el retorno.
  const urlNotificacion = entrada.urlApi.startsWith("https://") ? `${entrada.urlApi}/api/webhooks/mercadopago/${r.sedeId}` : null;
  const preferencia = await pasarela.crearPreferencia(cuenta.accessToken, {
    claveIdempotencia: checkout.id, referenciaExterna: checkout.id, monto: importe(monto),
    titulo: `Seña · ${r.items.map(i => i.servicio.nombre).join(" + ")} · ${r.sede.nombre}`,
    urlNotificacion, urlRetorno: `${entrada.urlPortal}/?pago=retorno`, expiraEn, ahora,
  }, ambiente);
  await db.checkoutPago.update({ where: { id: checkout.id }, data: { preferenciaId: preferencia.id, url: preferencia.url } });
  return { url: preferencia.url };
}

export const TIPO_JOB_PAGO = "pagos.mercadopago";
export type PayloadPago = { sedeId: string; ambiente: Ambiente; pagoId: string };

/**
 * Notificación de Mercado Pago (firma ya verificada): encola la consulta del pago. Responder rápido es
 * parte del contrato del webhook; el trabajo reintenta solo si la API no responde. La clave deduplica
 * reenvíos de la misma notificación.
 */
export async function encolarConsultaPago(db: Database, datos: PayloadPago & { origen: string }) {
  if (!UUID.test(datos.sedeId) || !/^\d{1,30}$/.test(datos.pagoId)) throw new DatosInvalidos("Notificación inválida");
  const sede = await db.sede.findUnique({ where: { id: datos.sedeId }, select: { organizacionId: true } });
  if (!sede) throw new AccesoDenegado();
  const clave = `mp:${datos.ambiente}:${datos.pagoId}:${datos.origen}`.slice(0, 200);
  const job = await encolarJob(db, {
    tipo: TIPO_JOB_PAGO, clave,
    payload: { sedeId: datos.sedeId, ambiente: datos.ambiente, pagoId: datos.pagoId }, organizacionId: sede.organizacionId,
  });
  // Un reenvío de la misma notificación rearma una consulta que ya había fallado (p. ej. credenciales
  // corregidas después): la deduplicación no debe dejar un pago sin aplicar para siempre.
  if (!job.creado) await db.job.updateMany({ where: { id: job.id, estado: "FALLIDO" }, data: { estado: "PENDIENTE", intentos: 0, proximoIntento: new Date(), ultimoError: null } });
  return job;
}

/** Retornos del portal por reserva: alcanza para reintentos legítimos y evita usar la cola (y la cuota de la API de la sede) como canal de abuso. */
const RETORNOS_POR_RESERVA = 5;

/**
 * El invitado volvió de Mercado Pago con un id de pago: se encola la misma consulta que dispara el
 * webhook. No se confía en el estado del retorno; solo acelera la confirmación si la notificación se
 * demora (y es la única vía en local, sin webhook).
 */
export async function verificarPagoPublico(db: Database, token: string | null, pagoId: string, ahora = new Date()) {
  const reservaId = await reservaDelToken(db, token, ahora);
  if (!/^\d{1,30}$/.test(pagoId)) throw new DatosInvalidos("Id de pago inválido");
  const r = await db.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { sedeId: true } });
  const previos = await db.job.count({ where: { tipo: TIPO_JOB_PAGO, clave: { endsWith: `:retorno:${reservaId}` } } });
  const yaPedido = await db.job.count({ where: { clave: `mp:${ambientePagos()}:${pagoId}:retorno:${reservaId}` } });
  if (!yaPedido && previos >= RETORNOS_POR_RESERVA) throw new LimiteExcedido("Ya estamos verificando tus pagos. Esperá unos minutos.");
  await encolarConsultaPago(db, { sedeId: r.sedeId, ambiente: ambientePagos(), pagoId, origen: `retorno:${reservaId}` });
}

/** Manejador del trabajo: consulta el pago con las credenciales de la sede y lo aplica. */
export async function procesarPagoMercadoPago(db: Database, pasarela: PasarelaMercadoPago, payload: unknown, ahora = new Date(), llavero?: Llavero) {
  const p = payload as Partial<PayloadPago> | null;
  if (!p || typeof p.sedeId !== "string" || !UUID.test(p.sedeId) || (p.ambiente !== "PRUEBA" && p.ambiente !== "PRODUCCION") || typeof p.pagoId !== "string") throw new ErrorPermanente("Payload de pago inválido");
  const cuenta = await tokenMercadoPago(db, p.sedeId, p.ambiente, pasarela.renovarTokens ?? null, ahora, llavero);
  if (!cuenta) throw new ErrorPermanente("La sede no tiene una cuenta de Mercado Pago vinculada para este ambiente");
  const pago = await pasarela.obtenerPago(cuenta.accessToken, p.pagoId);
  return aplicarPago(db, { sedeId: p.sedeId, ambiente: p.ambiente, cuentaId: cuenta.cuentaId }, pago, ahora);
}

type EstadoGuardado = "EN_PROCESO" | "APROBADO" | "RECHAZADO" | "A_DEVOLVER" | "REEMBOLSADO";
export type ResultadoPago = { resultado: EstadoGuardado | "AJENO" | "SIN_CAMBIOS"; reservaConfirmada?: "EN_TERMINO" | "TARDIO"; motivo?: string };

/**
 * Aplica un pago consultado a la API. Idempotente: procesar el mismo pago otra vez no cambia nada, y
 * un pago aprobado o a devolver solo puede pasar a REEMBOLSADO. Un pago cuya referencia no es un
 * checkout de esta sede (otra venta de la misma cuenta) se ignora.
 */
export async function aplicarPago(db: Database, cuenta: { sedeId: string; ambiente: Ambiente; cuentaId: string | null }, pago: PagoExterno, ahora = new Date()): Promise<ResultadoPago> {
  const ref = pago.referenciaExterna;
  if (!ref || !UUID.test(ref)) return { resultado: "AJENO" };
  const checkout = await db.checkoutPago.findFirst({ where: { id: ref, sedeId: cuenta.sedeId, ambiente: cuenta.ambiente } });
  if (!checkout) return { resultado: "AJENO" };
  const reserva = await db.reserva.findUniqueOrThrow({ where: { id: checkout.reservaId }, include: { sede: { select: { timezone: true } }, items: { orderBy: { posicion: "asc" } } } });
  const estadoExterno = estadoPagoMercadoPago(pago.status);

  // Datos que no dependen del estado de la reserva: si no cierran, el pago no confirma nada.
  const problemas: string[] = [];
  if (!cuenta.cuentaId || pago.cobradorId !== cuenta.cuentaId) problemas.push("la cuenta receptora no es la de la sede");
  if (pago.moneda !== "ARS") problemas.push(`moneda ${pago.moneda}`);
  if (aCentavos(pago.monto) !== aCentavos(checkout.monto.toFixed(2))) problemas.push(`monto ${pago.monto}, se esperaba ${checkout.monto.toFixed(2)}`);

  // Un pago aprobado sobre una retención vencida necesita revalidar el horario con locks de agenda.
  // Primera pasada sin locks, como en tomarTurno: solo para saber qué filas bloquear.
  const pedido = pedidoDe(reserva);
  // Solo un pago aprobado puede confirmar: los demás estados no compiten con reservas por la agenda.
  let bloqueos = { profesionales: [] as string[], recursos: [] as string[] };
  if (estadoExterno === "APROBADO") {
    bloqueos.profesionales = [...new Set(reserva.items.map(i => i.profesionalId))].sort();
    const previa = await cargarConsulta(db, reserva.organizacionId, pedido, ahora).catch(e => { if (e instanceof DatosInvalidos || e instanceof ConfiguracionIncompleta) return null; throw e; });
    if (previa) bloqueos = { profesionales: [...new Set([...bloqueos.profesionales, ...previa.consulta.items.flatMap(i => i.candidatos)])].sort(), recursos: [...new Set(previa.consulta.recursos.map(r => r.id))].sort() };
  }

  return conReintento(() => db.$transaction(async (tx): Promise<ResultadoPago> => {
    await bloquearAgenda(tx, bloqueos.profesionales, bloqueos.recursos);
    // La fila de la reserva serializa con el worker que vence retenciones y con otra notificación del mismo pago.
    await tx.$queryRaw`SELECT id FROM "Reserva" WHERE id = ${reserva.id}::uuid FOR UPDATE`;
    const actual = await tx.reserva.findUniqueOrThrow({ where: { id: reserva.id }, select: { estado: true, expiraEn: true } });
    const clave = { proveedor_ambiente_externoId: { proveedor: "MERCADO_PAGO" as const, ambiente: cuenta.ambiente, externoId: pago.id } };
    const existente = await tx.pago.findUnique({ where: clave });
    const guardar = (estado: EstadoGuardado, motivo: string | null) => {
      const aprobado = estado === "APROBADO" || estado === "A_DEVOLVER";
      const datos = { estado, estadoExterno: pago.status, detalleExterno: pago.statusDetail, monto: pago.monto, moneda: pago.moneda.slice(0, 10), motivo, ...(aprobado ? { aprobadoEn: existente?.aprobadoEn ?? pago.aprobadoEn ?? ahora } : {}) };
      return tx.pago.upsert({
        where: clave,
        create: { organizacionId: reserva.organizacionId, sedeId: reserva.sedeId, reservaId: reserva.id, checkoutId: checkout.id, proveedor: "MERCADO_PAGO", ambiente: cuenta.ambiente, externoId: pago.id, ...datos },
        update: datos,
      });
    };

    if (estadoExterno === "REEMBOLSADO") {
      // La devolución o el contracargo no tocan el turno: lo resuelve una persona (M01).
      if (existente?.estado === "REEMBOLSADO") return { resultado: "SIN_CAMBIOS" };
      await guardar("REEMBOLSADO", existente?.motivo ?? null);
      return { resultado: "REEMBOLSADO" };
    }
    if (existente && ["APROBADO", "A_DEVOLVER", "REEMBOLSADO"].includes(existente.estado)) return { resultado: "SIN_CAMBIOS" };
    if (estadoExterno !== "APROBADO") {
      if (existente?.estado === estadoExterno && existente.estadoExterno === pago.status) return { resultado: "SIN_CAMBIOS" };
      await guardar(estadoExterno, null);
      return { resultado: estadoExterno };
    }

    // Aprobado: ¿hay un turno para confirmar con este dinero?
    const aDevolver = async (motivo: string): Promise<ResultadoPago> => { await guardar("A_DEVOLVER", motivo); return { resultado: "A_DEVOLVER", motivo }; };
    if (problemas.length) return aDevolver(problemas.join("; "));
    if (await tx.pago.count({ where: { reservaId: reserva.id, estado: "APROBADO" } })) return aDevolver("la reserva ya tenía un pago aprobado");
    if (actual.estado === "CANCELADA") return aDevolver("la reserva estaba cancelada");
    if (["CONFIRMADA", "ATENDIDA", "AUSENTE"].includes(actual.estado)) {
      // Turno ya firme (p. ej. confirmado por recepción): la seña se registra contra él.
      await guardar("APROBADO", null);
      return { resultado: "APROBADO" };
    }

    const enTermino = (actual.estado === "PENDIENTE_PAGO" || actual.estado === "PAGO_EN_REVISION") && actual.expiraEn !== null && actual.expiraEn > ahora;
    if (!enTermino) {
      // Pago tardío: mismas reglas que una reserva de recepción para el mismo horario y profesionales.
      const libre = await turnoLibre(tx, reserva, pedido, ahora, { profesionales: new Set(bloqueos.profesionales), recursos: new Set(bloqueos.recursos) });
      if (!libre) return aDevolver("el pago llegó con la retención vencida y el horario ya no está disponible");
      // Los recursos pudieron cambiar mientras estuvo vencida: se toman los que asigna el motor ahora.
      await tx.reservaItemRecurso.deleteMany({ where: { itemId: { in: reserva.items.map(i => i.id) } } });
      for (const [n, it] of libre.entries()) {
        const item = reserva.items[n]!;
        if (it.recursoIds.length) await tx.reservaItemRecurso.createMany({ data: it.recursoIds.map(recursoId => ({ organizacionId: reserva.organizacionId, itemId: item.id, recursoId, ocupaDesde: item.ocupaDesde, ocupaHasta: item.ocupaHasta })) });
      }
    }
    const { count } = await tx.reserva.updateMany({ where: { id: reserva.id, estado: actual.estado }, data: { estado: "CONFIRMADA", expiraEn: null } });
    if (count !== 1) throw new Error("La reserva cambió bajo lock");
    const guardado = await guardar("APROBADO", null);
    await registrarEvento(tx, reserva.organizacionId, reserva.id, "CONFIRMADA", actual.estado as "PENDIENTE_PAGO", "CONFIRMADA", null, { origen: "mercadopago", pagoId: guardado.id, tardio: !enTermino });
    return { resultado: "APROBADO", reservaConfirmada: enTermino ? "EN_TERMINO" : "TARDIO" };
  }, { maxWait: 10_000, timeout: 20_000 }));
}

type ReservaConItems = { organizacionId: string; sedeId: string; sede: { timezone: string }; items: { servicioId: string; profesionalId: string; inicio: Date; fin: Date; ocupaDesde: Date; ocupaHasta: Date }[] };
const pedidoDe = (r: ReservaConItems): Pedido => ({ sedeId: r.sedeId, fecha: aLocal(r.items[0]!.inicio, r.sede.timezone).fecha, canal: "RECEPCION", items: r.items.map(i => ({ servicioId: i.servicioId, profesionalId: i.profesionalId })) });

/**
 * ¿El horario de una reserva vencida sigue libre? Usa el motor (bajo los locks ya tomados), que ignora
 * las retenciones vencidas, incluida esta. Exige los mismos profesionales e intervalos: si el servicio
 * cambió de duración o el turno ya empezó, no hay confirmación automática.
 */
async function turnoLibre(tx: Tx, r: ReservaConItems, pedido: Pedido, ahora: Date, bloqueados: { profesionales: ReadonlySet<string>; recursos: ReadonlySet<string> }) {
  let consulta;
  try { consulta = (await cargarConsulta(tx, r.organizacionId, pedido, ahora, bloqueados)).consulta; }
  catch (e) { if (e instanceof DatosInvalidos || e instanceof ConfiguracionIncompleta || e instanceof AccesoDenegado) return null; throw e; }
  const turno = asignarEn(consulta, r.items[0]!.inicio.getTime());
  if (!turno || turno.items.length !== r.items.length) return null;
  const igual = turno.items.every((it, n) => {
    const o = r.items[n]!;
    return it.profesionalId === o.profesionalId && it.inicio === o.inicio.getTime() && it.fin === o.fin.getTime() && it.ocupaDesde === o.ocupaDesde.getTime() && it.ocupaHasta === o.ocupaHasta.getTime();
  });
  return igual ? turno.items : null;
}
