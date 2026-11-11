import { AccesoDenegado } from "@nailnet/domain";
import { aHora, aLocal, aUtc, validarFecha } from "@nailnet/domain/agenda";
import { aCentavos } from "@nailnet/domain/catalogo";
import { asignarEn } from "@nailnet/domain/disponibilidad";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, auditar, exigirIds, sedesConPermiso } from "./access.ts";
import { configuracionEfectiva } from "./configuracion.ts";
import { ConfiguracionIncompleta, TURNO_PISABLE, cargarConsulta, reservaActiva, type OpcionesConsulta, type Pedido } from "./disponibilidad.ts";
import { encolarEmailReserva } from "./emails.ts";

type Tx = Prisma.TransactionClient;
type Estado = "PENDIENTE_PAGO" | "PAGO_EN_REVISION" | "CONFIRMADA" | "ATENDIDA" | "AUSENTE" | "CANCELADA" | "EXPIRADA";

/** El horario pedido ya no está libre (lo tomó otra persona o cambió la agenda). HTTP 409. */
export class TurnoNoDisponible extends Error {
  constructor() { super("Ese horario ya no está disponible. Elegí otro."); this.name = "TurnoNoDisponible"; }
}

const ordenar = (ids: Iterable<string>) => [...new Set(ids)].sort();

/**
 * Protocolo de exclusión (doc 16): bloquear FOR UPDATE las filas de los profesionales candidatos y
 * de los recursos de los tipos requeridos, siempre ordenados por ID (primero profesionales, luego
 * recursos). Jornadas, ausencias y otros turnos toman el mismo lock de fila del profesional.
 */
export type { Tx };
export async function bloquearAgenda(tx: Tx, profesionales: string[], recursos: string[]) {
  if (profesionales.length) await tx.$queryRaw`SELECT id FROM "Profesional" WHERE id IN (${Prisma.join(profesionales.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  if (recursos.length) await tx.$queryRaw`SELECT id FROM "Recurso" WHERE id IN (${Prisma.join(recursos.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}

const esDeadlock = (e: unknown) => /40P01|deadlock/i.test(String((e as { message?: string })?.message ?? "") + JSON.stringify((e as { meta?: unknown })?.meta ?? ""));
export async function conReintento<T>(fn: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try { return await fn(); }
    catch (e) { if (intento < 3 && esDeadlock(e)) continue; throw e; }
  }
}

export async function registrarEvento(tx: Tx, organizacionId: string, reservaId: string, tipo: "CREADA" | "CONFIRMADA" | "EXPIRADA" | "CANCELADA" | "REPROGRAMADA" | "ATENDIDA" | "AUSENTE" | "SERVICIO_SUMADO", estadoAnterior: Estado | null, estadoNuevo: Estado, actorId: string | null, detalle?: Prisma.InputJsonValue) {
  await tx.reservaEvento.create({ data: { organizacionId, reservaId, tipo, estadoAnterior, estadoNuevo, actorId, detalle } });
  // P03: confirmación, cancelación y reprogramación avisan al cliente por email, en esta misma transacción (outbox).
  await encolarEmailReserva(tx, { organizacionId, reservaId, tipo, estadoNuevo, detalle });
}

/** Retenciones vencidas de estos profesionales pasan a EXPIRADA. El motor ya las ignora; esto mantiene el estado coherente. */
export async function expirarVencidas(tx: Tx, organizacionId: string, profesionales: string[], ahora: Date) {
  const vencidas = await tx.reserva.findMany({ where: { organizacionId, estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { lte: ahora }, items: { some: { profesionalId: { in: profesionales } } } }, select: { id: true, estado: true } });
  for (const v of vencidas) {
    const { count } = await tx.reserva.updateMany({ where: { id: v.id, estado: v.estado }, data: { estado: "EXPIRADA" } });
    if (count) await registrarEvento(tx, organizacionId, v.id, "EXPIRADA", v.estado, "EXPIRADA", null);
  }
}

export type TurnoTomado = { reservaId: string; estado: Estado; expiraEn: Date | null; items: { servicioId: string; profesionalId: string; inicio: Date; fin: Date; recursoIds: string[]; precio: string; sena: string | null }[] };

/**
 * Toma un turno (uno o varios ítems encadenados), todo o nada, con exclusión garantizada.
 * Estado inicial según canal y política (D6): online con seña → PENDIENTE_PAGO por la retención
 * configurada (D4, 15 min por defecto); online sin seña → CONFIRMADA; recepción → CONFIRMADA salvo
 * que la sede exija seña. Recepción requiere cliente, que queda vinculado a la sede.
 */
/**
 * `antes` corre dentro de la transacción, después de los locks y antes de revalidar: lo usa el portal
 * para crear el cliente invitado y aplicar límites por contacto de forma atómica. Puede devolver el
 * cliente a asignar.
 */
export type AntesDeTomar = (tx: Tx) => Promise<{ clienteId?: string } | void>;
/** `despues` corre en la misma transacción con el turno ya escrito: si falla, el turno no se crea. */
export type DespuesDeTomar = (tx: Tx, turno: TurnoTomado) => Promise<void>;
/**
 * `consulta`: opciones del motor (doc 31, etapa 3a: `pisar` para «sentar igual»). Con `pisar`, el evento de
 * creación guarda en `pisadas` los turnos sin empezar que el nuevo pisa. Solo la pasa `sentarEspera`.
 */
export async function tomarTurno(db: Database, actorId: string | null, organizacionId: string, pedido: Pedido & { inicio: Date; clienteId?: string | null; clienteProvisional?: string | null; notas?: string | null; sinTurnoPrevio?: boolean; esperaId?: string | null }, ahora = new Date(), opciones: { antes?: AntesDeTomar; despues?: DespuesDeTomar; evento?: Record<string, Prisma.InputJsonValue>; consulta?: OpcionesConsulta } = {}): Promise<TurnoTomado> {
  if (actorId) {
    exigirIds(pedido.sedeId);
    const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
    if (!ids.has(pedido.sedeId)) throw new AccesoDenegado();
  } else if (pedido.canal !== "ONLINE") throw new AccesoDenegado();
  exigirIds(pedido.clienteId, pedido.esperaId);
  // Doc 31, etapa 2: solo recepción sienta a una clienta sin ficha, con su nombre (lo usa `sentarEspera`).
  // Quien no lo pide (la reserva manual, «Atender ahora») sigue necesitando el cliente.
  const provisional = pedido.clienteProvisional?.trim().slice(0, 80) || null;
  if (provisional && pedido.canal !== "RECEPCION") throw new AccesoDenegado();
  if (pedido.canal === "RECEPCION" && !pedido.clienteId && !provisional) throw new DatosInvalidos("Elegí el cliente del turno");
  if (Number.isNaN(pedido.inicio.getTime())) throw new DatosInvalidos("Horario inválido");
  const notas = pedido.notas?.trim().slice(0, 1000) || null;

  // Primera pasada sin locks: solo para saber qué filas bloquear.
  const previa = await cargarConsulta(db, organizacionId, pedido, ahora, undefined, opciones.consulta);
  const profesionales = ordenar(previa.consulta.items.flatMap(i => i.candidatos));
  const recursos = ordenar(previa.consulta.recursos.map(r => r.id));

  return conReintento(() => db.$transaction(async tx => {
    await bloquearAgenda(tx, profesionales, recursos);
    const config = await configuracionEfectiva(tx, organizacionId, pedido.sedeId);
    const clienteId = (await opciones.antes?.(tx))?.clienteId ?? pedido.clienteId ?? null;
    if (clienteId && !await tx.cliente.count({ where: { id: clienteId, organizacionId } })) throw new AccesoDenegado();
    await expirarVencidas(tx, organizacionId, profesionales, ahora);

    // Revalidación bajo lock con exactamente las mismas reglas que la consulta pública.
    const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, ahora, { profesionales: new Set(profesionales), recursos: new Set(recursos) }, opciones.consulta);
    const turno = asignarEn(consulta, pedido.inicio.getTime());
    if (!turno) throw new TurnoNoDisponible();
    const pisadas = opciones.consulta?.pisar ? await reservasPisadas(tx, turno.items, ahora) : [];

    const senaTotal = turno.items.reduce((t, i) => t + (aCentavos(efectivos.get(i.servicioId)!.sena ?? "0") ?? 0n), 0n);
    // Un cliente atendido en el momento (sin turno previo) no deja seña: ya está en la sede.
    const exigeSena = senaTotal > 0n && !pedido.sinTurnoPrevio && (pedido.canal === "ONLINE" || config.recepcionExigeSena);
    const estado: Estado = exigeSena ? "PENDIENTE_PAGO" : "CONFIRMADA";
    const expiraEn = exigeSena ? new Date(ahora.getTime() + config.retencionMinutos.valor! * 60_000) : null;

    const sinTurnoPrevio = !!pedido.sinTurnoPrevio;
    // Sin turno previo la clienta ya está en el local: la atención empieza con el turno (doc 29).
    const r = await escribirTurno(tx, organizacionId, { sedeId: pedido.sedeId, clienteId, clienteProvisional: clienteId ? null : provisional, canal: pedido.canal, estado, expiraEn, notas, creadoPor: actorId, sinTurnoPrevio, iniciadaEn: sinTurnoPrevio ? pedido.inicio : null, esperaId: pedido.esperaId ?? null }, turno, efectivos);
    await registrarEvento(tx, organizacionId, r.reservaId, "CREADA", null, estado, actorId, { canal: pedido.canal, exigeSena, ...(sinTurnoPrevio ? { sinTurnoPrevio } : {}), ...opciones.evento, ...(pisadas.length ? { pisadas } : {}) });
    await opciones.despues?.(tx, r);
    return r;
  }, { maxWait: 10_000, timeout: 20_000 }));
}

/**
 * «Sentar igual» (doc 31, etapa 3a): los turnos vigentes sin empezar que una ocupación nueva pisa, de las
 * mismas profesionales. Corre bajo los locks de esas profesionales, después de asignar. Quedan en el evento
 * para que recepción sepa a quién avisar o reubicar.
 */
async function reservasPisadas(tx: Tx, items: { profesionalId: string; ocupaDesde: number | Date; ocupaHasta: number | Date }[], ahora: Date, excepto?: string) {
  const ids = new Set<string>();
  for (const it of items) {
    const pisados = await tx.reservaItem.findMany({
      where: { profesionalId: it.profesionalId, ocupaDesde: { lt: new Date(it.ocupaHasta) }, ocupaHasta: { gt: new Date(it.ocupaDesde) }, reserva: { AND: [reservaActiva(ahora), TURNO_PISABLE, ...(excepto ? [{ id: { not: excepto } }] : [])] } },
      select: { reservaId: true },
    });
    for (const p of pisados) ids.add(p.reservaId);
  }
  return [...ids].sort();
}

/** La profesional elegida no está libre ahora: otro turno, un bloqueo o fuera de su horario. */
export const PROFESIONAL_OCUPADA = "La profesional no está libre ahora (tiene otro turno o un bloqueo, o está fuera de su horario). Elegí otra profesional o reservá un turno para más tarde.";

/**
 * O01 · «Atender ahora» (confirmado por Sicurella el 2026-10-14): un cliente llega sin turno, recepción
 * elige profesional y servicios, y se crea un turno de recepción que arranca en este minuto y ocupa la
 * agenda de la profesional (el portal deja de ofrecer ese horario). Es el mismo camino que la reserva
 * manual (R01): mismos locks y el mismo motor, sin grilla porque el inicio es «ahora». Queda confirmado,
 * sin seña y marcado `sinTurnoPrevio` para reportes. No manda email de confirmación.
 */
export async function atenderAhora(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; clienteId: string; items: { servicioId: string; profesionalId: string; conAnterior?: boolean }[]; notas?: string | null; esperaId?: string | null }, ahora = new Date()) {
  if (!datos.items.length) throw new DatosInvalidos("Elegí al menos un servicio");
  if (datos.items.some(i => !i.profesionalId)) throw new DatosInvalidos("Elegí la profesional de cada servicio");
  if (!datos.clienteId) throw new DatosInvalidos("Elegí o creá el cliente");
  exigirIds(datos.sedeId, datos.clienteId, datos.esperaId, ...datos.items.flatMap(i => [i.servicioId, i.profesionalId]));
  // Etapa 3 (doc 29): si la clienta venía de la lista de espera, sale de la lista en la misma transacción
  // del turno. Si otra recepcionista ya la atendió (o se fue), el turno no se crea.
  const despues: DespuesDeTomar | undefined = datos.esperaId ? async (tx, turno) => {
    const { count } = await tx.esperaRecepcion.updateMany({
      where: { id: datos.esperaId!, organizacionId, sedeId: datos.sedeId, estado: "ESPERANDO" },
      data: { estado: "ATENDIDA", reservaId: turno.reservaId, cerradaEn: ahora, cerradaPorId: actorId },
    });
    if (count !== 1) throw new DatosInvalidos("Esa clienta ya no está en la lista de espera (la atendió otra recepcionista o se fue)");
  } : undefined;
  const sede = await db.sede.findFirst({ where: { id: datos.sedeId, organizacionId }, select: { timezone: true } });
  if (!sede) throw new AccesoDenegado();
  // Al minuto: el turno empieza ahora y el motor lo valida con «ahora» como límite inferior.
  const inicio = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
  try {
    return await tomarTurno(db, actorId, organizacionId, {
      sedeId: datos.sedeId, fecha: aLocal(inicio, sede.timezone).fecha, canal: "RECEPCION", clienteId: datos.clienteId, notas: datos.notas,
      items: datos.items.map((i, n) => ({ servicioId: i.servicioId, profesionalId: i.profesionalId, conAnterior: n > 0 && !!i.conAnterior })), inicio, sinTurnoPrevio: true,
      // Doc 31, etapa 3b: el turno apunta a la espera de la que salió (el cobro la encuentra por acá).
      esperaId: datos.esperaId || null,
    }, inicio, { despues });
  } catch (e) {
    if (e instanceof TurnoNoDisponible) throw new DatosInvalidos(PROFESIONAL_OCUPADA);
    if (e instanceof ConfiguracionIncompleta) throw new DatosInvalidos(`Falta definir en la sede: ${e.faltantes.join(", ")}`);
    throw e;
  }
}


