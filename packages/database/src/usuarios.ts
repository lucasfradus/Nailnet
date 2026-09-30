import { AccesoDenegado, administraUsuario, asignacionValida, cubreSede, puedeOtorgar, tienePermiso, veUsuario, type Asignacion, type FranquiciadoDeSede } from "@nailnet/domain";
import { normalizarEmail } from "@nailnet/domain/credenciales";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, bloquearOrganizacion, exigirIds, mapaSedes } from "./access.ts";
import { POLITICA_ACCESO, emitirTokenAcceso } from "./auth.ts";

type Tx = Prisma.TransactionClient;
export type NuevaAsignacion = Pick<Asignacion, "rol" | "alcance" | "franquiciadoId" | "sedeId">;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validarUsuario(email: string, nombre: string) {
  const e = normalizarEmail(email);
  const n = nombre.normalize("NFC").trim().replace(/\s+/g, " ");
  if (e.length > 254 || !EMAIL.test(e)) throw new DatosInvalidos("Email inválido");
  if (!n || n.length > 120) throw new DatosInvalidos("Nombre inválido: entre 1 y 120 caracteres");
  return { email: e, nombre: n };
}
function limpiar(a: NuevaAsignacion): Asignacion {
  const asignacion = { rol: a.rol, alcance: a.alcance, franquiciadoId: a.franquiciadoId || null, sedeId: a.sedeId || null };
  exigirIds(asignacion.franquiciadoId, asignacion.sedeId);
  if (!asignacionValida(asignacion)) throw new DatosInvalidos("Combinación de rol y alcance inválida");
  return asignacion;
}

// Alcance de lectura del actor sobre una asignación ajena: evita mostrar a un admin de sede
// en qué otras sedes trabaja alguien.
function asignacionVisible(actor: readonly Asignacion[], o: Asignacion, franquiciadoDe: FranquiciadoDeSede) {
  return actor.some(a => tienePermiso(a, "usuario:leer") && (a.alcance === "ORGANIZACION"
    || (o.alcance === "SEDE" && cubreSede(a, o.sedeId!, franquiciadoDe))
    || (o.alcance === "FRANQUICIADO" && a.alcance === "FRANQUICIADO" && a.franquiciadoId === o.franquiciadoId)));
}

