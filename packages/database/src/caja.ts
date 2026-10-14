// O02 · Caja y cierres. Ver docs/27-ventas-caja.md.
// Una caja por sede desde su apertura hasta su cierre; solo efectivo. Cada operación autoriza en el
// repositorio con el alcance del actor (cubreSede): un ID fuera del alcance equivale a inexistente.
// Lock: la fila de la caja (FOR UPDATE) serializa movimientos y cierre. Orden global de locks en
// ventas y caja: venta → saldos de stock → caja, para no generar deadlocks entre operaciones.
import { AccesoDenegado, cubreSede, tienePermiso, type Asignacion, type FranquiciadoDeSede, type PermisoVenta } from "@nailnet/domain";
import { importe } from "@nailnet/domain/catalogo";
import { dejaNegativo, diferenciaArqueo, importeNoNegativo, resumirCaja, revertibleDesdeCaja, signoValidoCaja, validarManual, type TipoMovimientoCaja } from "@nailnet/domain/caja";
import { normalizarTexto } from "@nailnet/domain/gastos";
import { resumirCobros, validarMotivo, type MedioCobro } from "@nailnet/domain/ventas";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, exigirIds, mapaSedes } from "./access.ts";
import { conReintento } from "./reservas.ts";

type Tx = Prisma.TransactionClient;
type Cliente = Database | Tx;
export const centavos = (d: Prisma.Decimal | string) => BigInt(new Prisma.Decimal(d).mul(100).toFixed(0));
const esUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ─── Permisos ─────────────────────────────────────────────────────────────────