type Asignado = NonNullable<ReturnType<typeof asignarEn>>;
type Efectivos = Awaited<ReturnType<typeof cargarConsulta>>["efectivos"];
/** Escribe reserva, ítems y recursos. `congelados` (por posición) conserva precio y seña de una reserva anterior. */
async function escribirTurno(tx: Tx, organizacionId: string, base: { sedeId: string; clienteId: string | null; clienteProvisional?: string | null; canal: "ONLINE" | "RECEPCION"; estado: Estado; expiraEn: Date | null; notas: string | null; creadoPor: string | null; reemplazaId?: string; sinTurnoPrevio?: boolean; iniciadaEn?: Date | null; llegoEn?: Date | null; esperaId?: string | null }, turno: Asignado, efectivos: Efectivos, congelados?: Map<number, { precio: string; sena: string | null }>): Promise<TurnoTomado> {
  const reserva = await tx.reserva.create({ data: { organizacionId, ...base }, select: { id: true } });
  if (base.clienteId) await tx.clienteSede.upsert({ where: { clienteId_sedeId: { clienteId: base.clienteId, sedeId: base.sedeId } }, create: { organizacionId, clienteId: base.clienteId, sedeId: base.sedeId }, update: {} });
  const items = await escribirItems(tx, organizacionId, reserva.id, turno.items, efectivos, 0, congelados);
  return { reservaId: reserva.id, estado: base.estado, expiraEn: base.expiraEn, items };
}

/** Ítems y recursos de un turno, desde la posición `desde` (sumar un servicio escribe después de los que ya tiene). */
async function escribirItems(tx: Tx, organizacionId: string, reservaId: string, asignados: Asignado["items"], efectivos: Efectivos, desde: number, congelados?: Map<number, { precio: string; sena: string | null }>) {
  const items: TurnoTomado["items"] = [];
  for (const [n, it] of asignados.entries()) {
    const posicion = desde + n;
    const e = efectivos.get(it.servicioId)!;
    const precio = congelados?.get(posicion)?.precio ?? e.precio!, sena = congelados ? congelados.get(posicion)?.sena ?? null : e.sena;
    const item = await tx.reservaItem.create({ data: {
      organizacionId, reservaId, posicion, servicioId: it.servicioId, profesionalId: it.profesionalId,
      inicio: new Date(it.inicio), fin: new Date(it.fin), ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta),
      // Snapshots: cambios posteriores de precio, duración o seña no alteran este turno.
      duracionMinutos: e.duracionMinutos, bufferAntesMinutos: e.bufferAntesMinutos, bufferDespuesMinutos: e.bufferDespuesMinutos, precio, sena,
    }, select: { id: true } });
    if (it.recursoIds.length) await tx.reservaItemRecurso.createMany({ data: it.recursoIds.map(recursoId => ({ organizacionId, itemId: item.id, recursoId, ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta) })) });
    items.push({ servicioId: it.servicioId, profesionalId: it.profesionalId, inicio: new Date(it.inicio), fin: new Date(it.fin), recursoIds: it.recursoIds, precio, sena });
  }
  return items;
}

