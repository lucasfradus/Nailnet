import { createHash } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { aCentavos, importe, servicioEfectivo, type Sena } from "@nailnet/domain/catalogo";
import { normalizarTelefono, validarCliente } from "@nailnet/domain/clientes";
import { generarToken, hashToken, normalizarEmail } from "@nailnet/domain/credenciales";
import { rutaImagen, type ReservaPublicaEstado, type ReservaPublicaRespuesta, type ReservaPublicaSolicitud, type ServicioPublico, type TerminoPublico, type TurnoPublico } from "@nailnet/contracts/publico";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, exigirIds } from "./access.ts";
import { ConfiguracionIncompleta, consultarDisponibilidad } from "./disponibilidad.ts";
import { TurnoNoDisponible, tomarTurno, type Tx } from "./reservas.ts";

/** Valores técnicos anti-abuso (propuesta; ajustables cuando haya tráfico real). */
export const POLITICA_PUBLICA = {
  intentosPorIp: 20, ventanaIpMs: 10 * 60_000,
  pendientesPorContacto: 2,
  vidaTokenPosteriorMs: 7 * 86_400_000,
  vidaIdempotenciaMs: 24 * 3_600_000,
} as const;

export class LimiteExcedido extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "LimiteExcedido"; }
}
export class ConflictoIdempotencia extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "ConflictoIdempotencia"; }
}

const sha = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");
const senaDe = (tipo: string | null, valor: Prisma.Decimal | null): Sena => (tipo ? { tipo: tipo as "FIJA", valor: valor === null ? null : tipo === "PORCENTAJE" ? valor.toFixed(0) : valor.toFixed(2) } : null);

/** Sede pública: activa, de franquiciado y organización activos. Devuelve su organización. */
async function sedePublica(db: Database | Tx, sedeId: string) {
  exigirIds(sedeId);
  const sede = await db.sede.findFirst({ where: { id: sedeId, activo: true, franquiciado: { activo: true, organizacion: { activo: true } } }, select: { id: true, nombre: true, organizacionId: true, timezone: true } });
  if (!sede) throw new AccesoDenegado();
  return sede;
}

async function organizacionPublica(db: Database, slug: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new AccesoDenegado();
  const org = await db.organizacion.findFirst({ where: { slug, activo: true }, select: { id: true } });
  if (!org) throw new AccesoDenegado();
  return org;
}

export async function sedesPublicas(db: Database, slug: string) {
  const org = await organizacionPublica(db, slug);
  return db.sede.findMany({ where: { organizacionId: org.id, activo: true, franquiciado: { activo: true } }, select: { id: true, nombre: true, timezone: true }, orderBy: { nombre: "asc" } });
}

/** Versión vigente de cada término publicado: lo que el invitado acepta al reservar (misma consulta que crearReservaPublica). */
export async function terminosPublicos(db: Database, slug: string): Promise<TerminoPublico[]> {
  const org = await organizacionPublica(db, slug);
  return db.consentimientoVersion.findMany({ where: { organizacionId: org.id, tipo: "TERMINOS" }, orderBy: [{ clave: "asc" }, { version: "desc" }], distinct: ["clave"], select: { clave: true, version: true, titulo: true, texto: true } });
}

/** Solo servicios en condiciones de reservarse online (precio, seña definida, habilitado). */
export async function serviciosPublicos(db: Database, sedeId: string): Promise<ServicioPublico[]> {
  const sede = await sedePublica(db, sedeId);
  const servicios = await db.servicio.findMany({ where: { organizacionId: sede.organizacionId, activo: true, sedes: { some: { sedeId, habilitado: true } } }, include: { categoria: true, sedes: { where: { sedeId } } }, orderBy: [{ categoria: { orden: "asc" } }, { nombre: "asc" }] });
  return servicios.flatMap(s => {
    const ss = s.sedes[0]!;
    const e = servicioEfectivo({ duracionMinutos: s.duracionMinutos, bufferAntesMinutos: s.bufferAntesMinutos, bufferDespuesMinutos: s.bufferDespuesMinutos, sena: senaDe(s.senaTipo, s.senaValor), activo: s.activo },
      { habilitado: ss.habilitado, precio: ss.precio?.toFixed(2) ?? null, duracionMinutos: ss.duracionMinutos, sena: senaDe(ss.senaTipo, ss.senaValor), reservableOnline: ss.reservableOnline });
    return e.reservableOnline ? [{ id: s.id, nombre: s.nombre, categoria: s.categoria.nombre, descripcion: s.descripcion, imagenUrl: rutaImagen(s.imagenId), duracionMinutos: e.duracionMinutos, precio: e.precio!, sena: e.sena! }] : [];
  });
}

