import { AccesoDenegado, puedeCrearSede, tienePermiso, type Asignacion, type FranquiciadoDeSede, type Permiso } from "@nailnet/domain";
import { redactar } from "@nailnet/domain/secretos";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";

type Cliente = Database | Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un ID mal formado (p. ej. un formulario manipulado) equivale a un recurso inaccesible, no a un error 500. */
export function exigirIds(...ids: (string | null | undefined)[]) {
  for (const id of ids) if (id !== null && id !== undefined && !UUID.test(id)) throw new AccesoDenegado();
}

export class DatosInvalidos extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "DatosInvalidos"; }
}

/** Asignaciones vigentes del actor en la organización; sin membresía activa no hay acceso. */
export async function asignacionesActor(db: Cliente, usuarioId: string, organizacionId: string): Promise<(Asignacion & { id: string })[]> {
  exigirIds(usuarioId, organizacionId);
  const membresia = await db.membresiaOrganizacion.findUnique({
    where: { organizacionId_usuarioId: { organizacionId, usuarioId } },
    include: { usuario: { select: { activo: true } }, organizacion: { select: { activo: true } }, asignaciones: true },
  });
  if (!membresia?.activo || !membresia.usuario.activo || !membresia.organizacion.activo) throw new AccesoDenegado();
  return membresia.asignaciones;
}

/** Mapa sede → franquiciado de la organización, incluidas sedes inactivas. */
export async function mapaSedes(db: Cliente, organizacionId: string): Promise<FranquiciadoDeSede> {
  const sedes = await db.sede.findMany({ where: { organizacionId }, select: { id: true, franquiciadoId: true } });
  const mapa = new Map(sedes.map(s => [s.id, s.franquiciadoId]));
  return id => mapa.get(id);
}