/** Compatibilidad con C05: retener = tomar turno. */
export const retenerTurno = tomarTurno;

const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Agenda de la sede (día o semana). Muestra turnos firmes y pendientes vigentes; cancelados y
 * vencidos se ven si se pide `incluirCerrados`. Los datos del cliente se limitan a lo operativo.
 */
export async function agendaSede(db: Database, actorId: string, organizacionId: string, filtro: { sedeId: string; desde: string; dias: number; profesionalId?: string | null; incluirCerrados?: boolean }, ahora = new Date()) {
  exigirIds(filtro.sedeId, filtro.profesionalId);
  if (!validarFecha(filtro.desde) || ![1, 7].includes(filtro.dias)) throw new DatosInvalidos("Rango de fechas inválido");
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(filtro.sedeId)) throw new AccesoDenegado();
  const sede = await db.sede.findUniqueOrThrow({ where: { id: filtro.sedeId }, select: { timezone: true } });
  const desde = aUtc(filtro.desde, 0, sede.timezone), hasta = aUtc(sumarDias(filtro.desde, filtro.dias), 0, sede.timezone);
  const items = await db.reservaItem.findMany({
    where: {
      organizacionId, inicio: { gte: desde, lt: hasta }, reserva: { sedeId: filtro.sedeId, ...(filtro.incluirCerrados ? {} : reservaActiva(ahora)) },
      ...(filtro.profesionalId ? { profesionalId: filtro.profesionalId } : {}),
    },
    include: {
      reserva: { select: { id: true, estado: true, canal: true, sinTurnoPrevio: true, expiraEn: true, notas: true, clienteProvisional: true, cliente: { select: { id: true, nombre: true, apellido: true, telefono: true } } } },
      servicio: { select: { nombre: true } }, profesional: { select: { id: true, nombre: true, apellido: true } },
      recursos: { select: { recurso: { select: { nombre: true } } } },
    },
    orderBy: [{ inicio: "asc" }, { posicion: "asc" }],
  });
  return { timezone: sede.timezone, items: items.map(i => ({
    itemId: i.id, reservaId: i.reservaId, posicion: i.posicion, inicio: i.inicio, fin: i.fin,
    estado: i.reserva.estado, canal: i.reserva.canal, sinTurnoPrevio: i.reserva.sinTurnoPrevio, expiraEn: i.reserva.expiraEn, notas: i.reserva.notas,
    cliente: i.reserva.cliente, clienteProvisional: i.reserva.clienteProvisional, servicio: i.servicio.nombre, profesional: i.profesional, recursos: i.recursos.map(r => r.recurso.nombre),
    precio: i.precio.toFixed(2), sena: i.sena?.toFixed(2) ?? null,
  })) };
}

/**
 * Tarea periódica del worker (R02): pasa a EXPIRADA las retenciones vencidas aunque nadie vuelva a
 * reservar. El motor ya las ignora; esto libera el estado y deja el evento. La transición es
 * condicional (sigue pendiente y vencida), así que varias instancias del worker o una aprobación de
 * pago concurrente (R04, transición condicional inversa) nunca aplican dos cambios sobre la misma fila.
 */
export async function expirarRetenciones(db: Database, ahora = new Date(), limite = 200) {
  const vencidas = await db.reserva.findMany({
    where: { estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { lte: ahora } },
    select: { id: true, organizacionId: true, estado: true }, orderBy: { expiraEn: "asc" }, take: limite,
  });
  let expiradas = 0;
  for (const v of vencidas) {
    await db.$transaction(async tx => {
      const { count } = await tx.reserva.updateMany({ where: { id: v.id, estado: v.estado, expiraEn: { lte: ahora } }, data: { estado: "EXPIRADA" } });
      if (count) { expiradas++; await registrarEvento(tx, v.organizacionId, v.id, "EXPIRADA", v.estado, "EXPIRADA", null, { origen: "worker" }); }
    });
  }
  return { revisadas: vencidas.length, expiradas };
}

// ─── Operación del turno (R03) ────────────────────────────────────────────────

const PENDIENTES: Estado[] = ["PENDIENTE_PAGO", "PAGO_EN_REVISION"];
const ETIQUETA: Record<Estado, string> = { PENDIENTE_PAGO: "pendiente de seña", PAGO_EN_REVISION: "con pago en revisión", CONFIRMADA: "confirmado", ATENDIDA: "atendido", AUSENTE: "marcado ausente", CANCELADA: "cancelado", EXPIRADA: "vencido" };

/** Carga la reserva verificando que su sede esté en el alcance del actor, y bloquea sus profesionales. */
async function reservaParaOperar(tx: Tx, actorId: string, organizacionId: string, reservaId: string) {
  exigirIds(reservaId);
  const reserva = await tx.reserva.findFirst({ where: { id: reservaId, organizacionId }, include: { items: { include: { recursos: true }, orderBy: { posicion: "asc" } } } });
  if (!reserva) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(tx, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(reserva.sedeId)) throw new AccesoDenegado();
  await bloquearAgenda(tx, ordenar(reserva.items.map(i => i.profesionalId)), []);
  // Releer el estado después del lock: otra operación pudo cambiarlo mientras esperábamos.
  const actual = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { estado: true, expiraEn: true, iniciadaEn: true } });
  return { ...reserva, estado: actual.estado as Estado, expiraEn: actual.expiraEn, iniciadaEn: actual.iniciadaEn };
}

async function transicion(tx: Tx, organizacionId: string, reservaId: string, de: Estado, a: Estado, tipo: Parameters<typeof registrarEvento>[3], actorId: string, detalle?: Prisma.InputJsonValue) {
  const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: de }, data: { estado: a, ...(a === "CANCELADA" || a === "CONFIRMADA" ? { expiraEn: null } : {}) } });
  if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la agenda");
  await registrarEvento(tx, organizacionId, reservaId, tipo, de, a, actorId, detalle);
}

/**
 * Cancela y libera el horario en el acto. D5 (plazos y devoluciones) está pendiente: no hay reembolso
 * automático; si hubo seña cobrada, la devolución se gestiona manualmente (M01) y queda anotada.
 */
export async function cancelarReserva(db: Database, actorId: string, organizacionId: string, reservaId: string, motivo: string, ahora = new Date()) {
  const texto = motivo.trim().slice(0, 300);
  if (!texto) throw new DatosInvalidos("Indicá el motivo de la cancelación");
  await db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    const vigentePendiente = PENDIENTES.includes(r.estado) && r.expiraEn !== null && r.expiraEn > ahora;
    if (r.estado !== "CONFIRMADA" && !vigentePendiente) throw new DatosInvalidos(`No se puede cancelar un turno ${ETIQUETA[r.estado]}`);
    await transicion(tx, organizacionId, reservaId, r.estado, "CANCELADA", "CANCELADA", actorId, { motivo: texto, reembolso: "sin reembolso automático (D5 pendiente)" });
  });
}

/** Los servicios del turno que exigen consentimiento lo tienen vigente y aceptado por el cliente. */
async function exigirConsentimientos(tx: Tx, organizacionId: string, r: { clienteId: string | null; items: { servicioId: string }[] }) {
  const exigidos = await tx.servicioConsentimiento.findMany({ where: { servicioId: { in: r.items.map(i => i.servicioId) } }, select: { clave: true } });
  if (!exigidos.length) return;
  if (!r.clienteId) throw new DatosInvalidos("El turno no tiene cliente para verificar los consentimientos");
  const faltan: string[] = [];
  for (const clave of new Set(exigidos.map(e => e.clave))) {
    const vigente = await tx.consentimientoVersion.findFirst({ where: { organizacionId, clave }, orderBy: { version: "desc" } });
    const ultimo = await tx.clienteConsentimiento.findFirst({ where: { clienteId: r.clienteId, version: { clave } }, orderBy: { orden: "desc" } });
    if (!vigente || !ultimo || ultimo.accion !== "ACEPTA" || ultimo.versionId !== vigente.id) faltan.push(vigente?.titulo ?? clave);
  }
  if (faltan.length) throw new DatosInvalidos(`Falta el consentimiento vigente: ${faltan.join(", ")}. Registralo en la ficha del cliente.`);
}