export function puedeEnSede(actor: readonly Asignacion[], permiso: PermisoVenta, sedeId: string, franquiciadoDe: FranquiciadoDeSede) {
  return actor.some(a => tienePermiso(a, permiso) && cubreSede(a, sedeId, franquiciadoDe));
}
/** Exige el permiso de ventas/caja sobre la sede; devuelve el actor para decidir qué más mostrar. */
export async function exigirSedeVenta(db: Cliente, actorId: string, organizacionId: string, sedeId: string, permiso: PermisoVenta) {
  exigirIds(sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (!puedeEnSede(actor, permiso, sedeId, franquiciadoDe)) throw new AccesoDenegado();
  const puede = (p: PermisoVenta) => puedeEnSede(actor, p, sedeId, franquiciadoDe);
  return { actor, franquiciadoDe, puede };
}

// ─── Núcleo: caja abierta bajo lock y movimientos ─────────────────────────────

export type CajaBloqueada = { id: string; montoInicial: bigint; esperado: bigint };

/**
 * La caja abierta de la sede, bloqueada (FOR UPDATE) con su efectivo esperado, o null si está cerrada.
 * Bajo este lock se calcula el esperado y se insertan los movimientos; el cierre toma el mismo lock.
 */
export async function cajaAbiertaBloqueada(tx: Tx, organizacionId: string, sedeId: string): Promise<CajaBloqueada | null> {
  const [caja] = await tx.$queryRaw<{ id: string; montoInicial: string }[]>`
    SELECT id::text AS id, "montoInicial"::text AS "montoInicial" FROM "Caja"
    WHERE "organizacionId" = ${organizacionId}::uuid AND "sedeId" = ${sedeId}::uuid AND estado = 'ABIERTA'
    FOR UPDATE`;
  if (!caja) return null;
  const [suma] = await tx.$queryRaw<{ total: string }[]>`SELECT COALESCE(sum(monto), 0)::text AS total FROM "MovimientoCaja" WHERE "cajaId" = ${caja.id}::uuid`;
  const montoInicial = centavos(caja.montoInicial);
  return { id: caja.id, montoInicial, esperado: montoInicial + centavos(suma!.total) };
}

export type NuevoMovimiento = { tipo: TipoMovimientoCaja; monto: bigint; motivo?: string | null; cobroId?: string; gastoId?: string; revierteId?: string };

/** Inserta un movimiento en una caja ya bloqueada. El efectivo nunca queda negativo. */
export async function asentarMovimiento(tx: Tx, organizacionId: string, sedeId: string, actorId: string, caja: CajaBloqueada, m: NuevoMovimiento) {
  if (!signoValidoCaja(m.tipo, m.monto)) throw new DatosInvalidos("Movimiento de caja inválido");
  if (dejaNegativo(caja.esperado, m.monto)) throw new DatosInvalidos(`La caja no tiene efectivo suficiente: hay ${pesos(caja.esperado)} y se necesitan ${pesos(-m.monto)}`);
  const mov = await tx.movimientoCaja.create({
    data: { organizacionId, sedeId, cajaId: caja.id, tipo: m.tipo, monto: importe(m.monto), motivo: m.motivo ?? null, cobroId: m.cobroId, gastoId: m.gastoId, revierteId: m.revierteId, registradoPorId: actorId },
    select: { id: true },
  });
  caja.esperado += m.monto;
  return mov;
}

const pesos = (c: bigint) => `$ ${importe(c).replace(".", ",")}`;

/** Lo que se le pide a quien quiere mover efectivo sin caja abierta. */
export const SIN_CAJA = "La caja de la sede está cerrada: abrila para registrar movimientos en efectivo";

// ─── Operaciones ──────────────────────────────────────────────────────────────

/** Abre la caja de la sede con el efectivo inicial. Solo una abierta por sede (índice único parcial). */
export async function abrirCaja(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; montoInicial: string }) {
  const inicial = importeNoNegativo(datos.montoInicial);
  if (inicial === null) throw new DatosInvalidos("Efectivo inicial inválido: cero o más, con hasta 2 decimales");
  try {
    return await db.$transaction(async tx => {
      await exigirSedeVenta(tx, actorId, organizacionId, datos.sedeId, "caja:operar");
      if (!await tx.sede.count({ where: { id: datos.sedeId, organizacionId, activo: true } })) throw new AccesoDenegado();
      const caja = await tx.caja.create({ data: { organizacionId, sedeId: datos.sedeId, estado: "ABIERTA", montoInicial: importe(inicial), abiertaPorId: actorId }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, "caja.abrir", "Caja", caja.id, { sedeId: datos.sedeId, montoInicial: importe(inicial) });
      return caja;
    });
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos("La sede ya tiene una caja abierta");
    throw e;
  }
}

/** Entrada o salida manual de efectivo con motivo (cambio, retiro para depositar, etc.). */
export async function registrarMovimientoManual(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; tipo: string; monto: string; motivo: string }) {
  const v = validarManual(datos.tipo, datos.monto, datos.motivo);
  if ("error" in v) throw new DatosInvalidos(v.error);
  return conReintento(() => db.$transaction(async tx => {
    await exigirSedeVenta(tx, actorId, organizacionId, datos.sedeId, "caja:operar");
    const caja = await cajaAbiertaBloqueada(tx, organizacionId, datos.sedeId);
    if (!caja) throw new DatosInvalidos(SIN_CAJA);
    const mov = await asentarMovimiento(tx, organizacionId, datos.sedeId, actorId, caja, { tipo: v.tipo, monto: v.monto, motivo: v.motivo });
    await auditar(tx, organizacionId, actorId, "caja.movimiento", "MovimientoCaja", mov.id, { tipo: v.tipo, monto: importe(v.monto), motivo: v.motivo });
    return mov;
  }));
}

/**
 * Revierte una entrada o salida manual con el movimiento inverso, en la caja abierta al momento de
 * revertir (una caja cerrada no se reescribe). Cobros y gastos se anulan desde su módulo.
 */
export async function revertirMovimientoCaja(db: Database, actorId: string, organizacionId: string, movimientoId: string, motivo: string) {
  exigirIds(movimientoId);
  const m = validarMotivo(motivo);
  if ("error" in m) throw new DatosInvalidos(m.error);
  try {
    return await conReintento(() => db.$transaction(async tx => {
      const original = await tx.movimientoCaja.findFirst({ where: { id: movimientoId, organizacionId }, select: { sedeId: true, tipo: true, monto: true, reverso: { select: { id: true } } } });
      if (!original) throw new AccesoDenegado();
      await exigirSedeVenta(tx, actorId, organizacionId, original.sedeId, "caja:operar");
      if (!revertibleDesdeCaja(original.tipo)) throw new DatosInvalidos("Desde la caja solo se revierten entradas y salidas manuales. Un cobro se anula desde la venta y un gasto desde Gastos");
      if (original.reverso) throw new DatosInvalidos("Ese movimiento ya fue revertido");
      const caja = await cajaAbiertaBloqueada(tx, organizacionId, original.sedeId);
      if (!caja) throw new DatosInvalidos(SIN_CAJA);
      const mov = await asentarMovimiento(tx, organizacionId, original.sedeId, actorId, caja, { tipo: "REVERSO", monto: -centavos(original.monto), motivo: m.motivo, revierteId: movimientoId });
      await auditar(tx, organizacionId, actorId, "caja.reverso", "MovimientoCaja", movimientoId, { reversoId: mov.id, motivo: m.motivo });
      return mov;
    }));
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos("Ese movimiento ya fue revertido");
    throw e;
  }
}

