import { generarToken, hashPassword, hashSenuelo, hashToken, normalizarEmail, requiereRehash, validarPassword, verificarPassword } from "@nailnet/domain/credenciales";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";

const MINUTO = 60_000;
export const POLITICA_ACCESO = {
  sesionMaximaMs: 12 * 60 * MINUTO,
  sesionInactividadMs: 2 * 60 * MINUTO,
  recuperacionMs: 30 * MINUTO,
  ventanaIntentosMs: 15 * MINUTO,
  maxFallosPorEmail: 5,
  maxFallosPorIp: 30,
  ventanaRecuperacionMs: 60 * MINUTO,
  maxRecuperacionesPorEmail: 3,
  maxRecuperacionesPorIp: 10,
} as const;

export class CredencialesInvalidas extends Error {
  constructor() { super("Email o contraseña incorrectos"); this.name = "CredencialesInvalidas"; }
}
export class DemasiadosIntentos extends Error {
  constructor() { super("Demasiados intentos. Esperá unos minutos y volvé a probar."); this.name = "DemasiadosIntentos"; }
}
export class TokenInvalido extends Error {
  constructor() { super("El enlace no es válido o ya venció"); this.name = "TokenInvalido"; }
}
export class PasswordInvalida extends Error {
  constructor(motivo: string) { super(motivo); this.name = "PasswordInvalida"; }
}