/** Atención registrada: solo turnos confirmados, desde una hora antes del inicio y con los consentimientos exigidos vigentes. */
export async function marcarAtendida(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date()) {
  await db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede marcar atendido un turno ${ETIQUETA[r.estado]}`);
    if (ahora.getTime() < r.items[0]!.inicio.getTime() - 3_600_000) throw new DatosInvalidos("Todavía falta más de una hora para el turno");
    await exigirConsentimientos(tx, organizacionId, r);
    await transicion(tx, organizacionId, reservaId, "CONFIRMADA", "ATENDIDA", "ATENDIDA", actorId);
  });
}

/**
 * Tablero de recepción (doc 29): la clienta con turno llegó y empieza la atención. Desde una hora antes
 * del turno, como «Atendido». No cambia la agenda: el turno sigue ocupando su horario.
 */
export async function marcarLlegada(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date()) {
  await db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede marcar la llegada de un turno ${ETIQUETA[r.estado]}`);
    if (r.iniciadaEn) throw new DatosInvalidos("La clienta ya está en atención");
    if (ahora.getTime() < r.items[0]!.inicio.getTime() - 3_600_000) throw new DatosInvalidos("Todavía falta más de una hora para el turno");
    const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: "CONFIRMADA", iniciadaEn: null }, data: { iniciadaEn: ahora } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
    await auditar(tx, organizacionId, actorId, "reserva.llegada", "Reserva", reservaId);
  });
}

/**
 * Doc 31 (etapa 4): «Empezó» en Tratamientos, donde no se marca la llegada sino cuándo empieza la sesión.
 * Turno confirmado, sin empezar y de hoy en la zona de la sede.
 *
 * - Ya es la hora o pasó: marca el comienzo, como «Llegó» (`marcarLlegada`, que sigue igual para el otro
 *   universo).
 * - Falta para el turno: la clienta llegó antes y la sesión empieza ya. Se adelanta a este minuto lo que
 *   empieza primero (el primer servicio y los que van a la vez con él), con sus recursos, solo si la
 *   profesional y esos recursos están libres desde ahora hasta la hora del turno: otros turnos vigentes,
 *   atenciones en curso, ausencias y bloqueos de recurso. Así «Terminó» vale en cualquier momento y el
 *   horario que queda libre al final vuelve a ofrecerse. Lo encadenado después no se mueve.
 *
 * La preparación previa no se adelanta: la sesión empieza ahora, así que la ocupación arranca en este minuto.
 */
export async function empezarSesion(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date()): Promise<void> {
  const recursosTurno = await recursosParaEmpezar(db, organizacionId, reservaId);
  await conReintento(() => db.$transaction(async tx => {
    // Mismo orden que el resto (doc 16): profesionales y después recursos.
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    await bloquearAgenda(tx, [], recursosTurno);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede empezar un turno ${ETIQUETA[r.estado]}`);
    if (r.iniciadaEn) throw new DatosInvalidos("La sesión ya empezó");
    const intento = await empezarBajoLock(tx, actorId, organizacionId, r.sedeId, reservaId, ahora, false);
    if (!intento.empezo) throw new DatosInvalidos(`No se puede empezar antes de las ${intento.hora}: ${intento.motivos.join("; ")}`);
  }, { maxWait: 10_000, timeout: 20_000 }));
}

/** Lectura previa sin locks, solo para saber qué recursos bloquear (los profesionales los bloquea reservaParaOperar). */
async function recursosParaEmpezar(db: Database, organizacionId: string, reservaId: string) {
  exigirIds(reservaId);
  const previa = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, select: { items: { select: { recursos: { select: { recursoId: true } } } } } });
  if (!previa) throw new AccesoDenegado();
  return ordenar(previa.items.flatMap(i => i.recursos.map(r => r.recursoId)));
}

/**
 * Núcleo de `empezarSesion` y `registrarLlegada`, bajo los locks de las profesionales del turno y sus
 * recursos, con el turno ya verificado confirmado y sin empezar. Empieza la atención (adelantando lo que
 * empieza primero si la clienta llegó antes) o devuelve por qué no. Con `soloSiLibres` (la llegada de Manos y
 * pies, doc 31 etapa 3b) tampoco empieza si una profesional de lo que empieza primero está atendiendo a otra
 * clienta, aunque ya sea la hora: la clienta queda esperando.
 */
async function empezarBajoLock(tx: Tx, actorId: string, organizacionId: string, sedeId: string, reservaId: string, ahora: Date, soloSiLibres: boolean, detalleExtra: Record<string, Prisma.InputJsonValue> = {}): Promise<{ empezo: true } | { empezo: false; motivos: string[]; hora: string; atendiendo: boolean }> {
  const { timezone: tz } = await tx.sede.findUniqueOrThrow({ where: { id: sedeId }, select: { timezone: true } });
  // Releídos bajo lock: lo que se adelanta tiene que ser lo que hay ahora.
  const items = await tx.reservaItem.findMany({ where: { reservaId }, include: { recursos: { include: { recurso: { select: { nombre: true } } } }, profesional: { select: { nombre: true, apellido: true } } }, orderBy: { posicion: "asc" } });
  const primero = items[0]!;
  if (aLocal(primero.inicio, tz).fecha !== aLocal(ahora, tz).fecha) throw new DatosInvalidos("Solo se empieza una sesión de hoy");
  const grupo = items.filter(i => i.inicio.getTime() === primero.inicio.getTime());
  const hora = (d: Date) => aHora(aLocal(d, tz).minutos);
  const otra = { not: reservaId };
  // Atención en curso: ya empezó y no tiene «Terminó»; ocupa aunque se haya pasado del fin estimado (doc 29).
  const enCurso: Prisma.ReservaItemWhereInput = { reservaId: otra, inicio: { lte: ahora }, terminadoEn: null, reserva: { estado: "CONFIRMADA", iniciadaEn: { not: null } } };
  const atendiendo = async (profesionalId: string) => tx.reservaItem.count({ where: { ...enCurso, profesionalId } });

  const empezar = async (detalle: Record<string, Prisma.InputJsonValue>) => {
    const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: "CONFIRMADA", iniciadaEn: null }, data: { iniciadaEn: ahora } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
    await auditar(tx, organizacionId, actorId, "reserva.sesion_empezada", "Reserva", reservaId, { ...detalle, ...detalleExtra });
    return { empezo: true } as const;
  };
  if (soloSiLibres) {
    const ocupadas: string[] = [];
    for (const profesionalId of new Set(grupo.map(i => i.profesionalId))) {
      if (await atendiendo(profesionalId)) ocupadas.push(`${nombreDe(grupo.find(i => i.profesionalId === profesionalId)!.profesional)} está atendiendo a otra clienta`);
    }
    if (ocupadas.length) return { empezo: false, motivos: ocupadas, hora: hora(primero.inicio), atendiendo: true };
  }
  if (ahora >= primero.inicio) return empezar({ adelantada: false });

  const minuto = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
  const delta = primero.inicio.getTime() - minuto.getTime();
  const cruza = { lt: primero.inicio }, desde = { gt: minuto };
  const motivos: string[] = [];
  for (const profesionalId of new Set(grupo.map(i => i.profesionalId))) {
    const nombre = nombreDe(grupo.find(i => i.profesionalId === profesionalId)!.profesional);
    const turno = await tx.reservaItem.findFirst({ where: { profesionalId, reservaId: otra, ocupaDesde: cruza, ocupaHasta: desde, reserva: reservaActiva(ahora) }, orderBy: { ocupaHasta: "desc" }, select: { ocupaHasta: true } });
    const ausencia = await tx.bloqueoAgenda.findFirst({ where: { profesionalId, inicio: cruza, fin: desde }, orderBy: { fin: "desc" }, select: { fin: true } });
    if (await atendiendo(profesionalId)) motivos.push(`${nombre} está atendiendo a otra clienta`);
    else if (turno) motivos.push(`${nombre} tiene otro turno hasta las ${hora(turno.ocupaHasta)}`);
    if (ausencia) motivos.push(`${nombre} tiene una ausencia hasta las ${hora(ausencia.fin)}`);
  }
  for (const { recursoId, recurso } of grupo.flatMap(i => i.recursos)) {
    const enUso = await tx.reservaItemRecurso.count({ where: { recursoId, item: enCurso } });
    const turno = await tx.reservaItemRecurso.findFirst({ where: { recursoId, ocupaDesde: cruza, ocupaHasta: desde, item: { reservaId: otra, reserva: reservaActiva(ahora) } }, orderBy: { ocupaHasta: "desc" }, select: { ocupaHasta: true } });
    const bloqueo = await tx.bloqueoRecurso.findFirst({ where: { recursoId, inicio: cruza, fin: desde }, orderBy: { fin: "desc" }, select: { fin: true } });
    if (enUso) motivos.push(`${recurso.nombre} está en uso con otra clienta`);
    else if (turno) motivos.push(`${recurso.nombre} está ocupada hasta las ${hora(turno.ocupaHasta)}`);
    if (bloqueo) motivos.push(`${recurso.nombre} está bloqueada hasta las ${hora(bloqueo.fin)}`);
  }
  if (motivos.length) return { empezo: false, motivos, hora: hora(primero.inicio), atendiendo: false };

  for (const it of grupo) {
    const ocupaHasta = new Date(it.ocupaHasta.getTime() - delta);
    const { count } = await tx.reservaItem.updateMany({ where: { id: it.id, inicio: it.inicio, terminadoEn: null }, data: { inicio: minuto, fin: new Date(it.fin.getTime() - delta), ocupaDesde: minuto, ocupaHasta } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
    await tx.reservaItemRecurso.updateMany({ where: { itemId: it.id }, data: { ocupaDesde: minuto, ocupaHasta } });
  }
  return empezar({ adelantada: true, inicioPrevisto: primero.inicio.toISOString(), inicio: minuto.toISOString() });
}

/**
 * Doc 31, etapa 3b: «Llegó» en Manos y pies. Turno confirmado, sin empezar y de hoy.
 * - Si ninguna profesional de lo que empieza primero está atendiendo a otra clienta, la atención empieza con
 *   la misma lógica que `empezarSesion` (que adelanta el turno si llegó antes).
 * - Si alguna está atendiendo, o adelantar no es posible por otro motivo (otro turno antes, una ausencia, el
 *   sillón), la clienta queda esperando: `llegoEn` (se conserva la primera llegada si se vuelve a marcar) y
 *   el tablero la muestra en `llegaron`, con su turno y su profesional. Recepción la sienta con `sentarTurno`
 *   o vuelve a marcar «Llegó» cuando su profesional se libera.
 * `marcarLlegada` y `empezarSesion` siguen igual para quienes ya las usan.
 */
export async function registrarLlegada(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date()): Promise<{ empezo: boolean }> {
  const recursosTurno = await recursosParaEmpezar(db, organizacionId, reservaId);
  return conReintento(() => db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    await bloquearAgenda(tx, [], recursosTurno);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede marcar la llegada de un turno ${ETIQUETA[r.estado]}`);
    if (r.iniciadaEn) throw new DatosInvalidos("La clienta ya está en atención");
    const llegoEn = (await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { llegoEn: true } })).llegoEn;
    const intento = await empezarBajoLock(tx, actorId, organizacionId, r.sedeId, reservaId, ahora, true, { llegada: true, ...(llegoEn ? { llegoEn: llegoEn.toISOString() } : {}) });
    if (intento.empezo) return { empezo: true };
    const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: "CONFIRMADA", iniciadaEn: null }, data: { llegoEn: llegoEn ?? ahora } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
    await auditar(tx, organizacionId, actorId, "reserva.llegada", "Reserva", reservaId, { esperando: true, motivos: intento.motivos });
    return { empezo: false };
  }, { maxWait: 10_000, timeout: 20_000 }));
}

