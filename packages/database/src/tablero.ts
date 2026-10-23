import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc } from "@nailnet/domain/agenda";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, exigirIds, sedesConPermiso } from "./access.ts";
import { reservaActiva } from "./disponibilidad.ts";

// Tablero de recepción (doc 29, D20): quién está en el local, quién está libre y para qué, quién atiende a
// quién y qué falta cobrar. Las profesionales no usan el celular en el salón: todo lo marca recepción.

async function exigirSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  exigirIds(sedeId);
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(sedeId)) throw new AccesoDenegado();
}

const YA_PRESENTE = "Ya está marcada como presente";

/** La profesional llegó al local. Una sola presencia abierta por profesional, en cualquier sede. */
export async function registrarEntrada(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; profesionalId: string }, ahora = new Date()) {
  exigirIds(datos.profesionalId);
  await exigirSede(db, actorId, organizacionId, datos.sedeId);
  const vinculo = await db.profesionalSede.count({ where: { organizacionId, sedeId: datos.sedeId, profesionalId: datos.profesionalId, activo: true, profesional: { activo: true } } });
  if (!vinculo) throw new DatosInvalidos("La profesional no trabaja en esta sede");
  const abierta = await db.presenciaProfesional.findFirst({ where: { organizacionId, profesionalId: datos.profesionalId, salida: null }, select: { sedeId: true, sede: { select: { nombre: true } } } });
  if (abierta) throw new DatosInvalidos(abierta.sedeId === datos.sedeId ? YA_PRESENTE : `Está marcada como presente en ${abierta.sede.nombre}: marcá primero la salida allá`);
  try {
    return await db.presenciaProfesional.create({ data: { organizacionId, sedeId: datos.sedeId, profesionalId: datos.profesionalId, entrada: ahora, entradaPorId: actorId }, select: { id: true } });
  } catch (e) {
    // Dos recepcionistas a la vez: el índice parcial deja pasar una sola.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos(YA_PRESENTE);
    throw e;
  }
}

/** La profesional se fue (fin de su turno o del día). No se puede con una clienta en atención. */
export async function registrarSalida(db: Database, actorId: string, organizacionId: string, presenciaId: string, ahora = new Date()) {
  exigirIds(presenciaId);
  const p = await db.presenciaProfesional.findFirst({ where: { id: presenciaId, organizacionId }, select: { sedeId: true, profesionalId: true, salida: true, entrada: true } });
  if (!p) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, p.sedeId);
  if (p.salida) throw new DatosInvalidos("La salida ya está marcada");
  const atendiendo = await db.reserva.count({ where: { organizacionId, estado: "CONFIRMADA", iniciadaEn: { not: null }, items: { some: { profesionalId: p.profesionalId, terminadoEn: null } } } });
  if (atendiendo) throw new DatosInvalidos("Tiene una clienta en atención: marcá «Terminó» antes de la salida");
  const { count } = await db.presenciaProfesional.updateMany({ where: { id: presenciaId, salida: null }, data: { salida: ahora < p.entrada ? p.entrada : ahora, salidaPorId: actorId } });
  if (count !== 1) throw new DatosInvalidos("La salida ya está marcada");
}

/**
 * Etapa 3 (doc 29): la clienta espera porque no hay nadie libre. Datos mínimos para no frenar la cola: el
 * cliente se busca o se crea al atenderla. Los servicios tienen que estar habilitados en la sede y la
 * profesional pedida, trabajar en ella.
 */
export async function agregarEspera(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; nombre: string; telefono?: string | null; servicioIds: string[]; profesionalId?: string | null; notas?: string | null }, ahora = new Date()) {
  const servicioIds = [...new Set(datos.servicioIds.filter(Boolean))];
  exigirIds(datos.profesionalId, ...servicioIds);
  await exigirSede(db, actorId, organizacionId, datos.sedeId);
  const nombre = datos.nombre.trim().slice(0, 80);
  if (!nombre) throw new DatosInvalidos("Indicá el nombre de la clienta");
  if (!servicioIds.length || servicioIds.length > 3) throw new DatosInvalidos("Elegí entre 1 y 3 servicios");
  const habilitados = await db.servicioSede.count({ where: { organizacionId, sedeId: datos.sedeId, servicioId: { in: servicioIds }, habilitado: true, servicio: { activo: true } } });
  if (habilitados !== servicioIds.length) throw new DatosInvalidos("Hay un servicio que no está disponible en esta sede");
  if (datos.profesionalId && !await db.profesionalSede.count({ where: { organizacionId, sedeId: datos.sedeId, profesionalId: datos.profesionalId, activo: true } })) throw new DatosInvalidos("La profesional no trabaja en esta sede");
  return db.esperaRecepcion.create({ data: {
    organizacionId, sedeId: datos.sedeId, nombre, telefono: datos.telefono?.trim().slice(0, 40) || null, servicioIds, profesionalId: datos.profesionalId || null,
    notas: datos.notas?.trim().slice(0, 300) || null, llegada: ahora, estado: "ESPERANDO", registradaPorId: actorId,
  }, select: { id: true } });
}

