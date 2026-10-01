import { AccesoDenegado, tienePermiso, type Permiso } from "@nailnet/domain";
import { parsearRangos, solapan, validarFecha, vigenciasSeCruzan, type Rango } from "@nailnet/domain/agenda";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, exigirIds, sedesConPermiso } from "./access.ts";

type Tx = Prisma.TransactionClient;
export type Semana = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, Rango[]>>;
const DIAS = [0, 1, 2, 3, 4, 5, 6] as const;
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
    if ("error" in r) throw new DatosInvalidos(`${["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][d]}: ${r.error}`);
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

export async function crearProfesional(db: Database, actorId: string, organizacionId: string, sedeId: string, datos: { nombre: string; apellido?: string | null }) {
  exigirIds(sedeId);
  const n = nombre(datos.nombre), a = datos.apellido?.trim() ? nombre(datos.apellido, "Apellido") : null;
  return db.$transaction(async tx => {
    const { ids } = await sedesConPermiso(tx, actorId, organizacionId, "profesional:administrar");
    if (!ids.has(sedeId)) throw new AccesoDenegado();
    const p = await tx.profesional.create({ data: { organizacionId, nombre: n, apellido: a, sedes: { create: { sedeId } } }, select: { id: true } });
    await auditar(tx, organizacionId, actorId, "profesional.crear", "Profesional", p.id, { sedeId });
    return p;
  });
}

export async function obtenerProfesional(db: Database, actorId: string, organizacionId: string, profesionalId: string) {
  const { prof, visibles, sedes } = await contextoProfesional(db, actorId, organizacionId, profesionalId, "sede:leer");
  const admin = await sedesConPermiso(db, actorId, organizacionId, "profesional:administrar");
  const [skills, servicios, horarios, bloqueos] = await Promise.all([
    db.profesionalSkill.findMany({ where: { profesionalId }, select: { skillId: true } }),
    db.profesionalServicio.findMany({ where: { profesionalId }, select: { servicioId: true } }),
    db.horarioProfesional.findMany({ where: { profesionalId, sedeId: { in: visibles.map(v => v.sedeId) } }, orderBy: [{ diaSemana: "asc" }, { inicioMinutos: "asc" }] }),
    db.bloqueoAgenda.findMany({ where: { profesionalId, fin: { gt: new Date() } }, orderBy: { inicio: "asc" }, take: 50 }),
  ]);
  const nombres = new Map(sedes.map(s => [s.id, s.nombre]));
  const editable = visibles.some(v => admin.ids.has(v.sedeId)) || admin.organizacional;
  return {
    id: prof.id, nombre: prof.nombre, apellido: prof.apellido, activo: prof.activo, editable,
    // Las sedes de otros alcances no se nombran: solo se informa que existen.
    otrasSedes: prof.sedes.length - visibles.length,
    sedes: visibles.map(v => ({
      sedeId: v.sedeId, nombre: nombres.get(v.sedeId)!, activo: v.activo, editable: admin.ids.has(v.sedeId),
      semana: agruparSemana(horarios.filter(h => h.sedeId === v.sedeId && h.vigenteDesde === null && h.vigenteHasta === null)),
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
 * en otra sede: el profesional no puede estar en dos lugares a la vez. Cambios que afecten turnos
 * tomados se validarán contra reservas cuando existan (C04/R01).
 */
export async function guardarHorarioProfesional(db: Database, actorId: string, organizacionId: string, profesionalId: string, sedeId: string, semana: Semana) {
  exigirIds(sedeId);
  await db.$transaction(async tx => {
    await bloquearProfesional(tx, profesionalId);
    const { ids, prof } = await contextoProfesional(tx, actorId, organizacionId, profesionalId, "profesional:administrar");
    if (!ids.has(sedeId)) throw new AccesoDenegado();
    if (!prof.sedes.some(s => s.sedeId === sedeId)) throw new DatosInvalidos("Primero vinculá al profesional con esta sede");
    const otras = await tx.horarioProfesional.findMany({ where: { profesionalId, sedeId: { not: sedeId } }, include: { sede: { select: { nombre: true } } } });
    for (const fila of filasSemana(semana)) {
      const choque = otras.find(o => o.diaSemana === fila.diaSemana && solapan({ inicio: o.inicioMinutos, fin: o.finMinutos }, { inicio: fila.inicioMinutos, fin: fila.finMinutos })
        && vigenciasSeCruzan(null, null, fechaTexto(o.vigenteDesde), fechaTexto(o.vigenteHasta)));
      if (choque) throw new DatosInvalidos(`Se superpone con su jornada en ${ids.has(choque.sedeId) ? choque.sede.nombre : "otra sede"}`);
    }
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

// ─── Calendario de sede y recursos ────────────────────────────────────────────

async function exigirSede(db: Database | Tx, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  exigirIds(sedeId);
  const r = await sedesConPermiso(db, actorId, organizacionId, permiso);
  if (!r.ids.has(sedeId)) throw new AccesoDenegado();
  return r;
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
