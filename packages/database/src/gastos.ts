// O04 · Gastos de sede. Ver docs/25-gastos.md.
// Cada operación autoriza en el repositorio con el alcance del actor (cubreSede): un ID de sede, gasto
// o categoría fuera del alcance equivale a un recurso inexistente (AccesoDenegado).
import { AccesoDenegado, cubreSede, tienePermiso, type Asignacion, type FranquiciadoDeSede, type PermisoGasto } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { importe } from "@nailnet/domain/catalogo";
import { afectaCajaEfectivo, categoriaAplicaASede, mesDe, puedeAdministrarCategoriaGasto, resumirGastos, validarGasto, validarMotivoAnulacion, validarNombreCategoria, validarPeriodo, type AltaGasto, type MedioPagoGasto } from "@nailnet/domain/gastos";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, bloquearOrganizacion, exigirIds, mapaSedes } from "./access.ts";
import { SIN_CAJA, asentarMovimiento, cajaAbiertaBloqueada } from "./caja.ts";
import { conReintento } from "./reservas.ts";

type Cliente = Database | Prisma.TransactionClient;
const fechaDb = (f: string) => new Date(`${f}T00:00:00Z`);
const fechaTexto = (d: Date) => d.toISOString().slice(0, 10);
const centavos = (d: Prisma.Decimal) => BigInt(d.mul(100).toFixed(0));
const esUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