/** La clienta se fue sin ser atendida. */
export async function esperaSeFue(db: Database, actorId: string, organizacionId: string, esperaId: string, ahora = new Date()) {
  exigirIds(esperaId);
  const e = await db.esperaRecepcion.findFirst({ where: { id: esperaId, organizacionId }, select: { sedeId: true, llegada: true } });
  if (!e) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, e.sedeId);
  const { count } = await db.esperaRecepcion.updateMany({ where: { id: esperaId, estado: "ESPERANDO" }, data: { estado: "SE_FUE", cerradaEn: ahora < e.llegada ? e.llegada : ahora, cerradaPorId: actorId } });
  if (count !== 1) throw new DatosInvalidos("Esa clienta ya no está en la lista de espera");
}

const POR_LLEGAR_MS = 2 * 3_600_000;
const POR_COBRAR_DIAS = 7;
type ClienteBreve = { id: string; nombre: string; apellido: string | null } | null;

/**
 * Estado del local ahora. Por profesional activa de la sede: presencia, servicios que puede hacer,
 * atención en curso y próximo turno reservado (en cualquier sede, porque la ocupa igual). Además, los
 * turnos de la sede por llegar (dos horas antes y después, sin marcar la llegada) y las atenciones
 * terminadas sin venta (últimos siete días), que son las comandas por cobrar.
 */