/**
 * Cierra la caja con el conteo físico. El esperado se calcula bajo el lock de la caja (un cobro en
 * efectivo concurrente entra antes o espera y encuentra la caja cerrada); la diferencia es contado −
 * esperado. El cierre queda fijo: las correcciones posteriores van a la caja que esté abierta.
 */
export async function cerrarCaja(db: Database, actorId: string, organizacionId: string, datos: { cajaId: string; contado: string; observaciones?: string | null }) {
  exigirIds(datos.cajaId);
  const contado = importeNoNegativo(datos.contado);
  if (contado === null) throw new DatosInvalidos("Efectivo contado inválido: cero o más, con hasta 2 decimales");
  const observaciones = normalizarTexto(datos.observaciones);
  if (observaciones.length > 500) throw new DatosInvalidos("Las observaciones tienen hasta 500 caracteres");
  return conReintento(() => db.$transaction(async tx => {
    const actual = await tx.caja.findFirst({ where: { id: datos.cajaId, organizacionId }, select: { sedeId: true } });
    if (!actual) throw new AccesoDenegado();
    await exigirSedeVenta(tx, actorId, organizacionId, actual.sedeId, "caja:operar");
    const caja = await cajaAbiertaBloqueada(tx, organizacionId, actual.sedeId);
    if (!caja || caja.id !== datos.cajaId) throw new DatosInvalidos("La caja ya está cerrada");
    const diferencia = diferenciaArqueo(contado, caja.esperado);
    await tx.caja.update({ where: { id: caja.id }, data: {
      estado: "CERRADA", cerradaPorId: actorId, cerradaEn: new Date(), esperado: importe(caja.esperado), contado: importe(contado), diferencia: importe(diferencia), observaciones: observaciones || null,
    } });
    await auditar(tx, organizacionId, actorId, "caja.cerrar", "Caja", caja.id, { esperado: importe(caja.esperado), contado: importe(contado), diferencia: importe(diferencia) });
    return { esperado: importe(caja.esperado), contado: importe(contado), diferencia: importe(diferencia) };
  }));
}

// ─── Consultas ────────────────────────────────────────────────────────────────

const MEDIO_COBRO = (m: string) => m as MedioCobro;

/** Detalle de una caja: movimientos, resumen por tipo, esperado y cobros no efectivo por medio (aparte). */
async function detalle(db: Cliente, organizacionId: string, cajaId: string) {
  const caja = await db.caja.findFirstOrThrow({ where: { id: cajaId, organizacionId } });
  const movimientos = await db.movimientoCaja.findMany({
    where: { organizacionId, cajaId }, orderBy: { orden: "asc" },
    select: { id: true, tipo: true, monto: true, motivo: true, createdAt: true, registradoPorId: true, revierteId: true, reverso: { select: { id: true } },
      cobro: { select: { ventaId: true } }, gasto: { select: { id: true, descripcion: true } } },
  });
  const cobros = await db.cobroVenta.findMany({ where: { organizacionId, cajaId }, select: { medio: true, monto: true } });
  const usuarios = await db.usuario.findMany({ where: { id: { in: [...new Set([caja.abiertaPorId, caja.cerradaPorId, ...movimientos.map(m => m.registradoPorId)].filter((x): x is string => !!x))] } }, select: { id: true, nombre: true } });
  const nombre = new Map(usuarios.map(u => [u.id, u.nombre]));
  const resumen = resumirCaja(centavos(caja.montoInicial), movimientos.map(m => ({ tipo: m.tipo, monto: centavos(m.monto) })));
  const porMedio = resumirCobros(cobros.map(c => ({ medio: MEDIO_COBRO(c.medio), monto: centavos(c.monto) })));
  return {
    id: caja.id, sedeId: caja.sedeId, estado: caja.estado, montoInicial: caja.montoInicial.toFixed(2),
    abiertaPor: nombre.get(caja.abiertaPorId) ?? "—", abiertaEn: caja.abiertaEn,
    cerradaPor: caja.cerradaPorId ? nombre.get(caja.cerradaPorId) ?? "—" : null, cerradaEn: caja.cerradaEn,
    esperado: caja.esperado?.toFixed(2) ?? importe(resumen.esperado),
    contado: caja.contado?.toFixed(2) ?? null, diferencia: caja.diferencia?.toFixed(2) ?? null, observaciones: caja.observaciones,
    porTipo: Object.fromEntries([...resumen.porTipo].map(([t, v]) => [t, importe(v)])) as Record<TipoMovimientoCaja, string>,
    // Cobros con tarjeta, transferencia, MP u otro registrados con esta caja abierta: se informan, no se cuentan.
    noEfectivo: [...porMedio.porMedio].filter(([m]) => m !== "EFECTIVO").map(([medio, total]) => ({ medio, total: importe(total) })),
    totalNoEfectivo: importe(porMedio.otros),
    movimientos: movimientos.map(m => ({
      id: m.id, tipo: m.tipo, monto: m.monto.toFixed(2), motivo: m.motivo, fecha: m.createdAt, por: nombre.get(m.registradoPorId) ?? "—",
      ventaId: m.cobro?.ventaId ?? null, gasto: m.gasto?.descripcion ?? null, revierteId: m.revierteId,
      revertido: !!m.reverso, revertible: revertibleDesdeCaja(m.tipo) && !m.reverso,
    })),
  };
}