/** Usuarios visibles para el actor, opcionalmente filtrados por una sede de su alcance. */
export async function listarUsuarios(db: Database, actorId: string, organizacionId: string, filtro: { sedeId?: string } = {}) {
  exigirIds(filtro.sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  if (!actor.some(a => tienePermiso(a, "usuario:leer"))) throw new AccesoDenegado();
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (filtro.sedeId && !actor.some(a => tienePermiso(a, "usuario:leer") && cubreSede(a, filtro.sedeId!, franquiciadoDe))) throw new AccesoDenegado();
  const membresias = await db.membresiaOrganizacion.findMany({
    where: { organizacionId },
    select: {
      activo: true,
      usuario: { select: { id: true, email: true, nombre: true, activo: true, passwordHash: true } },
      asignaciones: { select: { id: true, rol: true, alcance: true, sedeId: true, franquiciadoId: true, sede: { select: { nombre: true } }, franquiciado: { select: { nombre: true } } } },
    },
    orderBy: { usuario: { nombre: "asc" } },
  });
  return membresias
    .filter(m => veUsuario(actor, m.asignaciones, franquiciadoDe))
    .filter(m => !filtro.sedeId || m.asignaciones.some(a => a.sedeId === filtro.sedeId))
    .map(m => ({
      id: m.usuario.id,
      email: m.usuario.email,
      nombre: m.usuario.nombre,
      activo: m.activo && m.usuario.activo,
      tienePassword: !!m.usuario.passwordHash,
      administrable: m.usuario.id !== actorId && administraUsuario(actor, m.asignaciones, franquiciadoDe),
      asignaciones: m.asignaciones.filter(a => asignacionVisible(actor, a, franquiciadoDe)).map(a => ({
        id: a.id, rol: a.rol, alcance: a.alcance, sedeId: a.sedeId, franquiciadoId: a.franquiciadoId,
        sede: a.sede?.nombre ?? null, franquiciado: a.franquiciado?.nombre ?? null,
        revocable: puedeOtorgar(actor, a, franquiciadoDe),
      })),
    }));
}

/** Roles que el actor puede conceder, para armar formularios. La validación real ocurre al escribir. */
export async function opcionesDeRol(db: Database, actorId: string, organizacionId: string) {
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  const sedes = await db.sede.findMany({ where: { organizacionId, activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  const franquiciados = await db.franquiciado.findMany({ where: { organizacionId, activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  const opciones: { etiqueta: string; asignacion: Asignacion }[] = [];
  const agregar = (etiqueta: string, asignacion: Asignacion) => { if (puedeOtorgar(actor, asignacion, franquiciadoDe)) opciones.push({ etiqueta, asignacion }); };
  agregar("Master franquiciador", { rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION", franquiciadoId: null, sedeId: null });
  for (const f of franquiciados) agregar(`Franquiciado · ${f.nombre}`, { rol: "FRANQUICIADO", alcance: "FRANQUICIADO", franquiciadoId: f.id, sedeId: null });
  for (const s of sedes) {
    agregar(`Administración · ${s.nombre}`, { rol: "ADMIN_SEDE", alcance: "SEDE", franquiciadoId: null, sedeId: s.id });
    agregar(`Recepción · ${s.nombre}`, { rol: "RECEPCIONISTA", alcance: "SEDE", franquiciadoId: null, sedeId: s.id });
  }
  agregar("Profesional", { rol: "PROFESIONAL", alcance: "PROPIO", franquiciadoId: null, sedeId: null });
  return opciones;
}

async function contexto(tx: Tx, actorId: string, organizacionId: string) {
  await bloquearOrganizacion(tx, organizacionId);
  return { actor: await asignacionesActor(tx, actorId, organizacionId), franquiciadoDe: await mapaSedes(tx, organizacionId) };
}

// La organización nunca queda sin un master activo que pueda administrarla.
async function exigirOtroMaster(tx: Tx, organizacionId: string, usuarioId: string) {
  const otros = await tx.asignacionRol.count({ where: {
    organizacionId, rol: "MASTER_FRANQUICIADOR", usuarioId: { not: usuarioId },
    membresia: { activo: true, usuario: { activo: true } },
  } });
  if (!otros) throw new DatosInvalidos("La organización debe conservar al menos un master activo");
}

/**
 * Alta de usuario con su primer rol, en una transacción: nadie crea usuarios que luego no pueda ver.
 * Si el email ya existe (otra organización), se lo incorpora sin tocar su nombre ni su contraseña.
 */
export async function crearUsuario(db: Database, actorId: string, organizacionId: string, datos: { email: string; nombre: string; asignacion: NuevaAsignacion }) {
  const { email, nombre } = validarUsuario(datos.email, datos.nombre);
  const asignacion = limpiar(datos.asignacion);
  return db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    if (!puedeOtorgar(actor, asignacion, franquiciadoDe)) throw new AccesoDenegado();
    let usuario = await tx.usuario.findUnique({ where: { email }, select: { id: true } });
    const nuevo = !usuario;
    if (usuario && await tx.membresiaOrganizacion.count({ where: { organizacionId, usuarioId: usuario.id } })) throw new DatosInvalidos("Ese email ya pertenece a la organización; agregale un rol desde su ficha");
    usuario ??= await tx.usuario.create({ data: { email, nombre }, select: { id: true } });
    await tx.membresiaOrganizacion.create({ data: { organizacionId, usuarioId: usuario.id } });
    await tx.asignacionRol.create({ data: { organizacionId, usuarioId: usuario.id, ...asignacion } });
    await auditar(tx, organizacionId, actorId, "usuario.crear", "Usuario", usuario.id, { nuevo, ...asignacion });
    return { usuarioId: usuario.id, nuevo };
  });
}

export async function otorgarRol(db: Database, actorId: string, organizacionId: string, usuarioId: string, datos: NuevaAsignacion) {
  exigirIds(usuarioId);
  const asignacion = limpiar(datos);
  await db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    if (!puedeOtorgar(actor, asignacion, franquiciadoDe)) throw new AccesoDenegado();
    const membresia = await tx.membresiaOrganizacion.findUnique({ where: { organizacionId_usuarioId: { organizacionId, usuarioId } }, select: { activo: true } });
    if (!membresia) throw new AccesoDenegado();
    const repetida = await tx.asignacionRol.count({ where: { organizacionId, usuarioId, ...asignacion } });
    if (repetida) throw new DatosInvalidos("El usuario ya tiene ese rol");
    const creada = await tx.asignacionRol.create({ data: { organizacionId, usuarioId, ...asignacion }, select: { id: true } });
    await auditar(tx, organizacionId, actorId, "rol.otorgar", "AsignacionRol", creada.id, { usuarioId, ...asignacion });
  });
}

export async function revocarRol(db: Database, actorId: string, organizacionId: string, asignacionId: string) {
  exigirIds(asignacionId);
  await db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    const asignacion = await tx.asignacionRol.findFirst({ where: { id: asignacionId, organizacionId } });
    if (!asignacion || !puedeOtorgar(actor, asignacion, franquiciadoDe)) throw new AccesoDenegado();
    if (asignacion.rol === "MASTER_FRANQUICIADOR") await exigirOtroMaster(tx, organizacionId, asignacion.usuarioId);
    await tx.asignacionRol.delete({ where: { id: asignacion.id } });
    await auditar(tx, organizacionId, actorId, "rol.revocar", "AsignacionRol", asignacion.id, { usuarioId: asignacion.usuarioId, rol: asignacion.rol, sedeId: asignacion.sedeId, franquiciadoId: asignacion.franquiciadoId });
  });
}

/** Activa o desactiva la membresía en esta organización (no afecta otras). Efecto inmediato en la siguiente request. */
export async function cambiarEstadoUsuario(db: Database, actorId: string, organizacionId: string, usuarioId: string, activo: boolean) {
  exigirIds(usuarioId);
  if (usuarioId === actorId) throw new DatosInvalidos("No podés cambiar tu propio estado");
  await db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    const membresia = await tx.membresiaOrganizacion.findUnique({ where: { organizacionId_usuarioId: { organizacionId, usuarioId } }, include: { asignaciones: true } });
    if (!membresia || !administraUsuario(actor, membresia.asignaciones, franquiciadoDe)) throw new AccesoDenegado();
    if (!activo && membresia.asignaciones.some(a => a.rol === "MASTER_FRANQUICIADOR")) await exigirOtroMaster(tx, organizacionId, usuarioId);
    await tx.membresiaOrganizacion.update({ where: { organizacionId_usuarioId: { organizacionId, usuarioId } }, data: { activo } });
    await auditar(tx, organizacionId, actorId, activo ? "usuario.activar" : "usuario.desactivar", "Usuario", usuarioId);
  });
}

/**
 * Enlace de activación para un usuario que todavía no tiene contraseña. Se muestra una vez a quien lo
 * genera, hasta que exista envío por email. No se ofrece para cuentas con contraseña: así un
 * administrador no puede tomar una cuenta ya en uso (para eso está la recuperación del propio usuario).
 */
export async function emitirInvitacion(db: Database, actorId: string, organizacionId: string, usuarioId: string) {
  exigirIds(usuarioId);
  return db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    const membresia = await tx.membresiaOrganizacion.findUnique({ where: { organizacionId_usuarioId: { organizacionId, usuarioId } }, include: { asignaciones: true, usuario: { select: { activo: true, passwordHash: true } } } });
    if (!membresia || usuarioId === actorId || !administraUsuario(actor, membresia.asignaciones, franquiciadoDe)) throw new AccesoDenegado();
    if (!membresia.activo || !membresia.usuario.activo) throw new DatosInvalidos("El usuario está inactivo");
    if (membresia.usuario.passwordHash) throw new DatosInvalidos("El usuario ya tiene contraseña; puede recuperarla desde el ingreso");
    const enlace = await emitirTokenAcceso(tx, usuarioId, POLITICA_ACCESO.invitacionMs);
    await auditar(tx, organizacionId, actorId, "usuario.invitar", "Usuario", usuarioId);
    return enlace;
  });
}