export async function tableroSede(db: Database, actorId: string, organizacionId: string, sedeId: string, ahora = new Date()) {
  await exigirSede(db, actorId, organizacionId, sedeId);
  const sede = await db.sede.findUniqueOrThrow({ where: { id: sedeId }, select: { timezone: true } });
  const tz = sede.timezone;
  const finDia = aUtc(aLocal(ahora, tz).fecha, 1440, tz);

  const profesionales = await db.profesional.findMany({
    where: { organizacionId, activo: true, sedes: { some: { sedeId, activo: true } } },
    select: { id: true, nombre: true, apellido: true, servicios: { select: { servicioId: true } }, skills: { select: { skillId: true } } },
    orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
  });
  const ids = profesionales.map(p => p.id);
  const servicios = await db.servicioSede.findMany({
    where: { organizacionId, sedeId, habilitado: true, servicio: { activo: true } },
    select: { duracionMinutos: true, servicio: { select: { id: true, nombre: true, duracionMinutos: true, skills: { select: { skillId: true } } } } },
    orderBy: { servicio: { nombre: "asc" } },
  });
  // Mismo criterio que el motor: habilitada para el servicio y con todas sus habilidades.
  const puede = (p: (typeof profesionales)[number], s: (typeof servicios)[number]) =>
    p.servicios.some(x => x.servicioId === s.servicio.id) && s.servicio.skills.every(k => p.skills.some(x => x.skillId === k.skillId));

  // Secuencial a propósito, como en la disponibilidad: comparten conexión.
  const presencias = await db.presenciaProfesional.findMany({ where: { organizacionId, profesionalId: { in: ids }, salida: null }, select: { id: true, sedeId: true, profesionalId: true, entrada: true, sede: { select: { nombre: true } } } });
  // Turnos que todavía no empezaron y la ocupan hoy: el primero dice hasta cuándo está libre.
  const reservados = await db.reservaItem.findMany({
    where: { organizacionId, profesionalId: { in: ids }, ocupaHasta: { gt: ahora }, ocupaDesde: { lt: finDia }, reserva: { AND: [reservaActiva(ahora), { estado: { notIn: ["ATENDIDA", "AUSENTE"] }, iniciadaEn: null }] } },
    select: { profesionalId: true, inicio: true, ocupaDesde: true, servicio: { select: { nombre: true } }, reserva: { select: { id: true, sedeId: true, cliente: { select: { id: true, nombre: true, apellido: true } } } } },
    orderBy: { ocupaDesde: "asc" },
  });
  // Una atención en curso sigue ocupando a la profesional aunque se haya pasado del horario estimado.
  const enCurso = await db.reservaItem.findMany({
    where: { organizacionId, profesionalId: { in: ids }, terminadoEn: null, reserva: { estado: "CONFIRMADA", iniciadaEn: { not: null } } },
    select: { profesionalId: true, fin: true, servicio: { select: { nombre: true } }, reserva: { select: { id: true, sedeId: true, iniciadaEn: true, cliente: { select: { id: true, nombre: true, apellido: true } } } } },
    orderBy: { inicio: "asc" },
  });

  const filas = profesionales.map(p => {
    const presencia = presencias.find(x => x.profesionalId === p.id);
    const propios = enCurso.filter(i => i.profesionalId === p.id);
    const reservaId = propios[0]?.reserva.id;
    const atencion = propios.filter(i => i.reserva.id === reservaId);
    const proximo = reservados.find(i => i.profesionalId === p.id);
    return {
      id: p.id, nombre: [p.nombre, p.apellido].filter(Boolean).join(" "),
      servicioIds: servicios.filter(s => puede(p, s)).map(s => s.servicio.id),
      presencia: presencia ? { id: presencia.id, entrada: presencia.entrada, otraSede: presencia.sedeId === sedeId ? null : presencia.sede.nombre } : null,
      atencion: reservaId ? {
        reservaId, enOtraSede: atencion[0]!.reserva.sedeId !== sedeId, cliente: atencion[0]!.reserva.cliente as ClienteBreve,
        servicios: atencion.map(i => i.servicio.nombre), desde: atencion[0]!.reserva.iniciadaEn!, finEstimado: atencion.at(-1)!.fin,
      } : null,
      // Desde cuándo deja de estar libre: el próximo turno reservado, con su preparación.
      proximo: proximo ? { reservaId: proximo.reserva.id, inicio: proximo.inicio, ocupaDesde: proximo.ocupaDesde, servicio: proximo.servicio.nombre, cliente: proximo.reserva.cliente as ClienteBreve, otraSede: proximo.reserva.sedeId !== sedeId } : null,
    };
  });

  const porLlegar = await db.reserva.findMany({
    where: { organizacionId, sedeId, estado: "CONFIRMADA", iniciadaEn: null, items: { some: { posicion: 0, inicio: { lt: new Date(ahora.getTime() + POR_LLEGAR_MS), gte: new Date(ahora.getTime() - POR_LLEGAR_MS) } } } },
    select: { id: true, cliente: { select: { id: true, nombre: true, apellido: true } }, items: { orderBy: { posicion: "asc" }, select: { inicio: true, fin: true, servicio: { select: { nombre: true } }, profesional: { select: { nombre: true, apellido: true } } } } },
  });
  const porCobrar = await db.reserva.findMany({
    where: { organizacionId, sedeId, estado: "ATENDIDA", ventas: { none: { estado: { not: "ANULADA" } } }, items: { some: { posicion: 0, inicio: { gte: new Date(ahora.getTime() - POR_COBRAR_DIAS * 86_400_000) } } } },
    select: { id: true, terminadaEn: true, cliente: { select: { id: true, nombre: true, apellido: true } }, items: { orderBy: { posicion: "asc" }, select: { inicio: true, fin: true, servicio: { select: { nombre: true } }, profesional: { select: { nombre: true, apellido: true } } } } },
    take: 100,
  });
  // Etapa 3: la lista de espera de hoy, por orden de llegada. Una espera olvidada de otro día no se muestra.
  const esperas = await db.esperaRecepcion.findMany({
    where: { organizacionId, sedeId, estado: "ESPERANDO", llegada: { gte: aUtc(aLocal(ahora, tz).fecha, 0, tz) } },
    select: { id: true, nombre: true, telefono: true, servicioIds: true, profesionalId: true, notas: true, llegada: true }, orderBy: { llegada: "asc" },
  });
  const nombre = (p: { nombre: string; apellido: string | null }) => [p.nombre, p.apellido].filter(Boolean).join(" ");
  const resumen = (r: (typeof porLlegar)[number]) => ({
    reservaId: r.id, cliente: r.cliente as ClienteBreve, inicio: r.items[0]!.inicio,
    servicios: r.items.map(i => `${i.servicio.nombre} · ${nombre(i.profesional)}`),
  });

  return {
    timezone: tz,
    servicios: servicios.map(s => ({ id: s.servicio.id, nombre: s.servicio.nombre, duracionMinutos: s.duracionMinutos ?? s.servicio.duracionMinutos })),
    profesionales: filas,
    porLlegar: porLlegar.map(resumen).sort((a, b) => a.inicio.getTime() - b.inicio.getTime()),
    esperas,
    porCobrar: porCobrar.map(r => ({ ...resumen(r), terminadaEn: r.terminadaEn ?? r.items.at(-1)!.fin }))
      .sort((a, b) => a.terminadaEn.getTime() - b.terminadaEn.getTime()),
  };
}