const ATENCION_NO_EN_CURSO = "La atención no está en curso";
const pisarSi = (pisar: boolean | undefined, profesionales: string[]): OpcionesConsulta => (pisar ? { pisar: profesionales } : {});
const comoDatosInvalidos = (e: unknown) => {
  if (e instanceof TurnoNoDisponible) return new DatosInvalidos(PROFESIONAL_OCUPADA);
  if (e instanceof ConfiguracionIncompleta) return new DatosInvalidos(`Falta definir en la sede: ${e.faltantes.join(", ")}`);
  return e;
};

/**
 * Doc 31, etapa 3b: sentar a una clienta con turno, haya marcado la llegada o no: con su profesional cuando
 * se libera, o con otra. Turno confirmado, sin empezar y de hoy. En una transacción, como
 * `reprogramarReserva`: cancela el turno y crea uno nuevo que empieza en este minuto con las profesionales
 * indicadas (por posición; sin indicar, las mismas), con la atención empezada. Conserva cliente o nombre
 * provisional, canal, notas, precio y seña pactados (la seña cobrada sigue la cadena de reprogramación), la
 * llegada y la espera de la que salió. Con `pisar`, «sentar igual» como en `sentarEspera`: los turnos sin
 * empezar de esas profesionales no cuentan y el evento de creación guarda cuáles pisó.
 *
 * Es un cambio de horario con la clienta en el local, así que no se le manda el aviso de reprogramación.
 */
export async function sentarTurno(db: Database, actorId: string, organizacionId: string, datos: { reservaId: string; profesionales?: (string | null)[]; pisar?: boolean }, ahora = new Date()): Promise<TurnoTomado> {
  exigirIds(datos.reservaId, ...(datos.profesionales ?? []));
  const original = await db.reserva.findFirst({ where: { id: datos.reservaId, organizacionId }, include: { sede: { select: { timezone: true } }, items: { include: { recursos: true }, orderBy: { posicion: "asc" } } } });
  if (!original) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(original.sedeId)) throw new AccesoDenegado();
  const tz = original.sede.timezone;
  const inicio = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
  const fecha = aLocal(inicio, tz).fecha;
  if (!original.items.length || aLocal(original.items[0]!.inicio, tz).fecha !== fecha) throw new DatosInvalidos("Solo se sienta un turno de hoy");
  const elegidas = original.items.map((it, i) => datos.profesionales?.[i] || it.profesionalId);
  const pedido: Pedido = { sedeId: original.sedeId, fecha, canal: "RECEPCION", items: original.items.map((it, i) => ({
    servicioId: it.servicioId, profesionalId: elegidas[i]!, conAnterior: i > 0 && it.inicio.getTime() === original.items[i - 1]!.inicio.getTime(),
  })) };
  const opciones = pisarSi(datos.pisar, elegidas);
  try {
    // El motor valida con el minuto como «ahora», como «Atender ahora»: el turno empieza en este minuto.
    const previa = await cargarConsulta(db, organizacionId, pedido, inicio, undefined, opciones);
    if (previa.consulta.items.some(i => !i.candidatos.length)) throw new DatosInvalidos("La profesional elegida no hace ese servicio en esta sede");
    const profesionales = ordenar([...previa.consulta.items.flatMap(i => i.candidatos), ...original.items.map(i => i.profesionalId)]);
    const recursos = ordenar([...previa.consulta.recursos.map(r => r.id), ...original.items.flatMap(i => i.recursos.map(r => r.recursoId))]);

    return await conReintento(() => db.$transaction(async tx => {
      await bloquearAgenda(tx, profesionales, recursos);
      const actual = await tx.reserva.findUniqueOrThrow({ where: { id: original.id }, select: { estado: true, iniciadaEn: true, llegoEn: true, esperaId: true } });
      if (actual.estado !== "CONFIRMADA") throw new DatosInvalidos(`Solo se sienta un turno confirmado; este está ${ETIQUETA[actual.estado as Estado]}`);
      if (actual.iniciadaEn) throw new DatosInvalidos("La clienta ya está en atención");
      // Se libera primero dentro de la transacción para que el turno nuevo pueda solaparse con el viejo.
      const { count } = await tx.reserva.updateMany({ where: { id: original.id, estado: "CONFIRMADA", iniciadaEn: null }, data: { estado: "CANCELADA" } });
      if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
      const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, inicio, { profesionales: new Set(profesionales), recursos: new Set(recursos) }, opciones);
      const turno = asignarEn(consulta, inicio.getTime());
      if (!turno) throw new TurnoNoDisponible();
      const pisadas = datos.pisar ? await reservasPisadas(tx, turno.items, ahora, original.id) : [];
      const congelados = new Map(original.items.map((it, i) => [i, { precio: it.precio.toFixed(2), sena: it.sena?.toFixed(2) ?? null }]));
      const nueva = await escribirTurno(tx, organizacionId, {
        sedeId: original.sedeId, clienteId: original.clienteId, clienteProvisional: original.clienteProvisional, canal: original.canal, estado: "CONFIRMADA", expiraEn: null,
        notas: original.notas, creadoPor: actorId, reemplazaId: original.id, sinTurnoPrevio: original.sinTurnoPrevio, iniciadaEn: inicio, llegoEn: actual.llegoEn, esperaId: actual.esperaId,
      }, turno, efectivos, congelados);
      await registrarEvento(tx, organizacionId, original.id, "REPROGRAMADA", "CONFIRMADA", "CANCELADA", actorId, { nuevaReservaId: nueva.reservaId, sentada: true });
      await registrarEvento(tx, organizacionId, nueva.reservaId, "CREADA", null, "CONFIRMADA", actorId, { reprogramadaDesde: original.id, sentada: true, ...(pisadas.length ? { pisadas } : {}) });
      return nueva;
    }, { maxWait: 10_000, timeout: 20_000 }));
  } catch (e) { throw comoDatosInvalidos(e); }
}