/** Profesionales aptos para el servicio en la sede. Solo nombre e inicial del apellido. */
export async function profesionalesPublicos(db: Database, sedeId: string, servicioId?: string | null) {
  const sede = await sedePublica(db, sedeId);
  exigirIds(servicioId);
  const requeridas = servicioId ? (await db.servicioSkill.findMany({ where: { servicioId }, select: { skillId: true } })).map(s => s.skillId) : [];
  const pros = await db.profesional.findMany({
    where: { organizacionId: sede.organizacionId, activo: true, sedes: { some: { sedeId, activo: true } }, ...(servicioId ? { servicios: { some: { servicioId } } } : {}) },
    include: { skills: { select: { skillId: true } } }, orderBy: { nombre: "asc" },
  });
  return pros.filter(p => requeridas.every(r => p.skills.some(s => s.skillId === r))).map(p => ({ id: p.id, nombre: p.apellido ? `${p.nombre} ${p.apellido[0]}.` : p.nombre, fotoUrl: rutaImagen(p.fotoId) }));
}

export async function disponibilidadPublica(db: Database, sedeId: string, fecha: string, items: { servicioId: string; profesionalId?: string | null }[], ahora = new Date()): Promise<TurnoPublico[]> {
  const sede = await sedePublica(db, sedeId);
  const turnos = await consultarDisponibilidad(db, null, sede.organizacionId, { sedeId, fecha, canal: "ONLINE", items }, ahora);
  // Sin IDs de recursos ni apellidos: solo lo que el portal necesita mostrar.
  return turnos.map(t => ({ inicio: t.inicio, fin: t.fin, items: t.items.map(i => ({ servicioId: i.servicioId, profesionalId: i.profesionalId, profesional: i.profesional.split(" ")[0]!, inicio: i.inicio, fin: i.fin })) }));
}

