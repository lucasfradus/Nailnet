import { AccesoDenegado, cubreSede, tienePermiso, type Asignacion, type FranquiciadoDeSede, type Permiso } from "@nailnet/domain";
import { PARAMETROS, resolverConfiguracion, validarValores, type Parametro, type ValoresConfiguracion } from "@nailnet/domain/configuracion";
import { ESQUEMAS, cifrar, descifrar, llaveroDesde, pista, validarCredencial, versionDe, type Llavero, type Proveedor } from "@nailnet/domain/secretos";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, bloquearOrganizacion, exigirIds, mapaSedes } from "./access.ts";

type Ambiente = "PRUEBA" | "PRODUCCION";
const AMBIENTES: readonly Ambiente[] = ["PRUEBA", "PRODUCCION"];
const PROVEEDORES = Object.keys(ESQUEMAS) as Proveedor[];

/** Claves desde el entorno del proceso servidor. Sin configuración, cifrar falla cerrado. */
export function llaveroEntorno(): Llavero {
  return llaveroDesde(process.env.NAILNET_CLAVES_CIFRADO, process.env.NAILNET_CLAVE_ACTIVA);
}
const contexto = (sedeId: string, proveedor: Proveedor, ambiente: Ambiente) => `${sedeId}|${proveedor}|${ambiente}`;

function permitido(actor: readonly Asignacion[], permiso: Permiso, sedeId: string, franquiciadoDe: FranquiciadoDeSede) {
  return actor.some(a => tienePermiso(a, permiso) && cubreSede(a, sedeId, franquiciadoDe));
}
async function exigirSobreSede(db: Database | Prisma.TransactionClient, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  exigirIds(sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (!permitido(actor, permiso, sedeId, franquiciadoDe)) throw new AccesoDenegado();
  return { actor, franquiciadoDe };
}
const soloValores = (fila: Partial<ValoresConfiguracion> | null): Partial<ValoresConfiguracion> | null =>
  fila && Object.fromEntries((Object.keys(PARAMETROS) as Parametro[]).map(p => [p, fila[p] ?? null]));

/** Configuración de una sede visible para el actor, con el origen de cada valor efectivo. */
export async function obtenerConfiguracion(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  const { actor, franquiciadoDe } = await exigirSobreSede(db, actorId, organizacionId, sedeId, "sede:leer");
  const [organizacion, sede] = await Promise.all([
    db.configuracionOrganizacion.findUnique({ where: { organizacionId } }),
    db.configuracionSede.findUnique({ where: { sedeId } }),
  ]);
  return {
    organizacion: soloValores(organizacion),
    sede: soloValores(sede),
    efectiva: resolverConfiguracion(organizacion, sede),
    senaRecepcion: { sede: sede?.recepcionExigeSena ?? null, organizacion: organizacion?.recepcionExigeSena ?? null, efectiva: sede?.recepcionExigeSena ?? organizacion?.recepcionExigeSena ?? false },
    puedeEditarSede: permitido(actor, "sede:administrar", sedeId, franquiciadoDe),
    puedeEditarOrganizacion: actor.some(a => tienePermiso(a, "organizacion:configurar")),
    puedeCredenciales: permitido(actor, "sede:credenciales", sedeId, franquiciadoDe),
  };
}

/** Para el motor de reservas: sin actor, nunca expuesto a formularios. */
export async function configuracionEfectiva(db: Database | Prisma.TransactionClient, organizacionId: string, sedeId: string) {
  // Secuencial: puede correr dentro de una transacción (una sola conexión).
  const organizacion = await db.configuracionOrganizacion.findUnique({ where: { organizacionId } });
  const sede = await db.configuracionSede.findFirst({ where: { sedeId, organizacionId } });
  return { ...resolverConfiguracion(organizacion, sede), recepcionExigeSena: sede?.recepcionExigeSena ?? organizacion?.recepcionExigeSena ?? false };
}

/**
 * D6: si las reservas de recepción quedan pendientes de seña por Mercado Pago en vez de confirmarse.
 * sedeId null = valor de la organización (master). valor null = heredar.
 */
export async function configurarSenaRecepcion(db: Database, actorId: string, organizacionId: string, sedeId: string | null, valor: boolean | null) {
  await db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    if (sedeId) {
      await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:administrar");
      await tx.configuracionSede.upsert({ where: { sedeId }, create: { organizacionId, sedeId, recepcionExigeSena: valor }, update: { recepcionExigeSena: valor } });
    } else {
      const actor = await asignacionesActor(tx, actorId, organizacionId);
      if (!actor.some(a => tienePermiso(a, "organizacion:configurar"))) throw new AccesoDenegado();
      await tx.configuracionOrganizacion.upsert({ where: { organizacionId }, create: { organizacionId, recepcionExigeSena: valor }, update: { recepcionExigeSena: valor } });
    }
    await auditar(tx, organizacionId, actorId, "configuracion.senaRecepcion", sedeId ? "Sede" : "Organizacion", sedeId ?? organizacionId, { valor });
  });
}

