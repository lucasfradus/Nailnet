import { AccesoDenegado, tienePermiso, type Permiso } from "@nailnet/domain";
import { aLocal, aUtc, diaSemana, formatearRangos, fueraDe, parsearRangos, solapan, validarFecha, vigenciasSeCruzan, type Rango } from "@nailnet/domain/agenda";
import { aIntervalos, aperturaDelDia, jornadaDelDia, ocupacionDelDia } from "@nailnet/domain/disponibilidad";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, exigirIds, sedesConPermiso } from "./access.ts";
import { reservaActiva } from "./disponibilidad.ts";
import { borrarImagenHuerfana, insertarImagen, procesarImagen } from "./imagenes.ts";

type Tx = Prisma.TransactionClient;
export type Semana = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, Rango[]>>;
const DIAS = [0, 1, 2, 3, 4, 5, 6] as const;
const NOMBRE_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const fechaDb = (f: string | null) => (f === null ? null : new Date(`${f}T00:00:00Z`));
const fechaTexto = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));

function nombre(valor: string, campo = "Nombre") {
  const n = valor.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!n || n.length > 80) throw new DatosInvalidos(`${campo} inválido`);
  return n;
}
/** «09:00-13:00, 14:00-20:00» por día → Semana validada. */
export function semanaDesdeTextos(textos: Partial<Record<number, string>>): Semana {
  const semana: Semana = {};
  for (const d of DIAS) {
    const r = parsearRangos(textos[d] ?? "");
    if ("error" in r) throw new DatosInvalidos(`${NOMBRE_DIA[d]}: ${r.error}`);
    if (r.rangos.length) semana[d] = r.rangos;
  }
  return semana;
}
function filasSemana(semana: Semana) {
  return DIAS.flatMap(d => (semana[d] ?? []).map(r => ({ diaSemana: d, inicioMinutos: r.inicio, finMinutos: r.fin })));
}
function agruparSemana(filas: { diaSemana: number; inicioMinutos: number; finMinutos: number }[]): Semana {
  const s: Semana = {};
  for (const f of filas) (s[f.diaSemana as 0] ??= []).push({ inicio: f.inicioMinutos, fin: f.finMinutos });
  for (const d of DIAS) s[d]?.sort((a, b) => a.inicio - b.inicio);
  return s;
}

async function horarioDeSede(db: Database | Tx, sedeId: string) {
  return agruparSemana(await db.horarioSede.findMany({ where: { sedeId, vigenteDesde: null, vigenteHasta: null } }));
}
/** La jornada de un profesional en una sede tiene que caer dentro del horario de atención de esa sede. */
async function exigirDentroDeSede(tx: Tx, sedeId: string, semana: Semana) {
  const sede = await horarioDeSede(tx, sedeId);
  for (const d of DIAS) {
    const fuera = fueraDe(semana[d] ?? [], sede[d] ?? []);
    if (!fuera.length) continue;
    throw new DatosInvalidos(sede[d]?.length
      ? `${NOMBRE_DIA[d]}: ${formatearRangos(fuera)} queda fuera del horario de la sede (${formatearRangos(sede[d])})`
      : `${NOMBRE_DIA[d]}: la sede no atiende ese día`);
  }
}

// Serializa cambios de agenda de un profesional con el mismo lock de fila que usan las retenciones
// de turnos (reservas.ts): jornadas, ausencias y reservas no se pisan entre sí.
async function bloquearProfesional(tx: Tx, profesionalId: string) {
  exigirIds(profesionalId);
  await tx.$queryRaw`SELECT id FROM "Profesional" WHERE id = ${profesionalId}::uuid FOR UPDATE`;
}

/**
 * Un profesional se administra desde cualquiera de sus sedes dentro del alcance del actor
 * (o desde el alcance organizacional). Sus datos son de la organización: no hay copia por sede.
 */
