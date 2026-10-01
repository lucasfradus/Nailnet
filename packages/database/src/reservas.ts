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

    const reserva = await tx.reserva.create({ data: { organizacionId, sedeId: pedido.sedeId, clienteId: pedido.clienteId ?? null, canal: pedido.canal, estado, expiraEn, notas, creadoPor: actorId }, select: { id: true } });
    if (pedido.clienteId) await tx.clienteSede.upsert({ where: { clienteId_sedeId: { clienteId: pedido.clienteId, sedeId: pedido.sedeId } }, create: { organizacionId, clienteId: pedido.clienteId, sedeId: pedido.sedeId }, update: {} });
    const items: TurnoTomado["items"] = [];
    for (const [posicion, it] of turno.items.entries()) {
      const e = efectivos.get(it.servicioId)!;
      const item = await tx.reservaItem.create({ data: {
        organizacionId, reservaId: reserva.id, posicion, servicioId: it.servicioId, profesionalId: it.profesionalId,
        inicio: new Date(it.inicio), fin: new Date(it.fin), ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta),
        // Snapshots: cambios posteriores de precio, duración o seña no alteran este turno.
        duracionMinutos: e.duracionMinutos, bufferAntesMinutos: e.bufferAntesMinutos, bufferDespuesMinutos: e.bufferDespuesMinutos,
        precio: e.precio!, sena: e.sena,
      }, select: { id: true } });
      if (it.recursoIds.length) await tx.reservaItemRecurso.createMany({ data: it.recursoIds.map(recursoId => ({ organizacionId, itemId: item.id, recursoId, ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta) })) });
      items.push({ servicioId: it.servicioId, profesionalId: it.profesionalId, inicio: new Date(it.inicio), fin: new Date(it.fin), recursoIds: it.recursoIds, precio: e.precio!, sena: e.sena });
    }
    await registrarEvento(tx, organizacionId, reserva.id, "CREADA", null, estado, actorId, { canal: pedido.canal, exigeSena });
    return { reservaId: reserva.id, estado, expiraEn, items };
  }, { maxWait: 10_000, timeout: 20_000 }));
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
