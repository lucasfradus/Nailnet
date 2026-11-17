import { AccesoDenegado, administraUsuario, asignacionValida, cubreSede, puedeOtorgar, tienePermiso, veUsuario, type Asignacion, type FranquiciadoDeSede } from "@nailnet/domain";
import { normalizarEmail } from "@nailnet/domain/credenciales";
import type { Llavero } from "@nailnet/domain/secretos";
import type { Database } from "./client.ts";
import { encolarEmailRecuperacion } from "./emails.ts";
import type { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, bloquearOrganizacion, exigirIds, mapaSedes } from "./access.ts";
import { POLITICA_ACCESO, emitirTokenAcceso } from "./auth.ts";

type Tx = Prisma.TransactionClient;
export type NuevaAsignacion = Pick<Asignacion, "rol" | "alcance" | "franquiciadoId" | "sedeId">;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validarEmail(email: string) {
  const e = normalizarEmail(email);
  if (e.length > 254 || !EMAIL.test(e)) throw new DatosInvalidos("Email inválido");
  return e;
}
export function validarNombre(nombre: string) {
  const n = nombre.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!n || n.length > 120) throw new DatosInvalidos("Nombre inválido: entre 1 y 120 caracteres");
  return n;
}
function validarUsuario(email: string, nombre: string) {
  return { email: validarEmail(email), nombre: validarNombre(nombre) };
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
export async function listarUsuarios(db: Database, actorId: string, organizacionId: string, filtro: { sedeId?: string; usuarioId?: string } = {}) {
  exigirIds(filtro.sedeId, filtro.usuarioId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  if (!actor.some(a => tienePermiso(a, "usuario:leer"))) throw new AccesoDenegado();
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (filtro.sedeId && !actor.some(a => tienePermiso(a, "usuario:leer") && cubreSede(a, filtro.sedeId!, franquiciadoDe))) throw new AccesoDenegado();
  const membresias = await db.membresiaOrganizacion.findMany({
    where: { organizacionId, ...filtro.usuarioId ? { usuarioId: filtro.usuarioId } : {} },
    select: {
      activo: true,
      usuario: { select: {
        id: true, email: true, nombre: true, activo: true, passwordHash: true,
        // Último ingreso: la sesión más reciente, vigente o no.
        sesiones: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      } },
      asignaciones: { select: { id: true, rol: true, alcance: true, sedeId: true, franquiciadoId: true, sede: { select: { nombre: true } }, franquiciado: { select: { nombre: true } } } },
    },
    orderBy: { usuario: { nombre: "asc" } },
  });
  return membresias
    .filter(m => veUsuario(actor, m.asignaciones, franquiciadoDe))
    // Con sede elegida entran también quienes la cubren desde arriba (master y franquiciado de esa sede),
    // que no tienen sedeId propio.
    .filter(m => !filtro.sedeId || m.asignaciones.some(a => cubreSede(a, filtro.sedeId!, franquiciadoDe)))
    .map(m => ({
      id: m.usuario.id,
      email: m.usuario.email,
      nombre: m.usuario.nombre,
      activo: m.activo && m.usuario.activo,
      tienePassword: !!m.usuario.passwordHash,
      ultimoIngreso: m.usuario.sesiones[0]?.createdAt ?? null,
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

/**
 * Restablecimiento iniciado por un administrador para una cuenta que ya tiene contraseña. El enlace va
 * solo al email del usuario (mismo email y vencimiento que «Recuperar acceso»): quien lo dispara nunca
 * lo ve, así que no le sirve para tomar la cuenta. La contraseña actual sigue valiendo hasta que el
 * usuario elija otra. Comparte el límite de pedidos por email con la recuperación, para no inundar su casilla.
 *
 * Sin `envio` (desarrollo sin llavero) devuelve el token para que quien llama lo muestre en la consola del servidor.
 */
export async function solicitarRestablecimiento(db: Database, actorId: string, organizacionId: string, usuarioId: string, envio?: { enlace: (token: string) => string; llavero: Llavero }) {
  exigirIds(usuarioId);
  return db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    const membresia = await tx.membresiaOrganizacion.findUnique({ where: { organizacionId_usuarioId: { organizacionId, usuarioId } }, include: { asignaciones: true, usuario: { select: { email: true, activo: true, passwordHash: true } } } });
    if (!membresia || usuarioId === actorId || !administraUsuario(actor, membresia.asignaciones, franquiciadoDe)) throw new AccesoDenegado();
    if (!membresia.activo || !membresia.usuario.activo) throw new DatosInvalidos("El usuario está inactivo");
    if (!membresia.usuario.passwordHash) throw new DatosInvalidos("El usuario todavía no activó su cuenta; generale un enlace de activación");
    const { email } = membresia.usuario;
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - POLITICA_ACCESO.ventanaRecuperacionMs);
    const pedidos = await tx.intentoAcceso.count({ where: { tipo: "RECUPERACION", email, createdAt: { gte: desde } } });
    if (pedidos >= POLITICA_ACCESO.maxRecuperacionesPorEmail) throw new DatosInvalidos("Ya se enviaron varios enlaces a este usuario en la última hora. Esperá un rato antes de reenviar.");
    await tx.intentoAcceso.create({ data: { tipo: "RECUPERACION", email, ip: null, exitoso: true } });
    const { id, token, expiraEn } = await emitirTokenAcceso(tx, usuarioId, POLITICA_ACCESO.recuperacionMs, ahora);
    if (envio) await encolarEmailRecuperacion(tx, { usuarioId, tokenId: id, enlace: envio.enlace(token), llavero: envio.llavero });
    await auditar(tx, organizacionId, actorId, "usuario.restablecer", "Usuario", usuarioId);
    return { email, expiraEn, token: envio ? null : token };
  });
}

/** Ficha de un usuario visible para el actor, con el mismo recorte de roles que el listado. Null si no lo ve. */
export async function obtenerUsuario(db: Database, actorId: string, organizacionId: string, usuarioId: string) {
  exigirIds(usuarioId);
  const [usuario] = await listarUsuarios(db, actorId, organizacionId, { usuarioId });
  return usuario ?? null;
}

/**
 * Corrección administrativa de nombre y email. El email es la identidad de acceso: al cambiarlo se cierran
 * las sesiones del usuario y se anulan sus enlaces pendientes (un enlace emitido al email viejo deja de
 * servir). Como el usuario es uno solo para todas las organizaciones, no se cambia el email de quien
 * también pertenece a otra: eso le corresponde a él desde «Mi cuenta». Los cambios propios van por ahí.
 */
export async function editarUsuario(db: Database, actorId: string, organizacionId: string, usuarioId: string, datos: { nombre: string; email: string }) {
  exigirIds(usuarioId);
  const nombre = validarNombre(datos.nombre);
  const email = validarEmail(datos.email);
  if (usuarioId === actorId) throw new DatosInvalidos("Tus propios datos se cambian desde Mi cuenta");
  return db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    const membresia = await tx.membresiaOrganizacion.findUnique({ where: { organizacionId_usuarioId: { organizacionId, usuarioId } }, include: { asignaciones: true, usuario: { select: { email: true, nombre: true } } } });
    if (!membresia || !administraUsuario(actor, membresia.asignaciones, franquiciadoDe)) throw new AccesoDenegado();
    const cambiaEmail = email !== membresia.usuario.email;
    const cambiaNombre = nombre !== membresia.usuario.nombre;
    if (!cambiaEmail && !cambiaNombre) return { cambiaEmail, cambiaNombre };
    if (cambiaEmail) {
      if (await tx.membresiaOrganizacion.count({ where: { usuarioId, organizacionId: { not: organizacionId } } })) throw new DatosInvalidos("El usuario también pertenece a otra organización: el email solo puede cambiarlo él, desde Mi cuenta");
      if (await tx.usuario.count({ where: { email, id: { not: usuarioId } } })) throw new DatosInvalidos("Ese email ya lo usa otro usuario");
    }
    const ahora = new Date();
    await tx.usuario.update({ where: { id: usuarioId }, data: { nombre, email } });
    if (cambiaEmail) {
      await tx.sesion.updateMany({ where: { usuarioId, revocadaEn: null }, data: { revocadaEn: ahora } });
      await tx.tokenRecuperacion.updateMany({ where: { usuarioId, usadoEn: null }, data: { usadoEn: ahora } });
    }
    // Sin los valores: la auditoría no guarda datos personales, solo qué cambió.
    await auditar(tx, organizacionId, actorId, "usuario.editar", "Usuario", usuarioId, { nombre: cambiaNombre, email: cambiaEmail });
    return { cambiaEmail, cambiaNombre };
  });
}

/**
 * Reemplaza un rol por otro en una sola operación (por ejemplo, de recepción a administración de la sede),
 * para no dejar al usuario sin rol entre «quitar» y «agregar». El actor debe poder otorgar ambos.
 */
export async function cambiarRol(db: Database, actorId: string, organizacionId: string, asignacionId: string, datos: NuevaAsignacion) {
  exigirIds(asignacionId);
  const nueva = limpiar(datos);
  await db.$transaction(async tx => {
    const { actor, franquiciadoDe } = await contexto(tx, actorId, organizacionId);
    const actual = await tx.asignacionRol.findFirst({ where: { id: asignacionId, organizacionId } });
    if (!actual || !puedeOtorgar(actor, actual, franquiciadoDe) || !puedeOtorgar(actor, nueva, franquiciadoDe)) throw new AccesoDenegado();
    if (actual.usuarioId === actorId) throw new DatosInvalidos("No podés cambiar tus propios roles");
    if (actual.rol === nueva.rol && actual.alcance === nueva.alcance && actual.sedeId === nueva.sedeId && actual.franquiciadoId === nueva.franquiciadoId) return;
    if (actual.rol === "MASTER_FRANQUICIADOR") await exigirOtroMaster(tx, organizacionId, actual.usuarioId);
    if (await tx.asignacionRol.count({ where: { organizacionId, usuarioId: actual.usuarioId, ...nueva } })) throw new DatosInvalidos("El usuario ya tiene ese rol");
    const actualizada = await tx.asignacionRol.update({ where: { id: actual.id }, data: nueva, select: { id: true } });
    await auditar(tx, organizacionId, actorId, "rol.cambiar", "AsignacionRol", actualizada.id, { usuarioId: actual.usuarioId, de: { rol: actual.rol, sedeId: actual.sedeId, franquiciadoId: actual.franquiciadoId }, a: nueva });
  });
}