/**
 * Doc 31, etapa 3b: suma a una atención en curso (turno confirmado y empezado, de hoy) un servicio que
 * empieza ahora, con otra profesional: una que no tenga ya un servicio sin terminar en ese turno. Así la visita
 * es una sola comanda («+ servicio» en la tarjeta, y `sentarEspera` para lo que faltaba de la espera).
 *
 * Mismo motor y mismos locks que una toma de turno (doc 16): las profesionales del turno y la nueva, y después
 * los recursos; el motor asigna los recursos. Precio y seña de lista de la sede, copiados como en
 * `escribirTurno`. Sin ficha no se suma un servicio que exige consentimiento (misma regla que `sentarEspera`:
 * «Terminó» lo verifica contra la ficha). Con `pisar`, como «sentar igual». Queda en el historial del turno
 * (evento `SERVICIO_SUMADO`). Después, «Terminó» por profesional y el cobro lo tratan como cualquier servicio
 * del turno.
 */
export async function sumarServicio(db: Database, actorId: string, organizacionId: string, datos: { reservaId: string; servicioId: string; profesionalId: string; pisar?: boolean }, ahora = new Date()): Promise<void> {
  if (!datos.servicioId || !datos.profesionalId) throw new DatosInvalidos("Elegí el servicio y la profesional");
  await sumarEnAtencion(db, actorId, organizacionId, datos.reservaId, [{ servicioId: datos.servicioId, profesionalId: datos.profesionalId }], ahora, { pisar: datos.pisar });
}

/**
 * Núcleo de `sumarServicio`, para uno o varios servicios a la vez (con profesionales distintas). `antes` y
 * `despues` corren en la transacción, como en `tomarTurno`: `sentarEspera` bloquea y cierra la espera ahí.
 * Devuelve el turno completo, con lo que ya tenía.
 */
export async function sumarEnAtencion(db: Database, actorId: string, organizacionId: string, reservaId: string, nuevos: { servicioId: string; profesionalId: string }[], ahora: Date, opciones: { pisar?: boolean; antes?: (tx: Tx) => Promise<void>; despues?: DespuesDeTomar; evento?: Record<string, Prisma.InputJsonValue> } = {}): Promise<TurnoTomado> {
  exigirIds(reservaId, ...nuevos.flatMap(i => [i.servicioId, i.profesionalId]));
  if (!nuevos.length) throw new DatosInvalidos("Elegí al menos un servicio");
  if (new Set(nuevos.map(i => i.profesionalId)).size !== nuevos.length) throw new DatosInvalidos("Los servicios a la vez van con profesionales distintas");
  const previa = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, select: { sedeId: true, sede: { select: { timezone: true } }, items: { select: { profesionalId: true } } } });
  if (!previa) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(previa.sedeId)) throw new AccesoDenegado();
  const tz = previa.sede.timezone;
  const inicio = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
  const pedido: Pedido = { sedeId: previa.sedeId, fecha: aLocal(inicio, tz).fecha, canal: "RECEPCION", items: nuevos.map((i, n) => ({ servicioId: i.servicioId, profesionalId: i.profesionalId, conAnterior: n > 0 })) };
  const consultaOpciones = pisarSi(opciones.pisar, nuevos.map(i => i.profesionalId));
  try {
    // El motor valida con el minuto como «ahora», como «Atender ahora»: el servicio empieza en este minuto.
    const primera = await cargarConsulta(db, organizacionId, pedido, inicio, undefined, consultaOpciones);
    // Las del turno también: así «Terminó» de cualquiera de ellas no se cruza con lo que se suma.
    const profesionales = ordenar([...primera.consulta.items.flatMap(i => i.candidatos), ...previa.items.map(i => i.profesionalId)]);
    const recursos = ordenar(primera.consulta.recursos.map(r => r.id));

    return await conReintento(() => db.$transaction(async tx => {
      await bloquearAgenda(tx, profesionales, recursos);
      await opciones.antes?.(tx);
      // Releído bajo lock: otra recepcionista pudo marcar «Terminó» o sumar algo mientras tanto.
      const r = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { estado: true, iniciadaEn: true, clienteId: true, items: { orderBy: { posicion: "asc" }, select: { posicion: true, profesionalId: true, inicio: true, terminadoEn: true } } } });
      if (r.estado !== "CONFIRMADA" || !r.iniciadaEn) throw new DatosInvalidos(`${ATENCION_NO_EN_CURSO}: solo se suma un servicio a una clienta que se está atendiendo`);
      if (aLocal(r.items[0]!.inicio, tz).fecha !== pedido.fecha) throw new DatosInvalidos("Solo se suma a una atención de hoy");
      if (nuevos.some(n => r.items.some(i => i.profesionalId === n.profesionalId && !i.terminadoEn))) throw new DatosInvalidos("Esa profesional ya tiene un servicio sin terminar en este turno: elegí otra");
      if (!r.clienteId && await tx.servicioConsentimiento.count({ where: { organizacionId, servicioId: { in: nuevos.map(i => i.servicioId) } } }))
        throw new DatosInvalidos("Ese servicio exige un consentimiento firmado: elegí o cargá la ficha de la clienta antes de sumarlo");
      const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, inicio, { profesionales: new Set(profesionales), recursos: new Set(recursos) }, consultaOpciones);
      const turno = asignarEn(consulta, inicio.getTime());
      if (!turno) throw new TurnoNoDisponible();
      const pisadas = opciones.pisar ? await reservasPisadas(tx, turno.items, ahora, reservaId) : [];
      // Transición condicional: la atención sigue en curso al escribir.
      const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: "CONFIRMADA", iniciadaEn: { not: null } }, data: { updatedAt: new Date() } });
      if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
      await escribirItems(tx, organizacionId, reservaId, turno.items, efectivos, Math.max(...r.items.map(i => i.posicion)) + 1);
      await registrarEvento(tx, organizacionId, reservaId, "SERVICIO_SUMADO", "CONFIRMADA", "CONFIRMADA", actorId, {
        servicios: turno.items.map(i => ({ servicioId: i.servicioId, profesionalId: i.profesionalId })), ...opciones.evento, ...(pisadas.length ? { pisadas } : {}),
      });
      const todos = await tx.reservaItem.findMany({ where: { reservaId }, orderBy: { posicion: "asc" }, include: { recursos: { select: { recursoId: true }, orderBy: { recursoId: "asc" } } } });
      const resultado: TurnoTomado = { reservaId, estado: "CONFIRMADA", expiraEn: null, items: todos.map(i => ({
        servicioId: i.servicioId, profesionalId: i.profesionalId, inicio: i.inicio, fin: i.fin, recursoIds: i.recursos.map(x => x.recursoId), precio: i.precio.toFixed(2), sena: i.sena?.toFixed(2) ?? null,
      })) };
      await opciones.despues?.(tx, resultado);
      return resultado;
    }, { maxWait: 10_000, timeout: 20_000 }));
  } catch (e) { throw comoDatosInvalidos(e); }
}

/**
 * Tablero de recepción (doc 29): «Terminó». Recepción ve a la profesional libre o recibe la comanda: el
 * turno pasa a atendido (por cobrar) y la agenda se recorta a este momento, así la profesional y sus
 * recursos quedan libres para otra clienta y el portal vuelve a ofrecer ese horario.
 *
 * - Un servicio en curso termina ahora (fin y ocupación).
 * - Un servicio encadenado que todavía no empezó se quita del turno y queda anotado en el evento: la
 *   profesional terminó antes. Si igual se hizo, recepción lo agrega en la comanda al cobrar.
 * - Un servicio ya terminado no cambia.
 *
 * A diferencia de «Atendido» en la agenda (que se puede marcar al llegar la clienta), exige que el turno
 * haya empezado: recortar antes liberaría un horario que la clienta todavía está usando.
 */
