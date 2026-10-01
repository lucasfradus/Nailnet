import { AccesoDenegado } from "@nailnet/domain";
import { aUtc, validarFecha } from "@nailnet/domain/agenda";
import { aCentavos } from "@nailnet/domain/catalogo";
import { asignarEn } from "@nailnet/domain/disponibilidad";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, exigirIds, sedesConPermiso } from "./access.ts";
import { configuracionEfectiva } from "./configuracion.ts";
import { cargarConsulta, reservaActiva, type Pedido } from "./disponibilidad.ts";

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

export async function registrarEvento(tx: Tx, organizacionId: string, reservaId: string, tipo: "CREADA" | "CONFIRMADA" | "EXPIRADA" | "CANCELADA" | "REPROGRAMADA" | "ATENDIDA" | "AUSENTE", estadoAnterior: Estado | null, estadoNuevo: Estado, actorId: string | null, detalle?: Prisma.InputJsonValue) {
  await tx.reservaEvento.create({ data: { organizacionId, reservaId, tipo, estadoAnterior, estadoNuevo, actorId, detalle } });
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
export async function tomarTurno(db: Database, actorId: string | null, organizacionId: string, pedido: Pedido & { inicio: Date; clienteId?: string | null; notas?: string | null }, ahora = new Date()): Promise<TurnoTomado> {
  if (actorId) {
    exigirIds(pedido.sedeId);
    const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
    if (!ids.has(pedido.sedeId)) throw new AccesoDenegado();
  } else if (pedido.canal !== "ONLINE") throw new AccesoDenegado();
  exigirIds(pedido.clienteId);
  if (pedido.canal === "RECEPCION" && !pedido.clienteId) throw new DatosInvalidos("Elegí el cliente del turno");
  if (Number.isNaN(pedido.inicio.getTime())) throw new DatosInvalidos("Horario inválido");
  const notas = pedido.notas?.trim().slice(0, 1000) || null;

  // Primera pasada sin locks: solo para saber qué filas bloquear.
  const previa = await cargarConsulta(db, organizacionId, pedido, ahora);
  const profesionales = ordenar(previa.consulta.items.flatMap(i => i.candidatos));
  const recursos = ordenar(previa.consulta.recursos.map(r => r.id));

  return conReintento(() => db.$transaction(async tx => {
    await bloquearAgenda(tx, profesionales, recursos);
    const config = await configuracionEfectiva(tx, organizacionId, pedido.sedeId);
    if (pedido.clienteId && !await tx.cliente.count({ where: { id: pedido.clienteId, organizacionId } })) throw new AccesoDenegado();
    await expirarVencidas(tx, organizacionId, profesionales, ahora);

    // Revalidación bajo lock con exactamente las mismas reglas que la consulta pública.
    const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, ahora, { profesionales: new Set(profesionales), recursos: new Set(recursos) });
    const turno = asignarEn(consulta, pedido.inicio.getTime());
    if (!turno) throw new TurnoNoDisponible();

    const senaTotal = turno.items.reduce((t, i) => t + (aCentavos(efectivos.get(i.servicioId)!.sena ?? "0") ?? 0n), 0n);
    const exigeSena = senaTotal > 0n && (pedido.canal === "ONLINE" || config.recepcionExigeSena);
    const estado: Estado = exigeSena ? "PENDIENTE_PAGO" : "CONFIRMADA";
    const expiraEn = exigeSena ? new Date(ahora.getTime() + config.retencionMinutos.valor! * 60_000) : null;

    const r = await escribirTurno(tx, organizacionId, { sedeId: pedido.sedeId, clienteId: pedido.clienteId ?? null, canal: pedido.canal, estado, expiraEn, notas, creadoPor: actorId }, turno, efectivos);
    await registrarEvento(tx, organizacionId, r.reservaId, "CREADA", null, estado, actorId, { canal: pedido.canal, exigeSena });
    return r;
  }, { maxWait: 10_000, timeout: 20_000 }));
}