async function contextoProfesional(db: Database | Tx, actorId: string, organizacionId: string, profesionalId: string, permiso: Permiso) {
  exigirIds(profesionalId);
  const r = await sedesConPermiso(db, actorId, organizacionId, permiso);
  const prof = await db.profesional.findFirst({ where: { id: profesionalId, organizacionId }, include: { sedes: true } });
  if (!prof) throw new AccesoDenegado();
  const visibles = prof.sedes.filter(s => r.ids.has(s.sedeId));
  if (!visibles.length && !r.organizacional) throw new AccesoDenegado();
  return { ...r, prof, visibles };
}

export async function listarProfesionales(db: Database, actorId: string, organizacionId: string, filtro: { sedeId?: string } = {}) {
  exigirIds(filtro.sedeId);
  const { ids, sedes, organizacional } = await sedesConPermiso(db, actorId, organizacionId, "sede:leer");
  if (!ids.size) throw new AccesoDenegado();
  if (filtro.sedeId && !ids.has(filtro.sedeId)) throw new AccesoDenegado();
  const alcance = filtro.sedeId ? [filtro.sedeId] : [...ids];
  const profesionales = await db.profesional.findMany({
    where: { organizacionId, ...(organizacional && !filtro.sedeId ? {} : { sedes: { some: { sedeId: { in: alcance } } } }) },
    include: { sedes: { where: { sedeId: { in: [...ids] } } }, skills: { include: { skill: true } } },
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  const nombres = new Map(sedes.map(s => [s.id, s.nombre]));
  return profesionales.map(p => ({
    id: p.id, nombre: p.nombre, apellido: p.apellido, activo: p.activo,
    sedes: p.sedes.map(s => ({ nombre: nombres.get(s.sedeId)!, activo: s.activo })),
    skills: p.skills.map(s => s.skill.nombre),
  }));
}

/** Alta en una sede. La jornada inicial es opcional y debe caer dentro del horario de la sede. */
export async function crearProfesional(db: Database, actorId: string, organizacionId: string, sedeId: string, datos: { nombre: string; apellido?: string | null; semana?: Semana }) {
  exigirIds(sedeId);
  const n = nombre(datos.nombre), a = datos.apellido?.trim() ? nombre(datos.apellido, "Apellido") : null;
  return db.$transaction(async tx => {
    const { ids } = await sedesConPermiso(tx, actorId, organizacionId, "profesional:administrar");
    if (!ids.has(sedeId)) throw new AccesoDenegado();
    if (datos.semana) await exigirDentroDeSede(tx, sedeId, datos.semana);
    const p = await tx.profesional.create({ data: { organizacionId, nombre: n, apellido: a, sedes: { create: { sedeId } } }, select: { id: true } });
    if (datos.semana) await tx.horarioProfesional.createMany({ data: filasSemana(datos.semana).map(f => ({ organizacionId, profesionalId: p.id, sedeId, ...f })) });
    await auditar(tx, organizacionId, actorId, "profesional.crear", "Profesional", p.id, { sedeId });
    return p;
  });
}

export async function obtenerProfesional(db: Database, actorId: string, organizacionId: string, profesionalId: string) {
  const { prof, visibles, sedes } = await contextoProfesional(db, actorId, organizacionId, profesionalId, "sede:leer");
  const admin = await sedesConPermiso(db, actorId, organizacionId, "profesional:administrar");
  const [skills, servicios, horarios, bloqueos, horariosSede] = await Promise.all([
    db.profesionalSkill.findMany({ where: { profesionalId }, select: { skillId: true } }),
    db.profesionalServicio.findMany({ where: { profesionalId }, select: { servicioId: true } }),
    db.horarioProfesional.findMany({ where: { profesionalId, sedeId: { in: visibles.map(v => v.sedeId) } }, orderBy: [{ diaSemana: "asc" }, { inicioMinutos: "asc" }] }),
    db.bloqueoAgenda.findMany({ where: { profesionalId, fin: { gt: new Date() } }, orderBy: { inicio: "asc" }, take: 50 }),
    db.horarioSede.findMany({ where: { sedeId: { in: visibles.map(v => v.sedeId) }, vigenteDesde: null, vigenteHasta: null } }),
  ]);
  const nombres = new Map(sedes.map(s => [s.id, s.nombre]));
  const editable = visibles.some(v => admin.ids.has(v.sedeId)) || admin.organizacional;
  return {
    id: prof.id, nombre: prof.nombre, apellido: prof.apellido, activo: prof.activo, fotoId: prof.fotoId, editable,
    // Las sedes de otros alcances no se nombran: solo se informa que existen.
    otrasSedes: prof.sedes.length - visibles.length,
    sedes: visibles.map(v => ({
      sedeId: v.sedeId, nombre: nombres.get(v.sedeId)!, activo: v.activo, editable: admin.ids.has(v.sedeId),
      semana: agruparSemana(horarios.filter(h => h.sedeId === v.sedeId && h.vigenteDesde === null && h.vigenteHasta === null)),
      // Horario de atención de la sede: límite y valor sugerido al editar la jornada.
      horarioSede: agruparSemana(horariosSede.filter(h => h.sedeId === v.sedeId)),
    })),
    skillIds: skills.map(s => s.skillId), servicioIds: servicios.map(s => s.servicioId),
    bloqueos: bloqueos.map(b => ({ id: b.id, inicio: b.inicio, fin: b.fin, motivo: b.motivo })),
  };
}

export async function actualizarProfesional(db: Database, actorId: string, organizacionId: string, profesionalId: string, datos: { nombre: string; apellido?: string | null; activo: boolean }) {
  const n = nombre(datos.nombre), a = datos.apellido?.trim() ? nombre(datos.apellido, "Apellido") : null;
  await db.$transaction(async tx => {
    await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
    await tx.profesional.update({ where: { id: profesionalId }, data: { nombre: n, apellido: a, activo: datos.activo } });
    await auditar(tx, organizacionId, actorId, "profesional.actualizar", "Profesional", profesionalId, { activo: datos.activo });
  });
}

/** Reemplaza (o quita, con null) la foto pública. Se procesa antes de abrir la transacción. */
export async function guardarFotoProfesional(db: Database, actorId: string, organizacionId: string, profesionalId: string, archivo: Uint8Array | null) {
  const foto = archivo ? await procesarImagen(archivo, "RETRATO") : null;
  await db.$transaction(async tx => {
    const { prof } = await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
    const fotoId = foto ? await insertarImagen(tx, organizacionId, actorId, foto) : null;
    await tx.profesional.update({ where: { id: profesionalId }, data: { fotoId } });
    await borrarImagenHuerfana(tx, prof.fotoId);
    await auditar(tx, organizacionId, actorId, foto ? "profesional.foto" : "profesional.foto.quitar", "Profesional", profesionalId, fotoId ? { fotoId } : undefined);
  });
}

/** Vincular a otra sede exige administrar al profesional y también la sede destino. */
export async function vincularSede(db: Database, actorId: string, organizacionId: string, profesionalId: string, sedeId: string, activo: boolean) {
  exigirIds(sedeId);
  await db.$transaction(async tx => {
    await bloquearProfesional(tx, profesionalId);
    const { ids } = await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
    if (!ids.has(sedeId)) throw new AccesoDenegado();
    await tx.profesionalSede.upsert({ where: { profesionalId_sedeId: { profesionalId, sedeId } }, create: { organizacionId, profesionalId, sedeId, activo }, update: { activo } });
    await auditar(tx, organizacionId, actorId, activo ? "profesional.sede.activar" : "profesional.sede.desactivar", "Profesional", profesionalId, { sedeId });
  });
}

/** Skills y servicios habilitados son atributos del profesional en toda la organización. */
export async function guardarHabilidades(db: Database, actorId: string, organizacionId: string, profesionalId: string, datos: { skillIds: string[]; servicioIds: string[] }) {
  exigirIds(...datos.skillIds, ...datos.servicioIds);
  try {
    await db.$transaction(async tx => {
      await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
      await tx.profesionalSkill.deleteMany({ where: { profesionalId } });
      await tx.profesionalServicio.deleteMany({ where: { profesionalId } });
      await tx.profesionalSkill.createMany({ data: [...new Set(datos.skillIds)].map(skillId => ({ organizacionId, profesionalId, skillId })) });
      await tx.profesionalServicio.createMany({ data: [...new Set(datos.servicioIds)].map(servicioId => ({ organizacionId, profesionalId, servicioId })) });
      await auditar(tx, organizacionId, actorId, "profesional.habilidades", "Profesional", profesionalId, { skills: datos.skillIds.length, servicios: datos.servicioIds.length });
    });
  } catch (e) {
    // FK compuestas: una skill o un servicio de otra organización no existen para esta.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw new AccesoDenegado();
    throw e;
  }
}

/**
 * Reemplaza la jornada semanal del profesional en una sede. Rechaza superposiciones con su jornada
 * en otra sede (el profesional no puede estar en dos lugares a la vez), rangos fuera del horario de
 * atención de la sede y cambios que dejen afuera turnos tomados.
 */
export async function guardarHorarioProfesional(db: Database, actorId: string, organizacionId: string, profesionalId: string, sedeId: string, semana: Semana) {
  exigirIds(sedeId);
  await db.$transaction(async tx => {
    await bloquearProfesional(tx, profesionalId);
    const { ids, prof } = await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
    if (!ids.has(sedeId)) throw new AccesoDenegado();
    if (!prof.sedes.some(s => s.sedeId === sedeId)) throw new DatosInvalidos("Primero vinculá al profesional con esta sede");
    await exigirDentroDeSede(tx, sedeId, semana);
    const otras = await tx.horarioProfesional.findMany({ where: { profesionalId, sedeId: { not: sedeId } }, include: { sede: { select: { nombre: true } } } });
    for (const fila of filasSemana(semana)) {
      const choque = otras.find(o => o.diaSemana === fila.diaSemana && solapan({ inicio: o.inicioMinutos, fin: o.finMinutos }, { inicio: fila.inicioMinutos, fin: fila.finMinutos })
        && vigenciasSeCruzan(null, null, fechaTexto(o.vigenteDesde), fechaTexto(o.vigenteHasta)));
      if (choque) throw new DatosInvalidos(`Se superpone con su jornada en ${ids.has(choque.sedeId) ? choque.sede.nombre : "otra sede"}`);
    }
    await exigirSinTurnosAfectados(tx, { profesionalId, reserva: { sedeId } }, i => !dentroDeSemana(semana, i.ocupaDesde, i.ocupaHasta, i.tz));
    await tx.horarioProfesional.deleteMany({ where: { profesionalId, sedeId, vigenteDesde: null, vigenteHasta: null } });
    await tx.horarioProfesional.createMany({ data: filasSemana(semana).map(f => ({ organizacionId, profesionalId, sedeId, ...f })) });
    await auditar(tx, organizacionId, actorId, "profesional.horario", "Profesional", profesionalId, { sedeId });
  });
}

const DIA_MS = 86_400_000;
/** Ausencia en instantes UTC: vale para todas las sedes del profesional. */
export async function crearBloqueo(db: Database, actorId: string, organizacionId: string, profesionalId: string, datos: { inicio: Date; fin: Date; motivo?: string | null }) {
  if (Number.isNaN(datos.inicio.getTime()) || Number.isNaN(datos.fin.getTime()) || datos.fin <= datos.inicio) throw new DatosInvalidos("El bloqueo debe terminar después de empezar");
  if (datos.fin.getTime() - datos.inicio.getTime() > 366 * DIA_MS) throw new DatosInvalidos("Un bloqueo no puede superar un año");
  return db.$transaction(async tx => {
    await bloquearProfesional(tx, profesionalId);
    await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
    await exigirSinTurnosAfectados(tx, { profesionalId, ocupaDesde: { lt: datos.fin }, ocupaHasta: { gt: datos.inicio } }, () => true);
    const b = await tx.bloqueoAgenda.create({ data: { organizacionId, profesionalId, inicio: datos.inicio, fin: datos.fin, motivo: datos.motivo?.trim().slice(0, 200) || null, creadoPor: actorId }, select: { id: true } });
    await auditar(tx, organizacionId, actorId, "profesional.bloqueo.crear", "Profesional", profesionalId, { bloqueoId: b.id });
    return b;
  });
}
export async function eliminarBloqueo(db: Database, actorId: string, organizacionId: string, bloqueoId: string) {
  exigirIds(bloqueoId);
  await db.$transaction(async tx => {
    const b = await tx.bloqueoAgenda.findFirst({ where: { id: bloqueoId, organizacionId } });
    if (!b) throw new AccesoDenegado();
    await bloquearProfesional(tx, b.profesionalId);
    await contextoProfesional(tx, actorId, organizacionId, b.profesionalId, "profesional:administrar");
    await tx.bloqueoAgenda.delete({ where: { id: b.id } });
    await auditar(tx, organizacionId, actorId, "profesional.bloqueo.eliminar", "Profesional", b.profesionalId, { bloqueoId });
  });
}

// ─── Ocupación ────────────────────────────────────────────────────────────────

const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const semanal = (f: { diaSemana: number; inicioMinutos: number; finMinutos: number; vigenteDesde: Date | null; vigenteHasta: Date | null }) =>
  ({ diaSemana: f.diaSemana, inicioMinutos: f.inicioMinutos, finMinutos: f.finMinutos, vigenteDesde: fechaTexto(f.vigenteDesde), vigenteHasta: fechaTexto(f.vigenteHasta) });

/**
 * Ocupación de los profesionales activos de una sede desde hoy (hora local de la sede): por día,
 * minutos disponibles (jornada dentro del horario de la sede, fechas especiales y ausencias) contra
 * minutos tomados por turnos vigentes en esa sede, con preparación incluida.
 */
export async function ocupacionProfesionales(db: Database, actorId: string, organizacionId: string, sedeId: string, dias = 7, ahora = new Date()) {
  await exigirSede(db, actorId, organizacionId, sedeId, "sede:leer");
  const sede = await db.sede.findFirst({ where: { id: sedeId, organizacionId }, select: { timezone: true } });
  if (!sede) throw new AccesoDenegado();
  const tz = sede.timezone;
  const hoy = aLocal(ahora, tz).fecha;
  const fechas = Array.from({ length: Math.min(Math.max(dias, 1), 31) }, (_, i) => sumarDias(hoy, i));
  const desde = aUtc(fechas[0]!, 0, tz), hasta = aUtc(fechas.at(-1)!, 1440, tz);
  const profesionales = await db.profesional.findMany({
    where: { organizacionId, activo: true, sedes: { some: { sedeId, activo: true } } },
    select: { id: true, nombre: true, apellido: true }, orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
  const ids = profesionales.map(p => p.id);
  const [horarios, apertura, excepciones, bloqueos, items] = await Promise.all([
    db.horarioProfesional.findMany({ where: { profesionalId: { in: ids }, sedeId } }),
    db.horarioSede.findMany({ where: { sedeId } }),
    db.excepcionHorario.findMany({ where: { organizacionId, OR: [{ sedeId }, { sedeId: null }], fecha: { gte: fechaDb(fechas[0]!)!, lte: fechaDb(fechas.at(-1)!)! } } }),
    db.bloqueoAgenda.findMany({ where: { profesionalId: { in: ids }, inicio: { lt: hasta }, fin: { gt: desde } } }),
    db.reservaItem.findMany({
      where: { profesionalId: { in: ids }, ocupaDesde: { lt: hasta }, ocupaHasta: { gt: desde }, reserva: { AND: [{ sedeId }, reservaActiva(ahora)] } },
      select: { profesionalId: true, inicio: true, ocupaDesde: true, ocupaHasta: true },
    }),
  ]);
  const aperturaSemanal = apertura.map(semanal);
  const intervalo = (d: Date, h: Date) => ({ desde: d.getTime(), hasta: h.getTime() });
  return {
    fechas,
    profesionales: profesionales.map(p => {
      const jornada = horarios.filter(h => h.profesionalId === p.id).map(semanal);
      const suyos = items.filter(i => i.profesionalId === p.id);
      const ausencias = bloqueos.filter(b => b.profesionalId === p.id).map(b => intervalo(b.inicio, b.fin));
      return {
        id: p.id, nombre: p.nombre, apellido: p.apellido,
        dias: fechas.map(fecha => {
          const delDia = excepciones.filter(e => fechaTexto(e.fecha) === fecha);
          const abre = aperturaDelDia(aperturaSemanal, delDia.filter(e => e.sedeId), delDia.filter(e => !e.sedeId), fecha);
          const o = ocupacionDelDia({
            apertura: aIntervalos(abre, fecha, tz), jornada: aIntervalos(jornadaDelDia(jornada, fecha), fecha, tz),
            bloqueos: ausencias, turnos: suyos.map(i => intervalo(i.ocupaDesde, i.ocupaHasta)),
          });
          return { fecha, ...o, turnos: suyos.filter(i => aLocal(i.inicio, tz).fecha === fecha).length };
        }),
      };
    }),
  };
}

// ─── Calendario de sede y recursos ────────────────────────────────────────────

async function exigirSede(db: Database | Tx, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  exigirIds(sedeId);
  const r = await sedesConPermiso(db, actorId, organizacionId, permiso);
  if (!r.ids.has(sedeId)) throw new AccesoDenegado();
  return r;
}

/**
 * Equipo de una sede: profesionales vinculados (también desvinculados, para poder reactivarlos) con su
 * jornada allí, y los activos que se pueden sumar. Solo se ofrecen profesionales que ya trabajan en
 * alguna sede que el actor administra: los de otros alcances no se nombran.
 */
export async function equipoSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  await exigirSede(db, actorId, organizacionId, sedeId, "sede:leer");
  const admin = await sedesConPermiso(db, actorId, organizacionId, "profesional:administrar");
  const editable = admin.ids.has(sedeId);
  const [vinculos, horarios, disponibles] = await Promise.all([
    db.profesionalSede.findMany({
      where: { organizacionId, sedeId },
      include: { profesional: { select: { id: true, nombre: true, apellido: true, activo: true, fotoId: true, _count: { select: { servicios: true } } } } },
    }),
    db.horarioProfesional.findMany({ where: { sedeId, vigenteDesde: null, vigenteHasta: null }, orderBy: [{ diaSemana: "asc" }, { inicioMinutos: "asc" }] }),
    editable ? db.profesional.findMany({
      where: { organizacionId, activo: true, AND: [{ sedes: { none: { sedeId } } }, admin.organizacional ? {} : { sedes: { some: { sedeId: { in: [...admin.ids] } } } }] },
      select: { id: true, nombre: true, apellido: true }, orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
    }) : [],
  ]);
  const profesionales = vinculos.map(v => ({
    id: v.profesional.id, nombre: v.profesional.nombre, apellido: v.profesional.apellido, fotoId: v.profesional.fotoId,
    activo: v.profesional.activo, vinculado: v.activo, servicios: v.profesional._count.servicios,
    semana: agruparSemana(horarios.filter(h => h.profesionalId === v.profesionalId)),
  }));
  // Primero quienes atienden en la sede; después desvinculados e inactivos.
  profesionales.sort((a, b) => Number(b.vinculado && b.activo) - Number(a.vinculado && a.activo) || a.nombre.localeCompare(b.nombre, "es"));
  return { editable, profesionales, disponibles };
}

export async function calendarioSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  await exigirSede(db, actorId, organizacionId, sedeId, "sede:leer");
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const editable = (await sedesConPermiso(db, actorId, organizacionId, "sede:administrar")).ids.has(sedeId);
  const hoy = new Date(Date.now() - DIA_MS);
  const [horarios, excepciones, recursos] = await Promise.all([
    db.horarioSede.findMany({ where: { sedeId, vigenteDesde: null, vigenteHasta: null } }),
    db.excepcionHorario.findMany({ where: { organizacionId, OR: [{ sedeId }, { sedeId: null }], fecha: { gte: hoy } }, orderBy: [{ fecha: "asc" }, { inicioMinutos: "asc" }], take: 100 }),
    db.recurso.findMany({ where: { sedeId }, include: { tipoRecurso: { select: { nombre: true } } }, orderBy: [{ tipoRecurso: { nombre: "asc" } }, { nombre: "asc" }] }),
  ]);
  return {
    editable, editarFeriados: actor.some(a => tienePermiso(a, "organizacion:configurar")),
    semana: agruparSemana(horarios),
    excepciones: excepciones.map(e => ({ id: e.id, fecha: fechaTexto(e.fecha)!, deOrganizacion: e.sedeId === null, cerrado: e.cerrado, inicio: e.inicioMinutos, fin: e.finMinutos, motivo: e.motivo })),
    recursos: recursos.map(r => ({ id: r.id, nombre: r.nombre, tipo: r.tipoRecurso.nombre, activo: r.activo })),
  };
}

export async function guardarHorarioSede(db: Database, actorId: string, organizacionId: string, sedeId: string, semana: Semana) {
  await db.$transaction(async tx => {
    await exigirSede(tx, actorId, organizacionId, sedeId, "sede:administrar");
    await bloquearProfesionales(tx, await profesionalesDeSedes(tx, [sedeId]));
    await exigirSinTurnosAfectados(tx, { reserva: { sedeId } }, i => !dentroDeSemana(semana, i.inicio, i.fin, i.tz));
    await tx.horarioSede.deleteMany({ where: { sedeId, vigenteDesde: null, vigenteHasta: null } });
    await tx.horarioSede.createMany({ data: filasSemana(semana).map(f => ({ organizacionId, sedeId, ...f })) });
    await auditar(tx, organizacionId, actorId, "sede.horario", "Sede", sedeId);
  });
}

/** sedeId null = feriado o fecha especial de toda la organización (solo master). */
export async function crearExcepcion(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string | null; fecha: string; rango: Rango | null; motivo?: string | null }) {
  if (!validarFecha(datos.fecha)) throw new DatosInvalidos("Fecha inválida");
  return db.$transaction(async tx => {
    if (datos.sedeId) await exigirSede(tx, actorId, organizacionId, datos.sedeId, "sede:administrar");
    else if (!(await asignacionesActor(tx, actorId, organizacionId)).some(a => tienePermiso(a, "organizacion:configurar"))) throw new AccesoDenegado();
    const sedes = datos.sedeId ? [datos.sedeId] : (await tx.sede.findMany({ where: { organizacionId }, select: { id: true } })).map(x => x.id);
    await bloquearProfesionales(tx, await profesionalesDeSedes(tx, sedes));
    const rango = datos.rango;
    await exigirSinTurnosAfectados(tx, { reserva: { sedeId: { in: sedes } } }, i => aLocal(i.inicio, i.tz).fecha === datos.fecha
      && (rango === null || !dentroDeSemana({ [diaSemana(datos.fecha)]: [rango] } as Semana, i.inicio, i.fin, i.tz)));
    const e = await tx.excepcionHorario.create({ data: {
      organizacionId, sedeId: datos.sedeId, fecha: fechaDb(datos.fecha)!, cerrado: datos.rango === null,
      inicioMinutos: datos.rango?.inicio ?? null, finMinutos: datos.rango?.fin ?? null, motivo: datos.motivo?.trim().slice(0, 120) || null,
    }, select: { id: true } });
    await auditar(tx, organizacionId, actorId, "calendario.excepcion.crear", datos.sedeId ? "Sede" : "Organizacion", datos.sedeId ?? organizacionId, { fecha: datos.fecha, cerrado: datos.rango === null });
    return e;
  });
}
export async function eliminarExcepcion(db: Database, actorId: string, organizacionId: string, excepcionId: string) {
  exigirIds(excepcionId);
  await db.$transaction(async tx => {
    const e = await tx.excepcionHorario.findFirst({ where: { id: excepcionId, organizacionId } });
    if (!e) throw new AccesoDenegado();
    if (e.sedeId) await exigirSede(tx, actorId, organizacionId, e.sedeId, "sede:administrar");
    else if (!(await asignacionesActor(tx, actorId, organizacionId)).some(a => tienePermiso(a, "organizacion:configurar"))) throw new AccesoDenegado();
    await tx.excepcionHorario.delete({ where: { id: e.id } });
    await auditar(tx, organizacionId, actorId, "calendario.excepcion.eliminar", e.sedeId ? "Sede" : "Organizacion", e.sedeId ?? organizacionId, { fecha: fechaTexto(e.fecha) });
  });
}

export async function crearRecurso(db: Database, actorId: string, organizacionId: string, sedeId: string, datos: { tipoRecursoId: string; nombre: string }) {
  exigirIds(datos.tipoRecursoId);
  const n = nombre(datos.nombre);
  try {
    return await db.$transaction(async tx => {
      await exigirSede(tx, actorId, organizacionId, sedeId, "sede:administrar");
      const r = await tx.recurso.create({ data: { organizacionId, sedeId, tipoRecursoId: datos.tipoRecursoId, nombre: n }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, "recurso.crear", "Recurso", r.id, { sedeId, nombre: n });
      return r;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos("Ya hay un recurso con ese nombre en la sede");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw new AccesoDenegado();
    throw e;
  }
}
export async function cambiarEstadoRecurso(db: Database, actorId: string, organizacionId: string, recursoId: string, activo: boolean) {
  exigirIds(recursoId);
  await db.$transaction(async tx => {
    const r = await tx.recurso.findFirst({ where: { id: recursoId, organizacionId } });
    if (!r) throw new AccesoDenegado();
    await exigirSede(tx, actorId, organizacionId, r.sedeId, "sede:administrar");
    await tx.recurso.update({ where: { id: r.id }, data: { activo } });
    await auditar(tx, organizacionId, actorId, activo ? "recurso.activar" : "recurso.desactivar", "Recurso", r.id);
  });
}

// ─── Cambios de calendario contra turnos vigentes (R03) ──────────────────────

type ItemTurno = { inicio: Date; fin: Date; ocupaDesde: Date; ocupaHasta: Date; tz: string };
/**
 * Rechaza un cambio de calendario si deja afuera turnos vigentes futuros: hay que reprogramarlos o
 * cancelarlos primero. Se llama bajo el lock de los profesionales involucrados, el mismo que toman las
 * reservas, así que no puede colarse un turno entre la verificación y el cambio.
 */
async function exigirSinTurnosAfectados(tx: Tx, filtro: Prisma.ReservaItemWhereInput, queda_afuera: (i: ItemTurno) => boolean) {
  const ahora = new Date();
  const items = await tx.reservaItem.findMany({
    // AND explícito: un spread con otra clave `reserva` pisaría el filtro de sede del llamador.
    where: { AND: [filtro, { fin: { gt: ahora }, reserva: reservaActiva(ahora) }] },
    select: { inicio: true, fin: true, ocupaDesde: true, ocupaHasta: true, reserva: { select: { sede: { select: { timezone: true } } } } },
    orderBy: { inicio: "asc" },
  });
  const afectados = items.map(i => ({ ...i, tz: i.reserva.sede.timezone })).filter(queda_afuera);
  if (afectados.length) {
    const primero = afectados[0]!;
    const cuando = primero.inicio.toLocaleString("es-AR", { timeZone: primero.tz, dateStyle: "short", timeStyle: "short", hourCycle: "h23" });
    throw new DatosInvalidos(`El cambio deja afuera ${afectados.length} ${afectados.length === 1 ? "turno" : "turnos"} (el primero, ${cuando}). Reprogramalos o cancelalos antes.`);
  }
}
/** ¿El intervalo [desde, hasta) cae dentro de algún rango del día local en la semana dada? */
function dentroDeSemana(semana: Semana, desde: Date, hasta: Date, tz: string) {
  const a = aLocal(desde, tz), b = aLocal(hasta, tz);
  const finMin = b.fecha === a.fecha ? b.minutos : b.minutos === 0 && b.fecha > a.fecha ? 1440 : -1;
  if (finMin < 0) return false;
  return (semana[diaSemana(a.fecha) as 0] ?? []).some(r => r.inicio <= a.minutos && finMin <= r.fin);
}
async function profesionalesDeSedes(tx: Tx, sedeIds: string[]) {
  const filas = await tx.profesionalSede.findMany({ where: { sedeId: { in: sedeIds } }, select: { profesionalId: true } });
  return [...new Set(filas.map(f => f.profesionalId))].sort();
}
async function bloquearProfesionales(tx: Tx, ids: string[]) {
  if (ids.length) await tx.$queryRaw`SELECT id FROM "Profesional" WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}