async function bloquearClave(tx: Tx, clave: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))) AS l`;
}

/**
 * Crea una reserva invitada desde el portal. Idempotente por `Idempotency-Key`: la misma clave con el
 * mismo contenido devuelve el mismo resultado (con un token nuevo: el anterior se revoca, nunca se
 * guarda un token en claro); con otro contenido, ConflictoIdempotencia. Límites durables por IP y por
 * contacto contra el acaparamiento de turnos.
 */
export async function crearReservaPublica(db: Database, entrada: { solicitud: ReservaPublicaSolicitud; claveIdempotencia: string; ip?: string | null }, ahora = new Date()): Promise<{ codigo: number; cuerpo: ReservaPublicaRespuesta | { error: { codigo: string; mensaje: string } } }> {
  const { solicitud: s } = entrada;
  const sede = await sedePublica(db, s.sedeId);
  const org = sede.organizacionId;
  const hashSolicitud = sha(JSON.stringify([s.sedeId, s.fecha, s.inicio, s.items, normalizarEmail(s.cliente.email), s.cliente.telefono, s.cliente.nombre, s.cliente.apellido ?? null]));
  const ambito = "reserva_publica";

  // 1. Idempotencia: reservar la clave (EN_CURSO) o reutilizar el resultado anterior.
  await db.claveIdempotencia.deleteMany({ where: { organizacionId: org, ambito, clave: entrada.claveIdempotencia, expiraEn: { lte: ahora } } });
  try {
    await db.claveIdempotencia.create({ data: { organizacionId: org, ambito, clave: entrada.claveIdempotencia, hashSolicitud, estado: "EN_CURSO", expiraEn: new Date(ahora.getTime() + POLITICA_PUBLICA.vidaIdempotenciaMs) } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const previa = await db.claveIdempotencia.findUniqueOrThrow({ where: { organizacionId_ambito_clave: { organizacionId: org, ambito, clave: entrada.claveIdempotencia } } });
    if (previa.hashSolicitud !== hashSolicitud) throw new ConflictoIdempotencia("La Idempotency-Key ya se usó con otra solicitud");
    if (previa.estado === "EN_CURSO") throw new ConflictoIdempotencia("La solicitud anterior con esta clave todavía está en proceso");
    if (previa.codigo === 201 && previa.reservaId) return { codigo: 201, cuerpo: { ...(previa.respuesta as Omit<ReservaPublicaRespuesta, "token">), token: await emitirToken(db, org, previa.reservaId, true) } };
    return { codigo: previa.codigo!, cuerpo: previa.respuesta as { error: { codigo: string; mensaje: string } } };
  }
  const cerrar = (codigo: number, respuesta: object, reservaId?: string) => db.claveIdempotencia.update({
    where: { organizacionId_ambito_clave: { organizacionId: org, ambito, clave: entrada.claveIdempotencia } },
    data: { estado: "COMPLETADA", codigo, respuesta: respuesta as Prisma.InputJsonValue, reservaId },
  });

  try {
    // 2. Límite por IP (durable): cuenta intentos recientes y registra este.
    if (entrada.ip) {
      const clave = sha(`ip:${entrada.ip}`);
      const recientes = await db.eventoPublico.count({ where: { tipo: ambito, clave, createdAt: { gte: new Date(ahora.getTime() - POLITICA_PUBLICA.ventanaIpMs) } } });
      if (recientes >= POLITICA_PUBLICA.intentosPorIp) throw new LimiteExcedido("Demasiados intentos desde esta conexión. Probá de nuevo en unos minutos.");
      await db.eventoPublico.create({ data: { tipo: ambito, clave } });
    }
    const email = normalizarEmail(s.cliente.email);
    const datos = validarCliente({ nombre: s.cliente.nombre, apellido: s.cliente.apellido, email, telefono: s.cliente.telefono });
    if ("error" in datos) throw new DatosInvalidos(datos.error);
    if (!normalizarTelefono(s.cliente.telefono)) throw new DatosInvalidos("Teléfono inválido");

    const turno = await tomarTurno(db, null, org, { sedeId: s.sedeId, fecha: s.fecha, canal: "ONLINE", items: s.items, inicio: new Date(s.inicio) }, ahora, {
      // 3. Dentro de la transacción del turno: cliente invitado, términos y límite por contacto.
      antes: async tx => {
        await bloquearClave(tx, `contacto:${org}:${email}`);
        // La identidad existente no se modifica desde el portal: solo se usa (D13, sin datos de terceros).
        const cliente = await tx.cliente.findUnique({ where: { organizacionId_email: { organizacionId: org, email } }, select: { id: true } })
          ?? await tx.cliente.create({ data: { organizacionId: org, ...datos.datos }, select: { id: true } });
        const pendientes = await tx.reserva.count({ where: { organizacionId: org, clienteId: cliente.id, estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { gt: ahora } } });
        if (pendientes >= POLITICA_PUBLICA.pendientesPorContacto) throw new LimiteExcedido("Ya tenés turnos pendientes de pago. Completá o esperá a que venzan antes de reservar otro.");
        const terminos = await tx.consentimientoVersion.findMany({ where: { organizacionId: org, tipo: "TERMINOS" }, orderBy: [{ clave: "asc" }, { version: "desc" }], distinct: ["clave"] });
        for (const v of terminos) await tx.clienteConsentimiento.create({ data: { organizacionId: org, clienteId: cliente.id, versionId: v.id, sedeId: s.sedeId, accion: "ACEPTA", canal: "PORTAL", evidencia: { ip: entrada.ip ? sha(`ip:${entrada.ip}`) : null, idempotencia: entrada.claveIdempotencia } } });
        return { clienteId: cliente.id };
      },
    });

    const sena = turno.items.reduce((t, i) => t + (aCentavos(i.sena ?? "0") ?? 0n), 0n);
    const respuesta = { reservaId: turno.reservaId, estado: turno.estado, expiraEn: turno.expiraEn?.toISOString() ?? null, sena: importe(sena) };
    const token = await emitirToken(db, org, turno.reservaId, false);
    await cerrar(201, respuesta, turno.reservaId);
    return { codigo: 201, cuerpo: { ...respuesta, token } };
  } catch (e) {
    // Resultados definitivos se recuerdan: reintentar con la misma clave devuelve lo mismo.
    if (e instanceof TurnoNoDisponible) { const cuerpo = { error: { codigo: "NO_DISPONIBLE", mensaje: e.message } }; await cerrar(409, cuerpo); return { codigo: 409, cuerpo }; }
    if (e instanceof DatosInvalidos || e instanceof ConfiguracionIncompleta) { const cuerpo = { error: { codigo: "INVALIDO", mensaje: e.message } }; await cerrar(422, cuerpo); return { codigo: 422, cuerpo }; }
    // Límites y fallos inesperados liberan la clave para poder reintentar más tarde.
    await db.claveIdempotencia.deleteMany({ where: { organizacionId: org, ambito, clave: entrada.claveIdempotencia, estado: "EN_CURSO" } });
    throw e;
  }
}

/** Token de consulta del invitado. `rotar` revoca los anteriores (reintento idempotente). */
async function emitirToken(db: Database, organizacionId: string, reservaId: string, rotar: boolean) {
  const items = await db.reservaItem.findMany({ where: { reservaId }, select: { fin: true }, orderBy: { fin: "desc" }, take: 1 });
  const { token, hash } = generarToken();
  await db.$transaction(async tx => {
    if (rotar) await tx.tokenReserva.updateMany({ where: { reservaId, revocadoEn: null }, data: { revocadoEn: new Date() } });
    await tx.tokenReserva.create({ data: { organizacionId, reservaId, tokenHash: hash, expiraEn: new Date((items[0]?.fin.getTime() ?? Date.now()) + POLITICA_PUBLICA.vidaTokenPosteriorMs) } });
  });
  return token;
}

export const tokenConFormato = (token: string | null): token is string => !!token && /^[A-Za-z0-9_-]{43}$/.test(token);

/** Estado de la reserva para el invitado, con datos mínimos. Token inválido, vencido o revocado = no encontrado. */
export async function consultarReservaPublica(db: Database, token: string | null, ahora = new Date()): Promise<ReservaPublicaEstado> {
  if (!tokenConFormato(token)) throw new AccesoDenegado();
  const t = await db.tokenReserva.findFirst({
    where: { tokenHash: hashToken(token), revocadoEn: null, expiraEn: { gt: ahora } },
    include: { reserva: { include: { sede: { select: { nombre: true } }, items: { orderBy: { posicion: "asc" }, include: { servicio: { select: { nombre: true, imagenId: true } }, profesional: { select: { nombre: true, fotoId: true } } } } } } },
  });
  if (!t) throw new AccesoDenegado();
  const r = t.reserva;
  const vencida = ["PENDIENTE_PAGO", "PAGO_EN_REVISION"].includes(r.estado) && r.expiraEn !== null && r.expiraEn <= ahora;
  return {
    estado: vencida ? "EXPIRADA" : r.estado, expiraEn: r.expiraEn?.toISOString() ?? null, sede: r.sede.nombre,
    sena: importe(r.items.reduce((s, i) => s + (aCentavos(i.sena?.toFixed(2) ?? "0") ?? 0n), 0n)),
    items: r.items.map(i => ({ servicio: i.servicio.nombre, imagenUrl: rutaImagen(i.servicio.imagenId), profesional: i.profesional.nombre, fotoUrl: rutaImagen(i.profesional.fotoId), inicio: i.inicio.toISOString(), fin: i.fin.toISOString() })),
  };
}

/**
 * Limpieza de datos técnicos del portal: claves de idempotencia vencidas (24 h), eventos anti-abuso
 * fuera de toda ventana (se guardan 1 día) y tokens de invitado vencidos o revocados hace más de 30
 * días. Idempotente: correrla dos veces no cambia nada.
 */
export async function limpiarDatosPublicos(db: Database, ahora = new Date()) {
  const dia = 86_400_000;
  const [claves, eventos, tokens] = await Promise.all([
    db.claveIdempotencia.deleteMany({ where: { expiraEn: { lt: ahora } } }),
    db.eventoPublico.deleteMany({ where: { createdAt: { lt: new Date(ahora.getTime() - dia) } } }),
    db.tokenReserva.deleteMany({ where: { OR: [{ expiraEn: { lt: new Date(ahora.getTime() - 30 * dia) } }, { revocadoEn: { lt: new Date(ahora.getTime() - 30 * dia) } }] } }),
  ]);
  return { claves: claves.count, eventos: eventos.count, tokens: tokens.count };
}