// Serializa cambios de permisos y estructura dentro de una organización: el actor se relee bajo
// el mismo lock, así una revocación concurrente no deja pasar una operación con permisos viejos.
export async function bloquearOrganizacion(tx: Prisma.TransactionClient, organizacionId: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${"permisos:" + organizacionId}, 0))) AS l`;
}

export async function auditar(tx: Prisma.TransactionClient, organizacionId: string, actorId: string, accion: string, entidad: string, entidadId: string, datos?: Prisma.InputJsonValue) {
  // Redacción defensiva: aunque alguien pase un secreto por error, no queda en la auditoría.
  await tx.auditLog.create({ data: { organizacionId, actorId, accion, entidad, entidadId, datos: datos === undefined ? undefined : redactar(datos) } });
}

// usuarioId debe provenir de una sesión validada en servidor, nunca del body del navegador.
// No se cachean membresías ni roles: revocaciones se reflejan en la siguiente operación.
async function filtroAutorizado(db: Database, usuarioId: string, organizacionId: string, permiso: Permiso, incluirInactivas = false): Promise<Prisma.SedeWhereInput> {
  const asignaciones = await asignacionesActor(db, usuarioId, organizacionId);
  const alcances: Prisma.SedeWhereInput[] = [];
  for (const a of asignaciones) {
    if (!tienePermiso(a, permiso)) continue;
    // Revalidar la asignación dentro de la consulta final evita usar permisos
    // revocados entre la carga del contexto y la lectura/escritura de la sede.
    const vigente: Prisma.SedeWhereInput = { franquiciado: { organizacion: {
      activo: true,
      membresias: { some: { usuarioId, activo: true, usuario: { activo: true }, asignaciones: { some: {
        id: a.id, rol: a.rol, alcance: a.alcance, sedeId: a.sedeId, franquiciadoId: a.franquiciadoId,
      } } } },
    } } };
    if (a.alcance === "ORGANIZACION") alcances.push(vigente);
    if (a.alcance === "FRANQUICIADO" && a.franquiciadoId) alcances.push({ AND: [vigente, { franquiciadoId: a.franquiciadoId }] });
    if (a.alcance === "SEDE" && a.sedeId) alcances.push({ AND: [vigente, { id: a.sedeId }] });
  }
  if (!alcances.length) throw new AccesoDenegado();
  const estado: Prisma.SedeWhereInput = incluirInactivas ? {} : { activo: true, franquiciado: { activo: true } };
  return { organizacionId, ...estado, OR: alcances };
}

const datosSede = { id: true, nombre: true, timezone: true, franquiciadoId: true, activo: true, franquiciado: { select: { nombre: true, activo: true } } } as const;

/**
 * Sedes visibles para el actor. sedeId filtra dentro del alcance y rechaza (no amplía) si no es visible.
 * incluirInactivas exige además poder crear sedes en ese franquiciado.
 */
export async function listarSedes(db: Database, usuarioId: string, organizacionId: string, opciones: { sedeId?: string; incluirInactivas?: boolean } | string = {}) {
  const { sedeId, incluirInactivas = false } = typeof opciones === "string" ? { sedeId: opciones } : opciones;
  exigirIds(sedeId);
  const autorizado = await filtroAutorizado(db, usuarioId, organizacionId, "sede:leer", incluirInactivas);
  let sedes = await db.sede.findMany({ where: { AND: [autorizado, sedeId === undefined ? {} : { id: sedeId }] }, select: datosSede, orderBy: [{ nombre: "asc" }, { id: "asc" }] });
  if (incluirInactivas) {
    const actor = await asignacionesActor(db, usuarioId, organizacionId);
    sedes = sedes.filter(s => (s.activo && s.franquiciado.activo) || puedeCrearSede(actor, s.franquiciadoId));
  }
  if (sedeId !== undefined && !sedes.length) throw new AccesoDenegado();
  return sedes;
}

export function zonaHorariaValida(timezone: string): boolean {
  if (!timezone || timezone.length > 64) return false;
  try { new Intl.DateTimeFormat("es-AR", { timeZone: timezone }); return true; }
  catch { return false; }
}
function normalizarNombre(nombre: string, campo = "Nombre") {
  const normalizado = nombre.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!normalizado || normalizado.length > 120) throw new DatosInvalidos(`${campo} inválido: entre 1 y 120 caracteres`);
  return normalizado;
}

export async function actualizarSede(db: Database, usuarioId: string, organizacionId: string, sedeId: string, cambios: { nombre?: string; timezone?: string }) {
  exigirIds(sedeId);
  const data: Prisma.SedeUpdateManyMutationInput = {};
  if (cambios.nombre !== undefined) data.nombre = normalizarNombre(cambios.nombre);
  if (cambios.timezone !== undefined) {
    if (!zonaHorariaValida(cambios.timezone)) throw new DatosInvalidos("Zona horaria inválida");
    data.timezone = cambios.timezone;
  }
  const autorizado = await filtroAutorizado(db, usuarioId, organizacionId, "sede:administrar");
  await db.$transaction(async tx => {
    const result = await tx.sede.updateMany({ where: { AND: [autorizado, { id: sedeId }] }, data });
    if (result.count !== 1) throw new AccesoDenegado();
    await auditar(tx, organizacionId, usuarioId, "sede.actualizar", "Sede", sedeId, data as Prisma.InputJsonValue);
  });
}
export async function renombrarSede(db: Database, usuarioId: string, organizacionId: string, sedeId: string, nombre: string) {
  await actualizarSede(db, usuarioId, organizacionId, sedeId, { nombre });
}

export async function crearSede(db: Database, usuarioId: string, organizacionId: string, datos: { franquiciadoId: string; nombre: string; timezone?: string }) {
  exigirIds(datos.franquiciadoId);
  const nombre = normalizarNombre(datos.nombre);
  const timezone = datos.timezone ?? "America/Argentina/Buenos_Aires";
  if (!zonaHorariaValida(timezone)) throw new DatosInvalidos("Zona horaria inválida");
  return db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    const actor = await asignacionesActor(tx, usuarioId, organizacionId);
    const franquiciado = await tx.franquiciado.findFirst({ where: { id: datos.franquiciadoId, organizacionId, activo: true }, select: { id: true } });
    if (!franquiciado || !puedeCrearSede(actor, franquiciado.id)) throw new AccesoDenegado();
    const sede = await tx.sede.create({ data: { organizacionId, franquiciadoId: franquiciado.id, nombre, timezone }, select: { id: true } });
    await auditar(tx, organizacionId, usuarioId, "sede.crear", "Sede", sede.id, { nombre, franquiciadoId: franquiciado.id, timezone });
    return sede;
  });
}

/** Desactivar oculta la sede de la operación y de los listados de recepción; no borra historial. */
export async function cambiarEstadoSede(db: Database, usuarioId: string, organizacionId: string, sedeId: string, activo: boolean) {
  exigirIds(sedeId);
  await db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    const actor = await asignacionesActor(tx, usuarioId, organizacionId);
    const sede = await tx.sede.findFirst({ where: { id: sedeId, organizacionId }, select: { franquiciadoId: true } });
    if (!sede || !puedeCrearSede(actor, sede.franquiciadoId)) throw new AccesoDenegado();
    await tx.sede.update({ where: { id: sedeId }, data: { activo } });
    await auditar(tx, organizacionId, usuarioId, activo ? "sede.activar" : "sede.desactivar", "Sede", sedeId);
  });
}

export async function listarFranquiciados(db: Database, usuarioId: string, organizacionId: string) {
  const actor = await asignacionesActor(db, usuarioId, organizacionId);
  const master = actor.some(a => tienePermiso(a, "franquiciado:administrar"));
  const propios = actor.filter(a => tienePermiso(a, "sede:crear") && a.franquiciadoId).map(a => a.franquiciadoId!);
  if (!master && !propios.length) throw new AccesoDenegado();
  return db.franquiciado.findMany({
    where: { organizacionId, ...(master ? {} : { id: { in: propios }, activo: true }) },
    select: { id: true, nombre: true, activo: true, _count: { select: { sedes: true } } },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
}

export async function crearFranquiciado(db: Database, usuarioId: string, organizacionId: string, nombre: string) {
  const normalizado = normalizarNombre(nombre);
  return db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    const actor = await asignacionesActor(tx, usuarioId, organizacionId);
    if (!actor.some(a => tienePermiso(a, "franquiciado:administrar"))) throw new AccesoDenegado();
    const franquiciado = await tx.franquiciado.create({ data: { organizacionId, nombre: normalizado }, select: { id: true } });
    await auditar(tx, organizacionId, usuarioId, "franquiciado.crear", "Franquiciado", franquiciado.id, { nombre: normalizado });
    return franquiciado;
  });
}
