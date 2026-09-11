import { AccesoDenegado, tienePermiso, type Permiso } from "@nailnet/domain";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";

// usuarioId debe provenir de una sesión validada en servidor, nunca del body del navegador.
// No se cachean membresías ni roles: revocaciones se reflejan en la siguiente operación.
async function filtroAutorizado(db: Database, usuarioId: string, organizacionId: string, permiso: Permiso): Promise<Prisma.SedeWhereInput> {
  const membresia = await db.membresiaOrganizacion.findUnique({
    where: { organizacionId_usuarioId: { organizacionId, usuarioId } },
    include: { usuario: true, organizacion: true, asignaciones: true },
  });
  if (!membresia?.activo || !membresia.usuario.activo || !membresia.organizacion.activo) throw new AccesoDenegado();
  const alcances: Prisma.SedeWhereInput[] = [];
  for (const a of membresia.asignaciones) {
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
  return { organizacionId, activo: true, franquiciado: { activo: true }, OR: alcances };
}
const datosSede = { id: true, nombre: true, timezone: true, franquiciadoId: true } as const;
export async function listarSedes(db: Database, usuarioId: string, organizacionId: string, sedeId?: string) {
  const autorizado = await filtroAutorizado(db, usuarioId, organizacionId, "sede:leer");
  const sedes = await db.sede.findMany({ where: { AND: [autorizado, sedeId === undefined ? {} : { id: sedeId }] }, select: datosSede, orderBy: { id: "asc" } });
  if (sedeId !== undefined && !sedes.length) throw new AccesoDenegado();
  return sedes;
}
export async function renombrarSede(db: Database, usuarioId: string, organizacionId: string, sedeId: string, nombre: string) {
  const normalizado = nombre.trim();
  if (!normalizado || normalizado.length > 120) throw new Error("Nombre de sede inválido");
  const autorizado = await filtroAutorizado(db, usuarioId, organizacionId, "sede:administrar");
  const result = await db.sede.updateMany({ where: { AND: [autorizado, { id: sedeId }] }, data: { nombre: normalizado } });
  if (result.count !== 1) throw new AccesoDenegado();
}