function valoresValidos(entrada: Partial<Record<Parametro, number | null>>) {
  const r = validarValores(entrada);
  if ("error" in r) throw new DatosInvalidos(r.error);
  return r.valores;
}

/** null en un parámetro = heredar de la organización. */
export async function actualizarConfiguracionSede(db: Database, actorId: string, organizacionId: string, sedeId: string, entrada: Partial<Record<Parametro, number | null>>) {
  const valores = valoresValidos(entrada);
  await db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:administrar");
    await tx.configuracionSede.upsert({ where: { sedeId }, create: { organizacionId, sedeId, ...valores }, update: valores });
    await auditar(tx, organizacionId, actorId, "configuracion.sede", "Sede", sedeId, valores);
  });
}

export async function actualizarConfiguracionOrganizacion(db: Database, actorId: string, organizacionId: string, entrada: Partial<Record<Parametro, number | null>>) {
  const valores = valoresValidos(entrada);
  await db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    const actor = await asignacionesActor(tx, actorId, organizacionId);
    if (!actor.some(a => tienePermiso(a, "organizacion:configurar"))) throw new AccesoDenegado();
    await tx.configuracionOrganizacion.upsert({ where: { organizacionId }, create: { organizacionId, ...valores }, update: valores });
    await auditar(tx, organizacionId, actorId, "configuracion.organizacion", "Organizacion", organizacionId, valores);
  });
}

function exigirTipo(proveedor: string, ambiente: string): asserts proveedor is Proveedor {
  if (!PROVEEDORES.includes(proveedor as Proveedor) || !AMBIENTES.includes(ambiente as Ambiente)) throw new DatosInvalidos("Proveedor o ambiente inválido");
}

/** Estado de credenciales de la sede: datos públicos y pista. Los secretos nunca salen de este módulo. */
export async function listarCredenciales(db: Database, actorId: string, organizacionId: string, sedeId: string, llavero?: Llavero) {
  await exigirSobreSede(db, actorId, organizacionId, sedeId, "sede:credenciales");
  const activa = (() => { try { return (llavero ?? llaveroEntorno()).activa; } catch { return null; } })();
  const filas = await db.credencialProveedor.findMany({ where: { organizacionId, sedeId }, orderBy: [{ proveedor: "asc" }, { ambiente: "asc" }] });
  return filas.map(f => ({
    proveedor: f.proveedor, ambiente: f.ambiente, publicos: f.publicos as Record<string, string>, pista: f.pista,
    actualizadaEn: f.updatedAt, tokenVenceEn: f.tokenVenceEn, requiereRecifrado: activa !== null && versionDe(f.secretoCifrado) !== activa,
  }));
}

/** Para acciones que empiezan fuera de este módulo (p. ej. ir a autorizar a Mercado Pago). Se vuelve a exigir al guardar. */
export async function exigirGestionCredenciales(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  await exigirSobreSede(db, actorId, organizacionId, sedeId, "sede:credenciales");
}

/** Alta o reemplazo completo (todos los secretos se reescriben: no hay lectura para «editar»). */
export async function guardarCredencial(db: Database, actorId: string, organizacionId: string, sedeId: string, proveedor: string, ambiente: string, entrada: Record<string, string>, llavero: Llavero = llaveroEntorno()) {
  exigirTipo(proveedor, ambiente);
  const validado = validarCredencial(proveedor, entrada);
  if ("error" in validado) throw new DatosInvalidos(validado.error);
  const secretoCifrado = cifrar(llavero, JSON.stringify(validado.secretos), contexto(sedeId, proveedor, ambiente as Ambiente));
  const principal = Object.values(validado.secretos)[0]!;
  const datos = { cuentaExterna: validado.cuentaExterna, publicos: validado.publicos, secretoCifrado, pista: pista(principal), actualizadoPor: actorId };
  try {
    await db.$transaction(async tx => {
      await bloquearOrganizacion(tx, organizacionId);
      await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:credenciales");
      await tx.credencialProveedor.upsert({
        where: { sedeId_proveedor_ambiente: { sedeId, proveedor, ambiente: ambiente as Ambiente } },
        create: { organizacionId, sedeId, proveedor, ambiente: ambiente as Ambiente, ...datos },
        update: datos,
      });
      await auditar(tx, organizacionId, actorId, "credencial.guardar", "Sede", sedeId, { proveedor, ambiente, publicos: validado.publicos });
    });
  } catch (e) {
    // Solo hay dos únicos: (sede, proveedor, ambiente) se resuelve con upsert; el otro es la cuenta externa.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos("Esa cuenta del proveedor ya está vinculada a otra sede");
    throw e;
  }
}

