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
    puedeEditarSede: permitido(actor, "sede:administrar", sedeId, franquiciadoDe),
    puedeEditarOrganizacion: actor.some(a => tienePermiso(a, "organizacion:configurar")),
    puedeCredenciales: permitido(actor, "sede:credenciales", sedeId, franquiciadoDe),
  };
}

/** Para el motor de reservas: sin actor, nunca expuesto a formularios. */
export async function configuracionEfectiva(db: Database | Prisma.TransactionClient, organizacionId: string, sedeId: string) {
  const [organizacion, sede] = await Promise.all([
    db.configuracionOrganizacion.findUnique({ where: { organizacionId } }),
    db.configuracionSede.findFirst({ where: { sedeId, organizacionId } }),
  ]);
  return resolverConfiguracion(organizacion, sede);
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
    actualizadaEn: f.updatedAt, requiereRecifrado: activa !== null && versionDe(f.secretoCifrado) !== activa,
  }));
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
