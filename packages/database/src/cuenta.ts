import { hashPassword, validarPassword, verificarPassword } from "@nailnet/domain/credenciales";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, auditar } from "./access.ts";
import { DemasiadosIntentos, POLITICA_ACCESO, PasswordInvalida } from "./auth.ts";
import { validarEmail, validarNombre } from "./usuarios.ts";

// «Mi cuenta»: lo que cada usuario cambia de sí mismo. Siempre opera sobre el usuario de la sesión,
// nunca sobre un ID que venga del formulario.

export class PasswordActualIncorrecta extends Error {
  constructor() { super("La contraseña actual no es correcta"); this.name = "PasswordActualIncorrecta"; }
}

export async function datosCuenta(db: Database, usuarioId: string, sesionId: string) {
  const usuario = await db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { nombre: true, email: true, passwordActualizadaEn: true } });
  const otrasSesiones = await db.sesion.count({ where: { usuarioId, id: { not: sesionId }, revocadaEn: null, expiraEn: { gt: new Date() } } });
  return { ...usuario, otrasSesiones };
}

/**
 * Pide la contraseña actual antes de cambiar email o contraseña: una sesión olvidada abierta no alcanza
 * para quedarse con la cuenta. Los fallos cuentan como intentos de ingreso, con el mismo límite que el login.
 */
async function exigirPasswordActual(db: Database, usuarioId: string, password: string) {
  const usuario = await db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { email: true, passwordHash: true } });
  const desde = new Date(Date.now() - POLITICA_ACCESO.ventanaIntentosMs);
  // Igual que el login: un ingreso correcto reinicia el conteo.
  const ultimoExito = await db.intentoAcceso.findFirst({ where: { tipo: "LOGIN", email: usuario.email, exitoso: true, createdAt: { gte: desde } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const fallos = await db.intentoAcceso.count({ where: { tipo: "LOGIN", email: usuario.email, exitoso: false, createdAt: { gte: ultimoExito?.createdAt ?? desde } } });
  if (fallos >= POLITICA_ACCESO.maxFallosPorEmail) throw new DemasiadosIntentos();
  if (!usuario.passwordHash || !await verificarPassword(password, usuario.passwordHash)) {
    await db.intentoAcceso.create({ data: { tipo: "LOGIN", email: usuario.email, ip: null, exitoso: false } });
    throw new PasswordActualIncorrecta();
  }
  return usuario;
}

// Un usuario es uno solo para todas sus organizaciones: el cambio queda en la auditoría de cada una.
async function auditarEnSusOrganizaciones(tx: Prisma.TransactionClient, usuarioId: string, accion: string) {
  const membresias = await tx.membresiaOrganizacion.findMany({ where: { usuarioId, activo: true }, select: { organizacionId: true } });
  for (const m of membresias) await auditar(tx, m.organizacionId, usuarioId, accion, "Usuario", usuarioId);
}

// Cierra las demás sesiones y anula enlaces pendientes; la sesión desde la que se hizo el cambio sigue abierta.
async function cerrarOtras(tx: Prisma.TransactionClient, usuarioId: string, sesionId: string, ahora: Date) {
  await tx.sesion.updateMany({ where: { usuarioId, id: { not: sesionId }, revocadaEn: null }, data: { revocadaEn: ahora } });
  await tx.tokenRecuperacion.updateMany({ where: { usuarioId, usadoEn: null }, data: { usadoEn: ahora } });
}

export async function cambiarMiNombre(db: Database, usuarioId: string, nombre: string) {
  const n = validarNombre(nombre);
  await db.$transaction(async tx => {
    await tx.usuario.update({ where: { id: usuarioId }, data: { nombre: n } });
    await auditarEnSusOrganizaciones(tx, usuarioId, "cuenta.nombre");
  });
}

export async function cambiarMiEmail(db: Database, usuarioId: string, sesionId: string, entrada: { password: string; email: string }) {
  const email = validarEmail(entrada.email);
  const actual = await exigirPasswordActual(db, usuarioId, entrada.password);
  if (email === actual.email) return;
  await db.$transaction(async tx => {
    if (await tx.usuario.count({ where: { email, id: { not: usuarioId } } })) throw new DatosInvalidos("Ese email ya lo usa otro usuario");
    await tx.usuario.update({ where: { id: usuarioId }, data: { email } });
    await cerrarOtras(tx, usuarioId, sesionId, new Date());
    await auditarEnSusOrganizaciones(tx, usuarioId, "cuenta.email");
  });
}

export async function cambiarMiPassword(db: Database, usuarioId: string, sesionId: string, entrada: { actual: string; nueva: string }) {
  const motivo = validarPassword(entrada.nueva);
  if (motivo) throw new PasswordInvalida(motivo);
  await exigirPasswordActual(db, usuarioId, entrada.actual);
  const passwordHash = await hashPassword(entrada.nueva);
  await db.$transaction(async tx => {
    const ahora = new Date();
    await tx.usuario.update({ where: { id: usuarioId }, data: { passwordHash, passwordActualizadaEn: ahora } });
    await cerrarOtras(tx, usuarioId, sesionId, ahora);
    await auditarEnSusOrganizaciones(tx, usuarioId, "cuenta.password");
  });
}

export async function cerrarOtrasSesiones(db: Database, usuarioId: string, sesionId: string) {
  const { count } = await db.sesion.updateMany({ where: { usuarioId, id: { not: sesionId }, revocadaEn: null }, data: { revocadaEn: new Date() } });
  return count;
}