function puede(actor: readonly Asignacion[], permiso: PermisoGasto, sedeId: string, franquiciadoDe: FranquiciadoDeSede) {
  return actor.some(a => tienePermiso(a, permiso) && cubreSede(a, sedeId, franquiciadoDe));
}
/** Exige el permiso sobre la sede; devuelve el actor para decidir qué más mostrar. */
async function exigirSede(db: Cliente, actorId: string, organizacionId: string, sedeId: string, permiso: PermisoGasto) {
  exigirIds(sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (!puede(actor, permiso, sedeId, franquiciadoDe)) throw new AccesoDenegado();
  return { actor, franquiciadoDe };
}

// ─── Categorías ───────────────────────────────────────────────────────────────

/** Categorías utilizables en la sede: globales de la organización y locales de esa sede. */
export async function listarCategoriasGasto(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  const { actor, franquiciadoDe } = await exigirSede(db, actorId, organizacionId, sedeId, "gasto:leer");
  const categorias = await db.categoriaGasto.findMany({
    where: { organizacionId, OR: [{ sedeId: null }, { sedeId }] },
    select: { id: true, nombre: true, sedeId: true, activo: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
  return {
    puedeCrearGlobal: puedeAdministrarCategoriaGasto(actor, null, franquiciadoDe),
    puedeCrearLocal: puedeAdministrarCategoriaGasto(actor, sedeId, franquiciadoDe),
    categorias: categorias.map(c => ({ ...c, global: c.sedeId === null, puedeEditar: puedeAdministrarCategoriaGasto(actor, c.sedeId, franquiciadoDe) })),
  };
}

/**
 * Una global no puede repetir el nombre de ninguna categoría de la organización; una local, el de una
 * global ni el de otra local de su sede. Sin distinguir mayúsculas. Se llama bajo el lock de la organización.
 */
async function exigirNombreLibre(tx: Prisma.TransactionClient, organizacionId: string, sedeId: string | null, nombre: string, excluirId?: string) {
  // Se compara en JS: lower()/ILIKE de PostgreSQL no pliegan acentos con collation C («CAFÉ» ≠ «café»).
  const clave = (n: string) => n.toLocaleLowerCase("es-AR");
  const candidatas = await tx.categoriaGasto.findMany({
    where: { organizacionId, ...(excluirId ? { id: { not: excluirId } } : {}), ...(sedeId === null ? {} : { OR: [{ sedeId: null }, { sedeId }] }) },
    select: { sedeId: true, nombre: true },
  });
  const choca = candidatas.find(c => clave(c.nombre) === clave(nombre));
  if (choca) throw new DatosInvalidos(choca.sedeId === null ? "Ya existe una categoría global con ese nombre" : "Ya existe una categoría local con ese nombre");
}

/** sedeId null = categoría global (solo alcance de organización); con sede = local de esa sede. */
export async function crearCategoriaGasto(db: Database, actorId: string, organizacionId: string, datos: { nombre: string; sedeId: string | null }) {
  exigirIds(datos.sedeId);
  const v = validarNombreCategoria(datos.nombre);
  if ("error" in v) throw new DatosInvalidos(v.error);
  try {
    return await db.$transaction(async tx => {
      await bloquearOrganizacion(tx, organizacionId);
      const actor = await asignacionesActor(tx, actorId, organizacionId);
      const franquiciadoDe = await mapaSedes(tx, organizacionId);
      if (!puedeAdministrarCategoriaGasto(actor, datos.sedeId, franquiciadoDe)) throw new AccesoDenegado();
      await exigirNombreLibre(tx, organizacionId, datos.sedeId, v.nombre);
      const c = await tx.categoriaGasto.create({ data: { organizacionId, sedeId: datos.sedeId, nombre: v.nombre }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, "gasto.categoria.crear", "CategoriaGasto", c.id, { nombre: v.nombre, sedeId: datos.sedeId });
      return c;
    });
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos("Ya existe una categoría con ese nombre");
    throw e;
  }
}

/** Renombrar o desactivar/reactivar. Una categoría no se borra: los gastos la referencian. */
export async function actualizarCategoriaGasto(db: Database, actorId: string, organizacionId: string, categoriaId: string, cambios: { nombre?: string; activo?: boolean }) {
  exigirIds(categoriaId);
  const data: Prisma.CategoriaGastoUpdateInput = {};
  if (cambios.nombre !== undefined) {
    const v = validarNombreCategoria(cambios.nombre);
    if ("error" in v) throw new DatosInvalidos(v.error);
    data.nombre = v.nombre;
  }
  if (cambios.activo !== undefined) data.activo = cambios.activo;
  try {
    await db.$transaction(async tx => {
      await bloquearOrganizacion(tx, organizacionId);
      const actor = await asignacionesActor(tx, actorId, organizacionId);
      const franquiciadoDe = await mapaSedes(tx, organizacionId);
      const categoria = await tx.categoriaGasto.findFirst({ where: { id: categoriaId, organizacionId }, select: { sedeId: true } });
      if (!categoria || !puedeAdministrarCategoriaGasto(actor, categoria.sedeId, franquiciadoDe)) throw new AccesoDenegado();
      if (typeof data.nombre === "string") await exigirNombreLibre(tx, organizacionId, categoria.sedeId, data.nombre, categoriaId);
      await tx.categoriaGasto.update({ where: { id: categoriaId }, data });
      await auditar(tx, organizacionId, actorId, "gasto.categoria.actualizar", "CategoriaGasto", categoriaId, data as Prisma.InputJsonValue);
    });
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos("Ya existe una categoría con ese nombre");
    throw e;
  }
}

// ─── Gastos ───────────────────────────────────────────────────────────────────

export type DatosGasto = AltaGasto & {
  sedeId: string; categoriaId: string;
  /**
   * O02. Solo para EFECTIVO: ¿el dinero sale de la caja abierta de la sede? true exige caja abierta;
   * false no toca la caja (lo pagó alguien desde afuera); sin indicar, sale de la caja si hay una abierta.
   */
  desdeCaja?: boolean;
};

/**
 * Registra un gasto de la sede. La fecha no puede ser futura en la zona horaria de la sede. Queda
 * registrado quién lo cargó. Un gasto en EFECTIVO pagado con la caja genera, en la misma transacción,
 * el egreso de la caja abierta (O02, doc 27).
 */
export const SOLO_DESDE_CAJA = "Recepción registra solo gastos pagados en efectivo con la caja abierta";

export async function registrarGasto(db: Database, actorId: string, organizacionId: string, datos: DatosGasto) {
  exigirIds(datos.sedeId, datos.categoriaId);
  return conReintento(() => db.$transaction(async tx => {
    // Con gasto:registrar se carga cualquier gasto; con gasto:registrar_caja (recepción) solo uno pagado
    // en efectivo con la caja abierta.
    const { actor, franquiciadoDe } = await exigirSede(tx, actorId, organizacionId, datos.sedeId, "gasto:registrar_caja");
    const soloDesdeCaja = !puede(actor, "gasto:registrar", datos.sedeId, franquiciadoDe);
    const sede = await tx.sede.findFirst({ where: { id: datos.sedeId, organizacionId, activo: true }, select: { timezone: true } });
    if (!sede) throw new AccesoDenegado();
    const v = validarGasto(datos, aLocal(new Date(), sede.timezone).fecha);
    if ("error" in v) throw new DatosInvalidos(v.error);
    if (soloDesdeCaja && (!afectaCajaEfectivo(v.gasto.medioPago) || datos.desdeCaja === false)) throw new DatosInvalidos(SOLO_DESDE_CAJA);
    if (soloDesdeCaja) datos = { ...datos, desdeCaja: true };
    const categoria = await tx.categoriaGasto.findFirst({ where: { id: datos.categoriaId, organizacionId }, select: { sedeId: true, activo: true } });
    // Una categoría local de otra sede es, para esta sede, inexistente.
    if (!categoria || !categoriaAplicaASede(categoria, datos.sedeId)) throw new AccesoDenegado();
    if (!categoria.activo) throw new DatosInvalidos("La categoría está inactiva");
    const g = v.gasto;
    const gasto = await tx.gasto.create({
      data: {
        organizacionId, sedeId: datos.sedeId, categoriaId: datos.categoriaId, tipo: "GASTO", fecha: fechaDb(g.fecha),
        monto: importe(g.montoCentavos), medioPago: g.medioPago, descripcion: g.descripcion, comprobante: g.comprobante, registradoPorId: actorId,
      },
      select: { id: true },
    });
    let egresoCaja = false;
    if (afectaCajaEfectivo(g.medioPago) && datos.desdeCaja !== false) {
      const caja = await cajaAbiertaBloqueada(tx, organizacionId, datos.sedeId);
      if (!caja && datos.desdeCaja === true) throw new DatosInvalidos("La caja de la sede está cerrada: abrila, o indicá que el gasto no sale de la caja");
      if (caja) {
        await asentarMovimiento(tx, organizacionId, datos.sedeId, actorId, caja, { tipo: "EGRESO_GASTO", monto: -g.montoCentavos, gastoId: gasto.id });
        egresoCaja = true;
      }
    }
    await auditar(tx, organizacionId, actorId, "gasto.registrar", "Gasto", gasto.id, { sedeId: datos.sedeId, fecha: g.fecha, monto: importe(g.montoCentavos), medioPago: g.medioPago, egresoCaja });
    return { ...gasto, egresoCaja };
  }));
}

/**
 * Anula un gasto con un reverso: un movimiento nuevo con el monto negado, la misma fecha, sede,
 * categoría y medio, el motivo y quién lo anuló (registradoPorId) y cuándo (createdAt). El original no
 * cambia. La unicidad de revierteId impide dos anulaciones, también si llegan a la vez.
 */
export async function anularGasto(db: Database, actorId: string, organizacionId: string, gastoId: string, motivo: string) {
  exigirIds(gastoId);
  const m = validarMotivoAnulacion(motivo);
  if ("error" in m) throw new DatosInvalidos(m.error);
  try {
    return await conReintento(() => db.$transaction(async tx => {
      const original = await tx.gasto.findFirst({ where: { id: gastoId, organizacionId, tipo: "GASTO" }, include: { reverso: { select: { id: true } }, movimientoCaja: { select: { id: true } } } });
      if (!original) throw new AccesoDenegado();
      await exigirSede(tx, actorId, organizacionId, original.sedeId, "gasto:anular");
      if (original.reverso) throw new DatosInvalidos("El gasto ya fue anulado");
      const reverso = await tx.gasto.create({
        data: {
          organizacionId, sedeId: original.sedeId, categoriaId: original.categoriaId, tipo: "REVERSO", fecha: original.fecha,
          monto: original.monto.neg(), medioPago: original.medioPago, descripcion: original.descripcion, comprobante: original.comprobante,
          registradoPorId: actorId, revierteId: original.id, motivoAnulacion: m.motivo,
        },
        select: { id: true },
      });
      // Si el gasto salió de la caja, el efectivo vuelve a la caja abierta al momento de anular
      // (una caja cerrada no se reescribe).
      if (original.movimientoCaja) {
        const caja = await cajaAbiertaBloqueada(tx, organizacionId, original.sedeId);
        if (!caja) throw new DatosInvalidos(`${SIN_CAJA}: el gasto salió de la caja y su anulación devuelve el efectivo`);
        await asentarMovimiento(tx, organizacionId, original.sedeId, actorId, caja, { tipo: "REVERSO", monto: centavos(original.monto), motivo: m.motivo, gastoId: reverso.id, revierteId: original.movimientoCaja.id });
      }
      await auditar(tx, organizacionId, actorId, "gasto.anular", "Gasto", original.id, { reversoId: reverso.id, motivo: m.motivo });
      return reverso;
    }));
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos("El gasto ya fue anulado");
    throw e;
  }
}

const MAX_FILAS = 2000;

/**
 * Gastos de una sede en un período (fechas locales inclusivas; por defecto, el mes en curso), con su
 * anulación si la tuvieron, y los totales del período: un gasto anulado no suma.
 */
export async function listarGastos(db: Database, actorId: string, organizacionId: string, filtro: { sedeId: string; desde?: string; hasta?: string; categoriaId?: string | null }) {
  exigirIds(filtro.sedeId, filtro.categoriaId);
  const { actor, franquiciadoDe } = await exigirSede(db, actorId, organizacionId, filtro.sedeId, "gasto:leer");
  const sede = await db.sede.findFirst({ where: { id: filtro.sedeId, organizacionId }, select: { timezone: true } });
  if (!sede) throw new AccesoDenegado();
  const mes = mesDe(aLocal(new Date(), sede.timezone).fecha);
  const desde = filtro.desde || mes.desde, hasta = filtro.hasta || mes.hasta;
  const error = validarPeriodo(desde, hasta);
  if (error) throw new DatosInvalidos(error);
  const movimientos = await db.gasto.findMany({
    where: { organizacionId, sedeId: filtro.sedeId, fecha: { gte: fechaDb(desde), lte: fechaDb(hasta) }, ...(filtro.categoriaId ? { categoriaId: filtro.categoriaId } : {}) },
    include: { categoria: { select: { nombre: true } } },
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: MAX_FILAS + 1,
  });
  if (movimientos.length > MAX_FILAS) throw new DatosInvalidos("Demasiados gastos en el período: acotalo");
  const usuarios = await db.usuario.findMany({ where: { id: { in: [...new Set(movimientos.map(m => m.registradoPorId))] } }, select: { id: true, nombre: true } });
  const nombre = new Map(usuarios.map(u => [u.id, u.nombre]));
  const reversos = new Map(movimientos.filter(m => m.revierteId).map(m => [m.revierteId!, m]));
  const resumen = resumirGastos(movimientos.map(m => ({ montoCentavos: centavos(m.monto), categoriaId: m.categoriaId, medioPago: m.medioPago as MedioPagoGasto })));
  const nombreCategoria = new Map(movimientos.map(m => [m.categoriaId, m.categoria.nombre]));
  return {
    desde, hasta,
    puedeRegistrar: puede(actor, "gasto:registrar_caja", filtro.sedeId, franquiciadoDe),
    // Recepción: solo gastos en efectivo pagados con la caja abierta.
    soloDesdeCaja: !puede(actor, "gasto:registrar", filtro.sedeId, franquiciadoDe),
    puedeAnular: puede(actor, "gasto:anular", filtro.sedeId, franquiciadoDe),
    gastos: movimientos.filter(m => m.tipo === "GASTO").map(m => {
      const r = reversos.get(m.id);
      return {
        id: m.id, fecha: fechaTexto(m.fecha), categoriaId: m.categoriaId, categoria: m.categoria.nombre, monto: m.monto.toFixed(2),
        medioPago: m.medioPago as MedioPagoGasto, descripcion: m.descripcion, comprobante: m.comprobante,
        registradoPor: nombre.get(m.registradoPorId) ?? "—", registradoEn: m.createdAt,
        anulacion: r ? { motivo: r.motivoAnulacion!, por: nombre.get(r.registradoPorId) ?? "—", en: r.createdAt } : null,
      };
    }),
    total: importe(resumen.total),
    efectivo: importe(resumen.efectivo),
    porCategoria: [...resumen.porCategoria].map(([id, total]) => ({ id, nombre: nombreCategoria.get(id) ?? "—", total: importe(total) })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    porMedio: [...resumen.porMedio].map(([medio, total]) => ({ medio, total: importe(total) })),
  };
}

/** Un gasto (con su reverso si fue anulado), si está en el alcance de lectura del actor. */
export async function obtenerGasto(db: Database, actorId: string, organizacionId: string, gastoId: string) {
  exigirIds(gastoId);
  const gasto = await db.gasto.findFirst({ where: { id: gastoId, organizacionId, tipo: "GASTO" }, include: { reverso: true, categoria: { select: { nombre: true } } } });
  if (!gasto) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, gasto.sedeId, "gasto:leer");
  return {
    id: gasto.id, sedeId: gasto.sedeId, fecha: fechaTexto(gasto.fecha), categoria: gasto.categoria.nombre, monto: gasto.monto.toFixed(2),
    medioPago: gasto.medioPago as MedioPagoGasto, descripcion: gasto.descripcion, comprobante: gasto.comprobante, registradoPorId: gasto.registradoPorId, registradoEn: gasto.createdAt,
    anulacion: gasto.reverso ? { reversoId: gasto.reverso.id, monto: gasto.reverso.monto.toFixed(2), motivo: gasto.reverso.motivoAnulacion!, porId: gasto.reverso.registradoPorId, en: gasto.reverso.createdAt } : null,
  };
}