export async function terminarAtencion(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date(), opciones: { profesionalId?: string | null } = {}) {
  exigirIds(opciones.profesionalId);
  await db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede terminar un turno ${ETIQUETA[r.estado]}`);
    // Una clienta que llegó antes de hora y ya terminó: sin horario empezado no hay nada que recortar.
    if (ahora <= r.items[0]!.inicio) throw new DatosInvalidos("El turno todavía no empezó en la agenda: marcalo atendido desde la agenda");
    // Etapa 2 (servicios a la vez): «Terminó» de una profesional termina solo sus servicios; el turno pasa
    // a atendido cuando no queda ninguno pendiente. Sin profesional, termina todo.
    const pendientes = r.items.filter(i => !i.terminadoEn);
    const propios = opciones.profesionalId ? pendientes.filter(i => i.profesionalId === opciones.profesionalId) : pendientes;
    if (!propios.length) throw new DatosInvalidos("Esa profesional no tiene servicios pendientes en este turno");
    await exigirConsentimientos(tx, organizacionId, r);
    const quitados: { servicioId: string; profesionalId: string; inicio: string }[] = [];
    for (const it of propios) {
      if (it.inicio >= ahora) {
        await tx.reservaItemRecurso.deleteMany({ where: { itemId: it.id } });
        await tx.reservaItem.delete({ where: { id: it.id } });
        quitados.push({ servicioId: it.servicioId, profesionalId: it.profesionalId, inicio: it.inicio.toISOString() });
      } else if (it.ocupaHasta > ahora) {
        await tx.reservaItem.update({ where: { id: it.id }, data: { fin: it.fin < ahora ? it.fin : ahora, ocupaHasta: ahora, terminadoEn: ahora } });
        await tx.reservaItemRecurso.updateMany({ where: { itemId: it.id, ocupaHasta: { gt: ahora } }, data: { ocupaHasta: ahora } });
      } else await tx.reservaItem.update({ where: { id: it.id }, data: { terminadoEn: ahora } });
    }
    const detalle = { terminada: ahora.toISOString(), ...(opciones.profesionalId ? { profesionalId: opciones.profesionalId } : {}), ...(quitados.length ? { quitados } : {}) };
    if (pendientes.length > propios.length) {
      await auditar(tx, organizacionId, actorId, "reserva.termino_profesional", "Reserva", reservaId, detalle);
      return;
    }
    await tx.reserva.update({ where: { id: reservaId }, data: { iniciadaEn: r.iniciadaEn ?? r.items[0]!.inicio, terminadaEn: ahora } });
    await transicion(tx, organizacionId, reservaId, "CONFIRMADA", "ATENDIDA", "ATENDIDA", actorId, detalle);
  });
}

const nombreDe = (p: { nombre: string; apellido: string | null }) => [p.nombre, p.apellido].filter(Boolean).join(" ");
/** Servicio de una atención en curso: empezó y su profesional no marcó «Terminó» (doc 29), aunque se haya pasado del estimado. */
const EN_CURSO: Prisma.ReservaItemWhereInput = { terminadoEn: null, reserva: { estado: "CONFIRMADA", iniciadaEn: { not: null } } };

/**
 * Doc 31, etapa 3a: «Pasar» una atención en curso a otra profesional (la primera se tiene que ir, se
 * descompuso, o recepción reacomoda el salón). Los servicios sin «Terminó» que `deProfesionalId` tiene en ese
 * turno pasan a `aProfesionalId`, que tiene que:
 * - hacer esos servicios en la sede (habilitación y habilidades, el mismo criterio que el motor);
 * - no estar atendiendo a nadie (una atención pasada del estimado también cuenta, doc 29);
 * - estar libre desde ahora hasta el fin estimado de lo que recibe: jornada, ausencias y otros turnos. Con
 *   `pisar`, sus turnos reservados que todavía no empezaron no cuentan (como «sentar igual»); quedan en la
 *   auditoría como pisados.
 *
 * Bajo los locks de las dos profesionales (doc 16, en orden de ID), con actualización condicional de cada
 * servicio y auditoría. Los recursos no cambian: la clienta sigue en el mismo sillón. El servicio conserva su
 * horario: lo ya hecho por la primera queda dentro del servicio de la segunda (la comanda la corrige al cobrar).
 */
export async function pasarAtencion(db: Database, actorId: string, organizacionId: string, datos: { reservaId: string; deProfesionalId: string; aProfesionalId: string; pisar?: boolean }, ahora = new Date()): Promise<void> {
  exigirIds(datos.reservaId, datos.deProfesionalId, datos.aProfesionalId);
  if (!datos.aProfesionalId) throw new DatosInvalidos("Elegí a quién pasar la atención");
  if (datos.deProfesionalId === datos.aProfesionalId) throw new DatosInvalidos("Elegí otra profesional");
  const previa = await db.reserva.findFirst({ where: { id: datos.reservaId, organizacionId }, select: { sedeId: true, sede: { select: { timezone: true } } } });
  if (!previa) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(previa.sedeId)) throw new AccesoDenegado();
  const tz = previa.sede.timezone;
  const hora = (d: Date) => aHora(aLocal(d, tz).minutos);

  await conReintento(() => db.$transaction(async tx => {
    await bloquearAgenda(tx, ordenar([datos.deProfesionalId, datos.aProfesionalId]), []);
    // Releído bajo lock: otra recepcionista pudo pasarla, o marcar «Terminó», mientras tanto.
    const r = await tx.reserva.findUniqueOrThrow({ where: { id: datos.reservaId }, select: { estado: true, iniciadaEn: true, items: { where: { profesionalId: datos.deProfesionalId, terminadoEn: null }, orderBy: { posicion: "asc" } } } });
    if (r.estado !== "CONFIRMADA" || !r.iniciadaEn) throw new DatosInvalidos("La atención no está en curso");
    if (!r.items.length) throw new DatosInvalidos("Esa profesional no tiene servicios en curso en este turno");
    const nueva = await tx.profesional.findFirst({ where: { id: datos.aProfesionalId, organizacionId }, select: { nombre: true, apellido: true } });
    if (!nueva) throw new AccesoDenegado();
    const nombre = nombreDe(nueva);

    // Habilitación, habilidades y jornada: el mismo cargador que el motor, limitado a la profesional bloqueada
    // (de a cuatro servicios, el límite de un pedido).
    const servicioIds = [...new Set(r.items.map(i => i.servicioId))];
    let jornada: { desde: number; hasta: number }[] = [];
    for (let n = 0; n < servicioIds.length; n += 4) {
      const pedido: Pedido = { sedeId: previa.sedeId, fecha: aLocal(ahora, tz).fecha, canal: "RECEPCION", items: servicioIds.slice(n, n + 4).map(servicioId => ({ servicioId, profesionalId: datos.aProfesionalId })) };
      const { consulta } = await cargarConsulta(tx, organizacionId, pedido, ahora, { profesionales: new Set([datos.aProfesionalId]), recursos: new Set() });
      if (consulta.items.some(i => !i.candidatos.length)) throw new DatosInvalidos(`${nombre} no hace ese servicio`);
      jornada = consulta.profesionales.get(datos.aProfesionalId)?.jornada ?? [];
    }

    if (await tx.reservaItem.count({ where: { ...EN_CURSO, profesionalId: datos.aProfesionalId } }))
      throw new DatosInvalidos(`${nombre} está atendiendo a otra clienta`);
    // Desde ahora hasta el fin estimado de lo que recibe; si ya se pasó del estimado, al menos este minuto.
    const desde = ahora, hasta = new Date(Math.max(ahora.getTime() + 60_000, ...r.items.map(i => i.ocupaHasta.getTime())));
    if (!jornada.some(j => j.desde <= desde.getTime() && hasta.getTime() <= j.hasta)) throw new DatosInvalidos(`${nombre} no está en su horario hasta que termine esta atención`);
    const ausencia = await tx.bloqueoAgenda.findFirst({ where: { profesionalId: datos.aProfesionalId, inicio: { lt: hasta }, fin: { gt: desde } }, orderBy: { inicio: "asc" }, select: { fin: true } });
    if (ausencia) throw new DatosInvalidos(`${nombre} tiene una ausencia hasta las ${hora(ausencia.fin)}`);
    const cruza: Prisma.ReservaItemWhereInput = { profesionalId: datos.aProfesionalId, reservaId: { not: datos.reservaId }, ocupaDesde: { lt: hasta }, ocupaHasta: { gt: desde } };
    const turno = await tx.reservaItem.findFirst({ where: { ...cruza, reserva: { AND: [reservaActiva(ahora), ...(datos.pisar ? [{ NOT: TURNO_PISABLE }] : [])] } }, orderBy: { ocupaDesde: "asc" }, select: { inicio: true } });
    if (turno) throw new DatosInvalidos(`${nombre} tiene un turno a las ${hora(turno.inicio)}`);
    const pisadas = datos.pisar ? await reservasPisadas(tx, [{ profesionalId: datos.aProfesionalId, ocupaDesde: desde, ocupaHasta: hasta }], ahora, datos.reservaId) : [];

    for (const it of r.items) {
      const { count } = await tx.reservaItem.updateMany({ where: { id: it.id, profesionalId: datos.deProfesionalId, terminadoEn: null }, data: { profesionalId: datos.aProfesionalId } });
      if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
    }
    await auditar(tx, organizacionId, actorId, "reserva.atencion_pasada", "Reserva", datos.reservaId, {
      deProfesionalId: datos.deProfesionalId, aProfesionalId: datos.aProfesionalId, servicioIds: r.items.map(i => i.servicioId), ...(pisadas.length ? { pisadas } : {}),
    });
  }, { maxWait: 10_000, timeout: 20_000 }));
}

export async function marcarAusente(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date()) {
  await db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede marcar ausente un turno ${ETIQUETA[r.estado]}`);
    if (ahora < r.items[0]!.inicio) throw new DatosInvalidos("El turno todavía no empezó");
    await transicion(tx, organizacionId, reservaId, "CONFIRMADA", "AUSENTE", "AUSENTE", actorId);
  });
}