/** Pantalla de caja de la sede: la caja abierta (si hay) y el historial de cierres. */
export async function estadoCaja(db: Database, actorId: string, organizacionId: string, sedeId: string, limiteHistorial = 30) {
  const { puede } = await exigirSedeVenta(db, actorId, organizacionId, sedeId, "caja:leer");
  const abierta = await db.caja.findFirst({ where: { organizacionId, sedeId, estado: "ABIERTA" }, select: { id: true } });
  const cerradas = await db.caja.findMany({
    where: { organizacionId, sedeId, estado: "CERRADA" }, orderBy: { cerradaEn: "desc" }, take: Math.min(Math.max(1, limiteHistorial), 200),
    select: { id: true, abiertaEn: true, cerradaEn: true, montoInicial: true, esperado: true, contado: true, diferencia: true, cerradaPorId: true, observaciones: true },
  });
  const usuarios = await db.usuario.findMany({ where: { id: { in: [...new Set(cerradas.map(c => c.cerradaPorId!))] } }, select: { id: true, nombre: true } });
  const nombre = new Map(usuarios.map(u => [u.id, u.nombre]));
  return {
    puedeOperar: puede("caja:operar"),
    abierta: abierta ? await detalle(db, organizacionId, abierta.id) : null,
    cierres: cerradas.map(c => ({
      id: c.id, abiertaEn: c.abiertaEn, cerradaEn: c.cerradaEn!, montoInicial: c.montoInicial.toFixed(2), esperado: c.esperado!.toFixed(2),
      contado: c.contado!.toFixed(2), diferencia: c.diferencia!.toFixed(2), cerradaPor: nombre.get(c.cerradaPorId!) ?? "—", observaciones: c.observaciones,
    })),
  };
}

/** Una caja (abierta o cerrada) con sus movimientos, si está en el alcance de lectura del actor. */
export async function obtenerCaja(db: Database, actorId: string, organizacionId: string, cajaId: string) {
  exigirIds(cajaId);
  const caja = await db.caja.findFirst({ where: { id: cajaId, organizacionId }, select: { sedeId: true } });
  if (!caja) throw new AccesoDenegado();
  const { puede } = await exigirSedeVenta(db, actorId, organizacionId, caja.sedeId, "caja:leer");
  return { ...await detalle(db, organizacionId, cajaId), puedeOperar: puede("caja:operar") };
}

/** ¿Hay caja abierta en la sede? Para avisos en otras pantallas (gastos, cobro). Sin lock; exige caja:leer. */
export async function hayCajaAbierta(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  await exigirSedeVenta(db, actorId, organizacionId, sedeId, "caja:leer");
  return (await db.caja.count({ where: { organizacionId, sedeId, estado: "ABIERTA" } })) > 0;
}