export async function eliminarCredencial(db: Database, actorId: string, organizacionId: string, sedeId: string, proveedor: string, ambiente: string) {
  exigirTipo(proveedor, ambiente);
  await db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:credenciales");
    const { count } = await tx.credencialProveedor.deleteMany({ where: { organizacionId, sedeId, proveedor, ambiente: ambiente as Ambiente } });
    if (count) await auditar(tx, organizacionId, actorId, "credencial.eliminar", "Sede", sedeId, { proveedor, ambiente });
  });
}

/**
 * Solo para adaptadores de integración en servidor (worker/webhooks). No tiene actor: nunca llamarla
 * con parámetros de un formulario ni devolver su resultado al navegador.
 */
export async function leerCredencial(db: Database, sedeId: string, proveedor: Proveedor, ambiente: Ambiente, llavero: Llavero = llaveroEntorno()) {
  const fila = await db.credencialProveedor.findUnique({ where: { sedeId_proveedor_ambiente: { sedeId, proveedor, ambiente } } });
  if (!fila) return null;
  const secretos = JSON.parse(descifrar(llavero, fila.secretoCifrado, contexto(sedeId, proveedor, ambiente))) as Record<string, string>;
  return { publicos: fila.publicos as Record<string, string>, secretos };
}

// ─── Mercado Pago por OAuth ───────────────────────────────────────────────────

/** Tokens de una cuenta autorizada (los arma @nailnet/integrations/mercadopago). */
export type TokensOAuth = { accessToken: string; refreshToken: string; publicKey: string | null; cuentaId: string; expiraEn: Date };
/** Pide tokens nuevos con el refresh token. Se inyecta: las pruebas usan uno falso. */
export type RenovadorTokens = (refreshToken: string) => Promise<TokensOAuth>;
/** Los tokens de Mercado Pago duran 180 días; se renuevan cuando les quedan menos de 30. */
export const MARGEN_RENOVACION_MS = 30 * 86_400_000;

function filaOAuth(sedeId: string, ambiente: Ambiente, t: TokensOAuth, llavero: Llavero) {
  return {
    cuentaExterna: t.cuentaId,
    publicos: { cuentaId: t.cuentaId, ...(t.publicKey ? { publicKey: t.publicKey } : {}) },
    secretoCifrado: cifrar(llavero, JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken }), contexto(sedeId, "MERCADO_PAGO", ambiente)),
    pista: pista(t.accessToken), tokenVenceEn: t.expiraEn,
  };
}

/**
 * Guarda la cuenta que la sede acaba de autorizar en Mercado Pago (callback de OAuth). Vuelve a exigir
 * el permiso dentro de la transacción: entre el inicio y el regreso pudo haber cambiado.
 */
export async function vincularMercadoPago(db: Database, actorId: string, organizacionId: string, sedeId: string, ambiente: string, tokens: TokensOAuth, llavero: Llavero = llaveroEntorno()) {
  exigirTipo("MERCADO_PAGO", ambiente);
  if (!/^\d{3,20}$/.test(tokens.cuentaId)) throw new DatosInvalidos("Mercado Pago devolvió una cuenta inválida");
  const datos = { ...filaOAuth(sedeId, ambiente as Ambiente, tokens, llavero), actualizadoPor: actorId };
  try {
    await db.$transaction(async tx => {
      await bloquearOrganizacion(tx, organizacionId);
      await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:credenciales");
      await tx.credencialProveedor.upsert({
        where: { sedeId_proveedor_ambiente: { sedeId, proveedor: "MERCADO_PAGO", ambiente: ambiente as Ambiente } },
        create: { organizacionId, sedeId, proveedor: "MERCADO_PAGO", ambiente: ambiente as Ambiente, ...datos },
        update: datos,
      });
      await auditar(tx, organizacionId, actorId, "credencial.vincular", "Sede", sedeId, { proveedor: "MERCADO_PAGO", ambiente, publicos: datos.publicos });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos("Esa cuenta de Mercado Pago ya está vinculada a otra sede");
    throw e;
  }
}

/** Si la sede tiene una cuenta de Mercado Pago vinculada en el ambiente, sin descifrar nada (webhook). */
export async function tieneCuentaMercadoPago(db: Database, sedeId: string, ambiente: Ambiente) {
  return (await db.credencialProveedor.count({ where: { sedeId, proveedor: "MERCADO_PAGO", ambiente } })) > 0;
}

type Vigente = { accessToken: string; cuentaId: string | null };
const porVencer = (venceEn: Date | null, ahora: Date) => venceEn !== null && venceEn.getTime() - ahora.getTime() < MARGEN_RENOVACION_MS;

/**
 * Renueva bajo lock de la fila: el refresh token es de un solo uso y lo pueden intentar a la vez el
 * worker, el webhook y el portal. Quien llega segundo encuentra la fila ya renovada y no llama a la API.
 */
async function renovarCredencial(db: Database, id: string, renovar: RenovadorTokens, ahora: Date, llavero: Llavero): Promise<Vigente | null> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS ok FROM "CredencialProveedor" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const f = await tx.credencialProveedor.findUnique({ where: { id } });
    if (!f) return null;
    const ambiente = f.ambiente as Ambiente;
    const s = JSON.parse(descifrar(llavero, f.secretoCifrado, contexto(f.sedeId, "MERCADO_PAGO", ambiente))) as Record<string, string>;
    const cuentaId = (f.publicos as Record<string, string>).cuentaId ?? null;
    if (!porVencer(f.tokenVenceEn, ahora) || !s.refreshToken) return { accessToken: s.accessToken!, cuentaId };
    const t = await renovar(s.refreshToken);
    // Nunca reemplazar la cuenta receptora de la sede en silencio.
    if (cuentaId && t.cuentaId !== cuentaId) throw new Error("La renovación devolvió otra cuenta de Mercado Pago");
    await tx.credencialProveedor.update({ where: { id }, data: filaOAuth(f.sedeId, ambiente, t, llavero) });
    return { accessToken: t.accessToken, cuentaId: t.cuentaId };
  }, { timeout: 30_000 });
}