/**
 * Reprograma un turno confirmado de forma atómica: libera el original y toma el nuevo horario en la
 * misma transacción, con los locks de ambos. Si el nuevo no entra, no cambia nada. Mantiene servicios,
 * cliente, canal y el precio/seña pactados (política congelada); la nueva reserva enlaza a la original.
 *
 * Doc 31 (etapa 4): `recursos` trae, por ítem, las unidades que eligió recepción (null o vacío: cualquiera
 * libre). Con el mismo horario y las mismas profesionales sirve para cambiar solo la cabina. Una sesión
 * ya empezada no se mueve: la reserva nueva perdería el comienzo y la atención en curso.
 */
export async function reprogramarReserva(db: Database, actorId: string, organizacionId: string, reservaId: string, destino: { fecha: string; inicio: Date; profesionales?: (string | null)[]; recursos?: (string[] | null)[] }, ahora = new Date()) {
  exigirIds(reservaId, ...(destino.profesionales ?? []), ...(destino.recursos ?? []).flatMap(r => r ?? []));
  const original = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, include: { items: { include: { recursos: true }, orderBy: { posicion: "asc" } } } });
  if (!original) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(original.sedeId)) throw new AccesoDenegado();
  if (Number.isNaN(destino.inicio.getTime())) throw new DatosInvalidos("Horario inválido");
  // El personal reprograma con reglas de recepción (sin anticipación ni horizonte online).
  const pedido: Pedido = { sedeId: original.sedeId, fecha: destino.fecha, canal: "RECEPCION", items: original.items.map((it, i) => ({
    servicioId: it.servicioId, profesionalId: destino.profesionales?.[i] ?? null, conAnterior: i > 0 && it.inicio.getTime() === original.items[i - 1]!.inicio.getTime(),
    ...(destino.recursos?.[i]?.length ? { recursoIds: destino.recursos[i]! } : {}),
  })) };
  const previa = await cargarConsulta(db, organizacionId, pedido, ahora);
  const profesionales = ordenar([...previa.consulta.items.flatMap(i => i.candidatos), ...original.items.map(i => i.profesionalId)]);
  const recursos = ordenar([...previa.consulta.recursos.map(r => r.id), ...original.items.flatMap(i => i.recursos.map(r => r.recursoId))]);

  return conReintento(() => db.$transaction(async tx => {
    await bloquearAgenda(tx, profesionales, recursos);
    const actual = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { estado: true, iniciadaEn: true } });
    if (actual.estado !== "CONFIRMADA") throw new DatosInvalidos(`Solo se reprograman turnos confirmados; este está ${ETIQUETA[actual.estado as Estado]}`);
    if (actual.iniciadaEn) throw new DatosInvalidos("La sesión ya empezó: no se puede mover el turno");
    // Se libera primero dentro de la transacción para que el nuevo horario pueda solaparse con el viejo.
    const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: "CONFIRMADA", iniciadaEn: null }, data: { estado: "CANCELADA" } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la agenda");
    const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, ahora, { profesionales: new Set(profesionales), recursos: new Set(recursos) });
    const turno = asignarEn(consulta, destino.inicio.getTime());
    if (!turno) throw new TurnoNoDisponible();
    const congelados = new Map(original.items.map(i => [i.posicion, { precio: i.precio.toFixed(2), sena: i.sena?.toFixed(2) ?? null }]));
    const nueva = await escribirTurno(tx, organizacionId, { sedeId: original.sedeId, clienteId: original.clienteId, clienteProvisional: original.clienteProvisional, canal: original.canal, estado: "CONFIRMADA", expiraEn: null, notas: original.notas, creadoPor: actorId, reemplazaId: original.id, sinTurnoPrevio: original.sinTurnoPrevio, llegoEn: original.llegoEn, esperaId: original.esperaId }, turno, efectivos, congelados);
    await registrarEvento(tx, organizacionId, original.id, "REPROGRAMADA", "CONFIRMADA", "CANCELADA", actorId, { nuevaReservaId: nueva.reservaId });
    await registrarEvento(tx, organizacionId, nueva.reservaId, "CREADA", null, "CONFIRMADA", actorId, { reprogramadaDesde: original.id });
    return nueva;
  }, { maxWait: 10_000, timeout: 20_000 }));
}

/** Historial de una reserva y su cadena de reprogramación, para la ficha del turno. */
export async function historialReserva(db: Database, actorId: string, organizacionId: string, reservaId: string) {
  exigirIds(reservaId);
  const r = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, select: { sedeId: true, reemplazaId: true, reemplazadaPor: { select: { id: true } }, eventos: { orderBy: { orden: "asc" } } } });
  if (!r) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(r.sedeId)) throw new AccesoDenegado();
  return { reemplazaId: r.reemplazaId, reemplazadaPorId: r.reemplazadaPor?.id ?? null, eventos: r.eventos };
}

/** Datos para reprogramar desde la UI: servicios, profesionales y cliente del turno. */
export async function resumenReserva(db: Database, actorId: string, organizacionId: string, reservaId: string) {
  exigirIds(reservaId);
  const r = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, include: { items: { orderBy: { posicion: "asc" }, include: { servicio: { select: { nombre: true } } } }, cliente: { select: { nombre: true, apellido: true } } } });
  if (!r) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(r.sedeId)) throw new AccesoDenegado();
  return { id: r.id, sedeId: r.sedeId, estado: r.estado as Estado, clienteId: r.clienteId, cliente: r.cliente, clienteProvisional: r.clienteProvisional, items: r.items.map(i => ({ servicioId: i.servicioId, servicio: i.servicio.nombre, profesionalId: i.profesionalId, inicio: i.inicio })) };
}

/**
 * Universos, etapa 2 (doc 31): le pone la ficha a un turno que no la tiene, por ejemplo el de una clienta
 * sentada desde la espera con solo el nombre. Vale en cualquier estado menos cancelado o vencido (también
 * después de atendido, para cobrar con ficha). Borra el nombre provisional, vincula el cliente a la sede
 * como la toma de turnos de recepción y queda en la auditoría (el hecho, no el nombre). Si el turno ya tiene cliente, se rechaza:
 * cambiar de cliente un turno no es esto.
 */
export async function asignarClienteReserva(db: Database, actorId: string, organizacionId: string, reservaId: string, clienteId: string, ahora = new Date()): Promise<void> {
  exigirIds(reservaId, clienteId);
  if (!clienteId) throw new DatosInvalidos("Elegí o creá el cliente");
  const r = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, select: { sedeId: true } });
  if (!r) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(r.sedeId)) throw new AccesoDenegado();
  if (!await db.cliente.count({ where: { id: clienteId, organizacionId } })) throw new AccesoDenegado();
  await db.$transaction(async tx => {
    const actual = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { estado: true, expiraEn: true, clienteId: true, clienteProvisional: true } });
    const estado = actual.estado as Estado;
    const vencida = estado === "EXPIRADA" || (PENDIENTES.includes(estado) && actual.expiraEn !== null && actual.expiraEn <= ahora);
    if (estado === "CANCELADA" || vencida) throw new DatosInvalidos(`No se puede asignar el cliente a un turno ${ETIQUETA[vencida ? "EXPIRADA" : estado]}`);
    if (actual.clienteId) throw new DatosInvalidos("El turno ya tiene cliente");
    // Condicional: si otra recepcionista le asignó un cliente o lo canceló mientras tanto, no se pisa.
    const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado, clienteId: null }, data: { clienteId, clienteProvisional: null } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la pantalla");
    await tx.clienteSede.upsert({ where: { clienteId_sedeId: { clienteId, sedeId: r.sedeId } }, create: { organizacionId, clienteId, sedeId: r.sedeId }, update: {} });
    await auditar(tx, organizacionId, actorId, "reserva.cliente_asignado", "Reserva", reservaId, { clienteId, sinFicha: !!actual.clienteProvisional });
  });
}