type Asignado = NonNullable<ReturnType<typeof asignarEn>>;
type Efectivos = Awaited<ReturnType<typeof cargarConsulta>>["efectivos"];
/** Escribe reserva, ítems y recursos. `congelados` (por posición) conserva precio y seña de una reserva anterior. */
async function escribirTurno(tx: Tx, organizacionId: string, base: { sedeId: string; clienteId: string | null; canal: "ONLINE" | "RECEPCION"; estado: Estado; expiraEn: Date | null; notas: string | null; creadoPor: string | null; reemplazaId?: string }, turno: Asignado, efectivos: Efectivos, congelados?: Map<number, { precio: string; sena: string | null }>): Promise<TurnoTomado> {
  const reserva = await tx.reserva.create({ data: { organizacionId, ...base }, select: { id: true } });
  if (base.clienteId) await tx.clienteSede.upsert({ where: { clienteId_sedeId: { clienteId: base.clienteId, sedeId: base.sedeId } }, create: { organizacionId, clienteId: base.clienteId, sedeId: base.sedeId }, update: {} });
  const items: TurnoTomado["items"] = [];
  for (const [posicion, it] of turno.items.entries()) {
    const e = efectivos.get(it.servicioId)!;
    const precio = congelados?.get(posicion)?.precio ?? e.precio!, sena = congelados ? congelados.get(posicion)?.sena ?? null : e.sena;
    const item = await tx.reservaItem.create({ data: {
      organizacionId, reservaId: reserva.id, posicion, servicioId: it.servicioId, profesionalId: it.profesionalId,
      inicio: new Date(it.inicio), fin: new Date(it.fin), ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta),
      // Snapshots: cambios posteriores de precio, duración o seña no alteran este turno.
      duracionMinutos: e.duracionMinutos, bufferAntesMinutos: e.bufferAntesMinutos, bufferDespuesMinutos: e.bufferDespuesMinutos, precio, sena,
    }, select: { id: true } });
    if (it.recursoIds.length) await tx.reservaItemRecurso.createMany({ data: it.recursoIds.map(recursoId => ({ organizacionId, itemId: item.id, recursoId, ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta) })) });
    items.push({ servicioId: it.servicioId, profesionalId: it.profesionalId, inicio: new Date(it.inicio), fin: new Date(it.fin), recursoIds: it.recursoIds, precio, sena });
  }
  return { reservaId: reserva.id, estado: base.estado, expiraEn: base.expiraEn, items };
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
      reserva: { select: { id: true, estado: true, canal: true, expiraEn: true, notas: true, cliente: { select: { id: true, nombre: true, apellido: true, telefono: true } } } },
      servicio: { select: { nombre: true } }, profesional: { select: { id: true, nombre: true, apellido: true } },
      recursos: { select: { recurso: { select: { nombre: true } } } },
    },
    orderBy: [{ inicio: "asc" }, { posicion: "asc" }],
  });
  return { timezone: sede.timezone, items: items.map(i => ({
    itemId: i.id, reservaId: i.reservaId, posicion: i.posicion, inicio: i.inicio, fin: i.fin,
    estado: i.reserva.estado, canal: i.reserva.canal, expiraEn: i.reserva.expiraEn, notas: i.reserva.notas,
    cliente: i.reserva.cliente, servicio: i.servicio.nombre, profesional: i.profesional, recursos: i.recursos.map(r => r.recurso.nombre),
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
  const actual = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { estado: true, expiraEn: true } });
  return { ...reserva, estado: actual.estado as Estado, expiraEn: actual.expiraEn };
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

/** Atención registrada: solo turnos confirmados, desde una hora antes del inicio y con los consentimientos exigidos vigentes. */
export async function marcarAtendida(db: Database, actorId: string, organizacionId: string, reservaId: string, ahora = new Date()) {
  await db.$transaction(async tx => {
    const r = await reservaParaOperar(tx, actorId, organizacionId, reservaId);
    if (r.estado !== "CONFIRMADA") throw new DatosInvalidos(`No se puede marcar atendido un turno ${ETIQUETA[r.estado]}`);
    if (ahora.getTime() < r.items[0]!.inicio.getTime() - 3_600_000) throw new DatosInvalidos("Todavía falta más de una hora para el turno");
    const exigidos = await tx.servicioConsentimiento.findMany({ where: { servicioId: { in: r.items.map(i => i.servicioId) } }, select: { clave: true } });
    if (exigidos.length) {
      if (!r.clienteId) throw new DatosInvalidos("El turno no tiene cliente para verificar los consentimientos");
      const faltan: string[] = [];
      for (const clave of new Set(exigidos.map(e => e.clave))) {
        const vigente = await tx.consentimientoVersion.findFirst({ where: { organizacionId, clave }, orderBy: { version: "desc" } });
        const ultimo = await tx.clienteConsentimiento.findFirst({ where: { clienteId: r.clienteId, version: { clave } }, orderBy: { orden: "desc" } });
        if (!vigente || !ultimo || ultimo.accion !== "ACEPTA" || ultimo.versionId !== vigente.id) faltan.push(vigente?.titulo ?? clave);
      }
      if (faltan.length) throw new DatosInvalidos(`Falta el consentimiento vigente: ${faltan.join(", ")}. Registralo en la ficha del cliente.`);
    }
    await transicion(tx, organizacionId, reservaId, "CONFIRMADA", "ATENDIDA", "ATENDIDA", actorId);
  });
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
 */
export async function reprogramarReserva(db: Database, actorId: string, organizacionId: string, reservaId: string, destino: { fecha: string; inicio: Date; profesionales?: (string | null)[] }, ahora = new Date()) {
  exigirIds(reservaId, ...(destino.profesionales ?? []));
  const original = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, include: { items: { include: { recursos: true }, orderBy: { posicion: "asc" } } } });
  if (!original) throw new AccesoDenegado();
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(original.sedeId)) throw new AccesoDenegado();
  if (Number.isNaN(destino.inicio.getTime())) throw new DatosInvalidos("Horario inválido");
  // El personal reprograma con reglas de recepción (sin anticipación ni horizonte online).
  const pedido: Pedido = { sedeId: original.sedeId, fecha: destino.fecha, canal: "RECEPCION", items: original.items.map((it, i) => ({ servicioId: it.servicioId, profesionalId: destino.profesionales?.[i] ?? null })) };
  const previa = await cargarConsulta(db, organizacionId, pedido, ahora);
  const profesionales = ordenar([...previa.consulta.items.flatMap(i => i.candidatos), ...original.items.map(i => i.profesionalId)]);
  const recursos = ordenar([...previa.consulta.recursos.map(r => r.id), ...original.items.flatMap(i => i.recursos.map(r => r.recursoId))]);

  return conReintento(() => db.$transaction(async tx => {
    await bloquearAgenda(tx, profesionales, recursos);
    const actual = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, select: { estado: true } });
    if (actual.estado !== "CONFIRMADA") throw new DatosInvalidos(`Solo se reprograman turnos confirmados; este está ${ETIQUETA[actual.estado as Estado]}`);
    // Se libera primero dentro de la transacción para que el nuevo horario pueda solaparse con el viejo.
    const { count } = await tx.reserva.updateMany({ where: { id: reservaId, estado: "CONFIRMADA" }, data: { estado: "CANCELADA" } });
    if (count !== 1) throw new DatosInvalidos("El turno cambió mientras tanto; actualizá la agenda");
    const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, ahora, { profesionales: new Set(profesionales), recursos: new Set(recursos) });
    const turno = asignarEn(consulta, destino.inicio.getTime());
    if (!turno) throw new TurnoNoDisponible();
    const congelados = new Map(original.items.map(i => [i.posicion, { precio: i.precio.toFixed(2), sena: i.sena?.toFixed(2) ?? null }]));
    const nueva = await escribirTurno(tx, organizacionId, { sedeId: original.sedeId, clienteId: original.clienteId, canal: original.canal, estado: "CONFIRMADA", expiraEn: null, notas: original.notas, creadoPor: actorId, reemplazaId: original.id }, turno, efectivos, congelados);
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
  return { id: r.id, sedeId: r.sedeId, estado: r.estado as Estado, clienteId: r.clienteId, cliente: r.cliente, items: r.items.map(i => ({ servicioId: i.servicioId, servicio: i.servicio.nombre, profesionalId: i.profesionalId, inicio: i.inicio })) };
}