// Un usuario puede operar solo si está activo y pertenece activamente a una organización activa.
// Sin membresía no hay acceso implícito: se trata igual que credenciales inválidas.
const habilitado = { activo: true, membresias: { some: { activo: true, organizacion: { activo: true } } } } satisfies Prisma.UsuarioWhereInput;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Serializa intentos concurrentes sobre la misma clave dentro de la transacción,
// para que el conteo de fallos no pueda eludirse con requests en paralelo.
async function bloquear(tx: Prisma.TransactionClient, clave: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))) AS l`;
}

type ResultadoLogin = { ok: true; token: string; expiraEn: Date } | { ok: false; error: CredencialesInvalidas | DemasiadosIntentos };

export async function iniciarSesion(db: Database, entrada: { email: string; password: string; ip?: string | null }): Promise<{ token: string; expiraEn: Date }> {
  const email = normalizarEmail(entrada.email).slice(0, 254);
  const ip = entrada.ip?.slice(0, 64) || null;
  const resultado = await db.$transaction(async (tx): Promise<ResultadoLogin> => {
    await bloquear(tx, `login:${email}`);
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - POLITICA_ACCESO.ventanaIntentosMs);
    // Un acceso correcto reinicia el conteo de fallos por email.
    const ultimoExito = await tx.intentoAcceso.findFirst({ where: { tipo: "LOGIN", email, exitoso: true, createdAt: { gte: desde } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const fallosEmail = await tx.intentoAcceso.count({ where: { tipo: "LOGIN", email, exitoso: false, createdAt: { gte: ultimoExito?.createdAt ?? desde } } });
    const fallosIp = ip ? await tx.intentoAcceso.count({ where: { tipo: "LOGIN", ip, exitoso: false, createdAt: { gte: desde } } }) : 0;
    if (fallosEmail >= POLITICA_ACCESO.maxFallosPorEmail || fallosIp >= POLITICA_ACCESO.maxFallosPorIp) return { ok: false, error: new DemasiadosIntentos() };

    const usuario = await tx.usuario.findFirst({ where: { email, ...habilitado }, select: { id: true, passwordHash: true } });
    // Siempre se ejecuta scrypt para no revelar por tiempo si el email existe.
    const valido = await verificarPassword(entrada.password, usuario?.passwordHash ?? await hashSenuelo()) && !!usuario?.passwordHash;
    await tx.intentoAcceso.create({ data: { tipo: "LOGIN", email, ip, exitoso: valido } });
    if (!valido || !usuario) return { ok: false, error: new CredencialesInvalidas() };

    if (requiereRehash(usuario.passwordHash!)) await tx.usuario.update({ where: { id: usuario.id }, data: { passwordHash: await hashPassword(entrada.password) } });
    const { token, hash } = generarToken();
    const expiraEn = new Date(ahora.getTime() + POLITICA_ACCESO.sesionMaximaMs);
    await tx.sesion.create({ data: { usuarioId: usuario.id, tokenHash: hash, createdAt: ahora, ultimoUso: ahora, expiraEn } });
    return { ok: true, token, expiraEn };
  }, { timeout: 15_000 });
  // El intento fallido se confirma antes de lanzar el error; si no, el rollback borraría el registro.
  if (!resultado.ok) throw resultado.error;
  return { token: resultado.token, expiraEn: resultado.expiraEn };
}

export type SesionValida = { sesionId: string; expiraEn: Date; usuario: { id: string; email: string; nombre: string } };

/** Relee sesión y usuario en cada request: revocar o desactivar tiene efecto inmediato. */
export async function validarSesion(db: Database, token: string | undefined | null): Promise<SesionValida | null> {
  if (!token || !FORMATO_TOKEN.test(token)) return null;
  const ahora = new Date();
  const sesion = await db.sesion.findUnique({ where: { tokenHash: hashToken(token) }, include: { usuario: { select: { id: true, email: true, nombre: true } } } });
  if (!sesion || sesion.revocadaEn || sesion.expiraEn <= ahora || sesion.ultimoUso.getTime() <= ahora.getTime() - POLITICA_ACCESO.sesionInactividadMs) return null;
  const vigente = await db.usuario.count({ where: { id: sesion.usuarioId, ...habilitado } });
  if (!vigente) {
    await db.sesion.updateMany({ where: { id: sesion.id, revocadaEn: null }, data: { revocadaEn: ahora } });
    return null;
  }
  // Evita una escritura por request: la inactividad se mide con resolución de un minuto.
  if (ahora.getTime() - sesion.ultimoUso.getTime() > MINUTO) await db.sesion.updateMany({ where: { id: sesion.id, revocadaEn: null }, data: { ultimoUso: ahora } });
  return { sesionId: sesion.id, expiraEn: sesion.expiraEn, usuario: sesion.usuario };
}

export async function cerrarSesion(db: Database, token: string | undefined | null): Promise<void> {
  if (!token || !FORMATO_TOKEN.test(token)) return;
  await db.sesion.updateMany({ where: { tokenHash: hashToken(token), revocadaEn: null }, data: { revocadaEn: new Date() } });
}

/**
 * Devuelve el token para enviarlo por email, o null si no corresponde (usuario inexistente,
 * inhabilitado o límite alcanzado). Quien llama debe responder igual en ambos casos.
 */
export async function solicitarRecuperacion(db: Database, entrada: { email: string; ip?: string | null }): Promise<{ token: string; expiraEn: Date; email: string; nombre: string } | null> {
  const email = normalizarEmail(entrada.email).slice(0, 254);
  const ip = entrada.ip?.slice(0, 64) || null;
  return db.$transaction(async (tx) => {
    await bloquear(tx, `recuperacion:${email}`);
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - POLITICA_ACCESO.ventanaRecuperacionMs);
    const porEmail = await tx.intentoAcceso.count({ where: { tipo: "RECUPERACION", email, createdAt: { gte: desde } } });
    const porIp = ip ? await tx.intentoAcceso.count({ where: { tipo: "RECUPERACION", ip, createdAt: { gte: desde } } }) : 0;
    if (porEmail >= POLITICA_ACCESO.maxRecuperacionesPorEmail || porIp >= POLITICA_ACCESO.maxRecuperacionesPorIp) return null;
    const usuario = await tx.usuario.findFirst({ where: { email, ...habilitado }, select: { id: true, email: true, nombre: true } });
    await tx.intentoAcceso.create({ data: { tipo: "RECUPERACION", email, ip, exitoso: !!usuario } });
    if (!usuario) return null;
    // Solo el último enlace emitido es utilizable; los anteriores quedan consumidos.
    await tx.tokenRecuperacion.updateMany({ where: { usuarioId: usuario.id, usadoEn: null }, data: { usadoEn: ahora } });
    const { token, hash } = generarToken();
    const expiraEn = new Date(ahora.getTime() + POLITICA_ACCESO.recuperacionMs);
    await tx.tokenRecuperacion.create({ data: { usuarioId: usuario.id, tokenHash: hash, createdAt: ahora, expiraEn } });
    return { token, expiraEn, email: usuario.email, nombre: usuario.nombre };
  });
}

export async function restablecerPassword(db: Database, token: string, password: string): Promise<void> {
  const motivo = validarPassword(password);
  if (motivo) throw new PasswordInvalida(motivo);
  if (!FORMATO_TOKEN.test(token)) throw new TokenInvalido();
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const ahora = new Date();
    // Consumo condicional: dos envíos simultáneos del mismo enlace no pueden ganar ambos.
    const where = { tokenHash: hashToken(token), usadoEn: null, expiraEn: { gt: ahora }, usuario: habilitado } satisfies Prisma.TokenRecuperacionWhereInput;
    const registro = await tx.tokenRecuperacion.findFirst({ where, select: { id: true, usuarioId: true } });
    if (!registro || (await tx.tokenRecuperacion.updateMany({ where: { ...where, id: registro.id }, data: { usadoEn: ahora } })).count !== 1) throw new TokenInvalido();
    await actualizarPassword(tx, registro.usuarioId, passwordHash, ahora);
  });
}

/** Alta o cambio administrativo de contraseña (bootstrap/CLI). Cierra todas las sesiones del usuario. */
export async function establecerPassword(db: Database, usuarioId: string, password: string): Promise<void> {
  const motivo = validarPassword(password);
  if (motivo) throw new PasswordInvalida(motivo);
  const passwordHash = await hashPassword(password);
  await db.$transaction(tx => actualizarPassword(tx, usuarioId, passwordHash, new Date()));
}

async function actualizarPassword(tx: Prisma.TransactionClient, usuarioId: string, passwordHash: string, ahora: Date) {
  await tx.usuario.update({ where: { id: usuarioId }, data: { passwordHash, passwordActualizadaEn: ahora } });
  await tx.sesion.updateMany({ where: { usuarioId, revocadaEn: null }, data: { revocadaEn: ahora } });
  await tx.tokenRecuperacion.updateMany({ where: { usuarioId, usadoEn: null }, data: { usadoEn: ahora } });
}

/** Organizaciones y roles vigentes del usuario, para mostrar su contexto. No concede permisos. */
export async function resumenAcceso(db: Database, usuarioId: string) {
  return db.membresiaOrganizacion.findMany({
    where: { usuarioId, activo: true, organizacion: { activo: true } },
    select: {
      organizacion: { select: { id: true, nombre: true } },
      asignaciones: { select: { rol: true, sede: { select: { nombre: true } }, franquiciado: { select: { nombre: true } } }, orderBy: { rol: "asc" } },
    },
    orderBy: { organizacion: { nombre: "asc" } },
  });
}