/**
 * Access token vigente de la cuenta de Mercado Pago de la sede, renovado si está por vencer. Mismas
 * reglas que leerCredencial: solo servidor, nunca con datos de un formulario. Si la renovación falla
 * pero el token todavía sirve, se usa igual: un problema de renovación no frena un cobro.
 */
export async function tokenMercadoPago(db: Database, sedeId: string, ambiente: Ambiente, renovar: RenovadorTokens | null, ahora = new Date(), llavero: Llavero = llaveroEntorno()): Promise<Vigente | null> {
  const fila = await db.credencialProveedor.findUnique({ where: { sedeId_proveedor_ambiente: { sedeId, proveedor: "MERCADO_PAGO", ambiente } } });
  if (!fila) return null;
  const actual = (): Vigente => ({ accessToken: (JSON.parse(descifrar(llavero, fila.secretoCifrado, contexto(sedeId, "MERCADO_PAGO", ambiente))) as Record<string, string>).accessToken!, cuentaId: (fila.publicos as Record<string, string>).cuentaId ?? null });
  if (!renovar || !porVencer(fila.tokenVenceEn, ahora)) return actual();
  try {
    return await renovarCredencial(db, fila.id, renovar, ahora, llavero);
  } catch (e) {
    if (fila.tokenVenceEn! > ahora) { console.error("No se pudo renovar el token de Mercado Pago", e instanceof Error ? e.message : e); return actual(); }
    throw e;
  }
}

/** Tarea del worker: renueva las cuentas que entran en el margen, aunque no se esté cobrando nada. */
export async function renovarTokensPorVencer(db: Database, renovar: RenovadorTokens, ahora = new Date(), llavero: Llavero = llaveroEntorno()) {
  const filas = await db.credencialProveedor.findMany({ where: { proveedor: "MERCADO_PAGO", tokenVenceEn: { lt: new Date(ahora.getTime() + MARGEN_RENOVACION_MS) } }, select: { id: true } });
  let renovadas = 0, fallidas = 0;
  for (const { id } of filas) {
    try { await renovarCredencial(db, id, renovar, ahora, llavero); renovadas++; }
    catch (e) { fallidas++; console.error("No se pudo renovar el token de Mercado Pago", id, e instanceof Error ? e.message : e); }
  }
  return { renovadas, fallidas };
}

/** Rotación: reescribe con la versión activa todo lo cifrado con versiones anteriores. Idempotente. */
export async function recifrarCredenciales(db: Database, llavero: Llavero = llaveroEntorno()) {
  const filas = await db.credencialProveedor.findMany({ where: { NOT: { secretoCifrado: { startsWith: `gcm.${llavero.activa}.` } } } });
  for (const f of filas) {
    const ctx = contexto(f.sedeId, f.proveedor, f.ambiente);
    const nuevo = cifrar(llavero, descifrar(llavero, f.secretoCifrado, ctx), ctx);
    // Condicional: si alguien la reemplazó mientras tanto, no se pisa el valor nuevo.
    await db.credencialProveedor.updateMany({ where: { id: f.id, secretoCifrado: f.secretoCifrado }, data: { secretoCifrado: nuevo } });
  }
  return filas.length;
}
