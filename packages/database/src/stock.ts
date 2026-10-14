import { randomUUID } from "node:crypto";
import { AccesoDenegado, cubreSede, tienePermiso, type Permiso } from "@nailnet/domain";
import { validarFecha } from "@nailnet/domain/agenda";
import { aCentavos, importe } from "@nailnet/domain/catalogo";
import { ABREVIATURAS, StockInsuficiente, UNIDADES, aMilesimas, aplicarDeltas, cantidadTexto, claveSaldo, decimal, deltaAjuste, desdeDecimal, reversible, signoValido, subtotalCentavos, validarCantidad, validarMotivo, type Delta, type TipoMovimiento, type UnidadMedida } from "@nailnet/domain/stock";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, exigirIds, mapaSedes } from "./access.ts";
import { conReintento } from "./reservas.ts";

type Tx = Prisma.TransactionClient;

/**
 * No alcanza el stock de la sede. Extiende DatosInvalidos para que el panel muestre el mensaje; las
 * ventas (O01) pueden atraparla aparte. Equivale a HTTP 409.
 */
export class SinStock extends DatosInvalidos {
  constructor(mensaje: string, readonly productoId: string, readonly sedeId: string, readonly disponible: string, readonly pedido: string) {
    super(mensaje); this.name = "SinStock";
  }
}

// ─── Permisos ─────────────────────────────────────────────────────────────────

async function permisosEnSede(db: Tx | Database, actorId: string, organizacionId: string, sedeId: string) {
  exigirIds(sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  const puede = (p: Permiso) => actor.some(a => tienePermiso(a, p) && cubreSede(a, sedeId, franquiciadoDe));
  return { actor, franquiciadoDe, puede };
}
async function exigirSede(db: Tx | Database, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  const p = await permisosEnSede(db, actorId, organizacionId, sedeId);
  if (!p.puede(permiso)) throw new AccesoDenegado();
  return p;
}

// ─── Núcleo: saldos bajo lock y movimientos inmutables ───────────────────────

type Movimiento = Delta & {
  tipo: TipoMovimiento; motivo?: string | null;
  compraItemId?: string; transferenciaId?: string; ventaId?: string | null; revierteId?: string;
};

/**
 * Bloquea (SELECT … FOR UPDATE) las filas de saldo de los pares sede/producto, siempre en el mismo
 * orden (sede, producto), y devuelve el saldo actual de cada una. Crea en cero las que no existían.
 * Es el equivalente del protocolo de exclusión de turnos (doc 16) para el stock: dos egresos sobre el
 * mismo producto y sede se serializan aquí, y el segundo lee el saldo que dejó el primero.
 */
async function bloquearSaldos(tx: Tx, organizacionId: string, pares: { sedeId: string; productoId: string }[]) {
  const unicos = [...new Map(pares.map(({ sedeId, productoId }) => [claveSaldo(sedeId, productoId), { sedeId, productoId }])).values()];
  await tx.stockSede.createMany({ data: unicos.map(p => ({ organizacionId, ...p })), skipDuplicates: true });
  const filas = await tx.$queryRaw<{ sedeId: string; productoId: string; cantidad: string }[]>`
    SELECT "sedeId"::text AS "sedeId", "productoId"::text AS "productoId", "cantidad"::text AS cantidad
    FROM "StockSede"
    WHERE "organizacionId" = ${organizacionId}::uuid
      AND ("sedeId", "productoId") IN (${Prisma.join(unicos.map(p => Prisma.sql`(${p.sedeId}::uuid, ${p.productoId}::uuid)`))})
    ORDER BY "sedeId", "productoId"
    FOR UPDATE`;
  if (filas.length !== unicos.length) throw new AccesoDenegado();
  return new Map(filas.map(f => [claveSaldo(f.sedeId, f.productoId), desdeDecimal(f.cantidad)]));
}

/** Aplica los movimientos sobre saldos ya bloqueados: todo o nada, nunca negativo. */
async function escribirMovimientos(tx: Tx, organizacionId: string, actorId: string, saldos: Map<string, bigint>, movimientos: Movimiento[]) {
  for (const m of movimientos) if (!signoValido(m.tipo, m.cantidad)) throw new DatosInvalidos("Movimiento de stock inválido");
  let resultado: ReturnType<typeof aplicarDeltas>;
  try { resultado = aplicarDeltas(saldos, movimientos); }
  catch (e) {
    if (!(e instanceof StockInsuficiente)) throw e;
    const p = await tx.producto.findUnique({ where: { id: e.productoId }, select: { nombre: true, unidad: true } });
    const u = p ? ` ${ABREVIATURAS[p.unidad]}` : "";
    throw new SinStock(`No hay stock suficiente de «${p?.nombre ?? "producto"}» en la sede: hay ${cantidadTexto(e.disponible)}${u} y se necesitan ${cantidadTexto(e.pedido)}${u}.`, e.productoId, e.sedeId, cantidadTexto(e.disponible), cantidadTexto(e.pedido));
  }
  for (const [k, cantidad] of resultado.saldos) {
    if (saldos.get(k) === cantidad) continue;
    const [sedeId, productoId] = k.split("|") as [string, string];
    await tx.stockSede.update({ where: { sedeId_productoId: { sedeId, productoId } }, data: { cantidad: decimal(cantidad) } });
  }
  await tx.movimientoStock.createMany({ data: movimientos.map((m, i) => ({
    organizacionId, sedeId: m.sedeId, productoId: m.productoId, tipo: m.tipo, cantidad: decimal(m.cantidad), saldoResultante: decimal(resultado.resultantes[i]!),
    motivo: m.motivo?.trim() || null, compraItemId: m.compraItemId, transferenciaId: m.transferenciaId, ventaId: m.ventaId ?? null, revierteId: m.revierteId, actorId,
  })) });
}

async function aplicarMovimientos(tx: Tx, organizacionId: string, actorId: string, movimientos: Movimiento[]) {
  const saldos = await bloquearSaldos(tx, organizacionId, movimientos);
  await escribirMovimientos(tx, organizacionId, actorId, saldos, movimientos);
}

// ─── Validación de entradas ───────────────────────────────────────────────────

function cantidadDe(texto: string): bigint {
  const m = aMilesimas(texto);
  const error = validarCantidad(m);
  if (error) throw new DatosInvalidos(error);
  return m!;
}
function motivoDe(motivo: string | null | undefined, obligatorio: boolean) {
  const error = validarMotivo(motivo, obligatorio);
  if (error) throw new DatosInvalidos(error);
  return motivo?.trim().replace(/\s+/g, " ") || null;
}
function texto(valor: string, campo: string, max: number) {
  const t = valor.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!t || t.length > max) throw new DatosInvalidos(`${campo} inválido: entre 1 y ${max} caracteres`);
  return t;
}
export type ItemCantidad = { productoId: string; cantidad: string };
function items<T extends { productoId: string }>(lista: T[]): T[] {
  if (!lista.length) throw new DatosInvalidos("Agregá al menos un producto");
  if (lista.length > 50) throw new DatosInvalidos("Hasta 50 productos por operación");
  exigirIds(...lista.map(i => i.productoId));
  return lista;
}

/** Productos de la organización; un ID ajeno o inexistente es acceso denegado. */
async function productosDe(tx: Tx, organizacionId: string, ids: string[], opciones: { activos?: boolean; vendibles?: boolean } = {}) {
  const unicos = [...new Set(ids)];
  const productos = await tx.producto.findMany({ where: { organizacionId, id: { in: unicos } }, select: { id: true, nombre: true, activo: true, vendible: true } });
  if (productos.length !== unicos.length) throw new AccesoDenegado();
  for (const p of productos) {
    if (opciones.activos && !p.activo) throw new DatosInvalidos(`«${p.nombre}» está inactivo`);
    if (opciones.vendibles && !p.vendible) throw new DatosInvalidos(`«${p.nombre}» es de consumo interno: no se vende`);
  }
  return new Map(productos.map(p => [p.id, p]));
}

// ─── Productos (definición global: solo master, como el catálogo, D12) ────────

export type DatosProducto = { nombre: string; sku?: string | null; unidad: UnidadMedida; vendible: boolean; activo: boolean };

export async function guardarProducto(db: Database, actorId: string, organizacionId: string, datos: DatosProducto, productoId?: string) {
  exigirIds(productoId);
  const nombre = texto(datos.nombre, "Nombre", 120);
  const sku = datos.sku?.trim() ? texto(datos.sku, "Código", 40) : null;
  if (!UNIDADES.includes(datos.unidad)) throw new DatosInvalidos("Unidad de medida inválida");
  const data = { nombre, sku, unidad: datos.unidad, vendible: datos.vendible, activo: datos.activo };
  try {
    return await db.$transaction(async tx => {
      const actor = await asignacionesActor(tx, actorId, organizacionId);
      if (!actor.some(a => tienePermiso(a, "producto:administrar"))) throw new AccesoDenegado();
      let p: { id: string };
      if (productoId) {
        // Lock de la fila: un movimiento concurrente no se cuela entre la verificación y el cambio de unidad.
        const [actual] = await tx.$queryRaw<{ unidad: UnidadMedida }[]>`SELECT "unidad"::text AS unidad FROM "Producto" WHERE id = ${productoId}::uuid AND "organizacionId" = ${organizacionId}::uuid FOR UPDATE`;
        if (!actual) throw new AccesoDenegado();
        if (actual.unidad !== datos.unidad && await tx.movimientoStock.count({ where: { organizacionId, productoId } })) {
          throw new DatosInvalidos("La unidad no se puede cambiar: el producto ya tiene movimientos. Creá un producto nuevo.");
        }
        p = await tx.producto.update({ where: { id: productoId }, data, select: { id: true } });
      } else p = await tx.producto.create({ data: { organizacionId, ...data }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, productoId ? "stock.producto.editar" : "stock.producto.crear", "Producto", p.id, data);
      return p;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos("Ya existe un producto con ese nombre o código");
    throw e;
  }
}

/** Precio de venta en la sede (null = sin precio). Mismo permiso que el precio de los servicios. */
export async function guardarPrecioProducto(db: Database, actorId: string, organizacionId: string, sedeId: string, productoId: string, precio: string | null) {
  exigirIds(productoId);
  const centavos = precio?.trim() ? aCentavos(precio) : null;
  if (precio?.trim() && (centavos === null || centavos <= 0n)) throw new DatosInvalidos("Precio inválido");
  await db.$transaction(async tx => {
    await exigirSede(tx, actorId, organizacionId, sedeId, "catalogo:precios");
    const [p] = [...(await productosDe(tx, organizacionId, [productoId])).values()];
    if (centavos !== null && !p!.vendible) throw new DatosInvalidos("Solo los productos vendibles llevan precio");
    const valor = centavos === null ? null : importe(centavos);
    await tx.productoSede.upsert({ where: { productoId_sedeId: { productoId, sedeId } }, create: { organizacionId, productoId, sedeId, precio: valor }, update: { precio: valor } });
    await auditar(tx, organizacionId, actorId, "stock.precio", "Producto", productoId, { sedeId, precio: valor });
  });
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Stock de una sede: todos los productos de la organización con su saldo y precio local. */
export async function stockSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  const { puede, actor } = await exigirSede(db, actorId, organizacionId, sedeId, "stock:leer");
  const productos = await db.producto.findMany({
    where: { organizacionId },
    select: { id: true, nombre: true, sku: true, unidad: true, vendible: true, activo: true, saldos: { where: { sedeId }, select: { cantidad: true } }, sedes: { where: { sedeId }, select: { precio: true } } },
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  return {
    puede: { consumir: puede("stock:consumir"), gestionar: puede("stock:gestionar"), administrarProductos: actor.some(a => tienePermiso(a, "producto:administrar")) },
    productos: productos.map(p => ({
      id: p.id, nombre: p.nombre, sku: p.sku, unidad: p.unidad, vendible: p.vendible, activo: p.activo,
      cantidad: cantidadTexto(desdeDecimal(p.saldos[0]?.cantidad.toFixed(3) ?? "0")), precio: p.sedes[0]?.precio?.toFixed(2) ?? null,
    })),
  };
}

/** Ficha de un producto: saldo en la sede y en las demás sedes visibles, precio y movimientos de la sede. */
export async function fichaProducto(db: Database, actorId: string, organizacionId: string, productoId: string, sedeId: string) {
  exigirIds(productoId);
  const { puede, actor, franquiciadoDe } = await exigirSede(db, actorId, organizacionId, sedeId, "stock:leer");
  const producto = await db.producto.findFirst({
    where: { id: productoId, organizacionId },
    select: { id: true, nombre: true, sku: true, unidad: true, vendible: true, activo: true, sedes: { where: { sedeId }, select: { precio: true } }, saldos: { select: { sedeId: true, cantidad: true, sede: { select: { nombre: true, activo: true } } } } },
  });
  if (!producto) throw new AccesoDenegado();
  const visibles = producto.saldos.filter(s => s.sede.activo && actor.some(a => tienePermiso(a, "stock:leer") && cubreSede(a, s.sedeId, franquiciadoDe)));
  const movimientos = await db.movimientoStock.findMany({
    where: { organizacionId, productoId, sedeId }, orderBy: { orden: "desc" }, take: 200,
    select: { id: true, tipo: true, cantidad: true, saldoResultante: true, motivo: true, createdAt: true, actorId: true, ventaId: true, transferenciaId: true, revierteId: true,
      revertidoPor: { select: { id: true } }, compraItem: { select: { compra: { select: { proveedor: true, comprobante: true, fecha: true } }, costoUnitario: true } } },
  });
  const transferencias = [...new Set(movimientos.map(m => m.transferenciaId).filter((t): t is string => !!t))];
  const contrapartes = transferencias.length ? await db.movimientoStock.findMany({ where: { organizacionId, transferenciaId: { in: transferencias }, NOT: { sedeId } }, select: { transferenciaId: true, sede: { select: { nombre: true } } } }) : [];
  const actores = await db.usuario.findMany({ where: { id: { in: [...new Set(movimientos.map(m => m.actorId))] } }, select: { id: true, nombre: true } });
  const nombreActor = new Map(actores.map(u => [u.id, u.nombre]));
  const otraSede = new Map(contrapartes.map(c => [c.transferenciaId!, c.sede.nombre]));
  return {
    puede: { consumir: puede("stock:consumir"), gestionar: puede("stock:gestionar"), precio: puede("catalogo:precios"), administrar: actor.some(a => tienePermiso(a, "producto:administrar")) },
    producto: { id: producto.id, nombre: producto.nombre, sku: producto.sku, unidad: producto.unidad, vendible: producto.vendible, activo: producto.activo, precio: producto.sedes[0]?.precio?.toFixed(2) ?? null },
    cantidad: cantidadTexto(desdeDecimal(producto.saldos.find(s => s.sedeId === sedeId)?.cantidad.toFixed(3) ?? "0")),
    otrasSedes: visibles.filter(s => s.sedeId !== sedeId).map(s => ({ sedeId: s.sedeId, sede: s.sede.nombre, cantidad: cantidadTexto(desdeDecimal(s.cantidad.toFixed(3))) })),
    movimientos: movimientos.map(m => ({
      id: m.id, tipo: m.tipo, cantidad: cantidadTexto(desdeDecimal(m.cantidad.toFixed(3))), saldo: cantidadTexto(desdeDecimal(m.saldoResultante.toFixed(3))),
      motivo: m.motivo, fecha: m.createdAt, actor: nombreActor.get(m.actorId) ?? null, ventaId: m.ventaId, revierteId: m.revierteId,
      revertido: !!m.revertidoPor, reversible: reversible(m.tipo) && !m.revertidoPor,
      compra: m.compraItem ? { proveedor: m.compraItem.compra.proveedor, comprobante: m.compraItem.compra.comprobante, fecha: m.compraItem.compra.fecha.toISOString().slice(0, 10), costoUnitario: m.compraItem.costoUnitario.toFixed(2) } : null,
      otraSede: m.transferenciaId ? otraSede.get(m.transferenciaId) ?? null : null,
    })),
  };
}

/** Últimas compras de la sede con sus ítems. */
export async function listarCompras(db: Database, actorId: string, organizacionId: string, sedeId: string, limite = 50) {
  await exigirSede(db, actorId, organizacionId, sedeId, "stock:leer");
  const compras = await db.compra.findMany({
    where: { organizacionId, sedeId }, orderBy: [{ fecha: "desc" }, { createdAt: "desc" }], take: Math.min(Math.max(1, limite), 200),
    select: { id: true, proveedor: true, comprobante: true, fecha: true, total: true, createdAt: true,
      items: { orderBy: { posicion: "asc" }, select: { cantidad: true, costoUnitario: true, subtotal: true, producto: { select: { id: true, nombre: true, unidad: true } }, movimiento: { select: { revertidoPor: { select: { id: true } } } } } } },
  });
  return compras.map(c => ({
    id: c.id, proveedor: c.proveedor, comprobante: c.comprobante, fecha: c.fecha.toISOString().slice(0, 10), total: c.total.toFixed(2),
    items: c.items.map(i => ({ productoId: i.producto.id, producto: i.producto.nombre, unidad: i.producto.unidad, cantidad: cantidadTexto(desdeDecimal(i.cantidad.toFixed(3))), costoUnitario: i.costoUnitario.toFixed(2), subtotal: i.subtotal.toFixed(2), revertido: !!i.movimiento?.revertidoPor })),
  }));
}

// ─── Operaciones ──────────────────────────────────────────────────────────────

export type DatosCompra = { sedeId: string; proveedor: string; comprobante?: string | null; fecha: string; items: { productoId: string; cantidad: string; costoUnitario: string }[] };

/** Compra a proveedor: registra la compra y un ingreso (COMPRA) por ítem, en una transacción. */
export async function registrarCompra(db: Database, actorId: string, organizacionId: string, datos: DatosCompra) {
  const proveedor = texto(datos.proveedor, "Proveedor", 120);
  const comprobante = datos.comprobante?.trim() ? texto(datos.comprobante, "Comprobante", 60) : null;
  if (!validarFecha(datos.fecha)) throw new DatosInvalidos("Fecha inválida");
  const lineas = items(datos.items).map(i => {
    const cantidad = cantidadDe(i.cantidad);
    const costo = aCentavos(i.costoUnitario);
    if (costo === null) throw new DatosInvalidos("Costo unitario inválido");
    return { productoId: i.productoId, cantidad, costo, subtotal: subtotalCentavos(cantidad, costo) };
  });
  const total = lineas.reduce((s, l) => s + l.subtotal, 0n);
  return conReintento(() => db.$transaction(async tx => {
    await exigirSede(tx, actorId, organizacionId, datos.sedeId, "stock:gestionar");
    await productosDe(tx, organizacionId, lineas.map(l => l.productoId), { activos: true });
    const compra = await tx.compra.create({ data: { organizacionId, sedeId: datos.sedeId, proveedor, comprobante, fecha: new Date(`${datos.fecha}T00:00:00Z`), total: importe(total), actorId }, select: { id: true } });
    const creados = await tx.compraItem.createManyAndReturn({
      data: lineas.map((l, posicion) => ({ organizacionId, compraId: compra.id, posicion, productoId: l.productoId, cantidad: decimal(l.cantidad), costoUnitario: importe(l.costo), subtotal: importe(l.subtotal) })),
      select: { id: true, posicion: true },
    });
    const idDe = new Map(creados.map(c => [c.posicion, c.id]));
    await aplicarMovimientos(tx, organizacionId, actorId, lineas.map((l, i) => ({ sedeId: datos.sedeId, productoId: l.productoId, tipo: "COMPRA", cantidad: l.cantidad, compraItemId: idDe.get(i)! })));
    await auditar(tx, organizacionId, actorId, "stock.compra", "Compra", compra.id, { sedeId: datos.sedeId, proveedor, total: importe(total), items: lineas.length });
    return { id: compra.id, total: importe(total) };
  }));
}

/** Consumo interno de insumos (esmaltes, algodón, descartables…). Nunca deja el saldo negativo. */
export async function registrarConsumo(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; items: ItemCantidad[]; motivo?: string | null }) {
  const motivo = motivoDe(datos.motivo, false);
  const lineas = items(datos.items).map(i => ({ productoId: i.productoId, cantidad: cantidadDe(i.cantidad) }));
  await conReintento(() => db.$transaction(async tx => {
    await exigirSede(tx, actorId, organizacionId, datos.sedeId, "stock:consumir");
    await productosDe(tx, organizacionId, lineas.map(l => l.productoId));
    await aplicarMovimientos(tx, organizacionId, actorId, lineas.map(l => ({ sedeId: datos.sedeId, productoId: l.productoId, tipo: "CONSUMO_INTERNO", cantidad: -l.cantidad, motivo })));
  }));
}

/**
 * Ajuste por conteo físico: se informa lo contado y el movimiento AJUSTE registra la diferencia contra
 * el saldo, calculada bajo lock (un consumo concurrente no queda pisado). Motivo obligatorio.
 */
export async function ajustarStock(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; productoId: string; contado: string; motivo: string }) {
  exigirIds(datos.productoId);
  const motivo = motivoDe(datos.motivo, true);
  const contado = aMilesimas(datos.contado);
  if (contado === null || contado > 999_999_999_999n) throw new DatosInvalidos("Cantidad contada inválida: hasta 3 decimales");
  return conReintento(() => db.$transaction(async tx => {
    await exigirSede(tx, actorId, organizacionId, datos.sedeId, "stock:gestionar");
    await productosDe(tx, organizacionId, [datos.productoId]);
    const saldos = await bloquearSaldos(tx, organizacionId, [datos]);
    const delta = deltaAjuste(saldos.get(claveSaldo(datos.sedeId, datos.productoId)) ?? 0n, contado);
    if (delta === 0n) throw new DatosInvalidos("El conteo coincide con el stock registrado: no hay nada que ajustar");
    await escribirMovimientos(tx, organizacionId, actorId, saldos, [{ sedeId: datos.sedeId, productoId: datos.productoId, tipo: "AJUSTE", cantidad: delta, motivo }]);
    return { diferencia: cantidadTexto(delta) };
  }));
}

/**
 * Transferencia inmediata entre dos sedes (sin estado «en tránsito»): salida y entrada en la misma
 * transacción, con el mismo transferenciaId. Exige stock:gestionar en ambas sedes.
 */
export async function transferirStock(db: Database, actorId: string, organizacionId: string, datos: { origenId: string; destinoId: string; items: ItemCantidad[]; motivo?: string | null }) {
  exigirIds(datos.origenId, datos.destinoId);
  if (datos.origenId === datos.destinoId) throw new DatosInvalidos("Elegí una sede de destino distinta");
  const motivo = motivoDe(datos.motivo, false);
  const lineas = items(datos.items).map(i => ({ productoId: i.productoId, cantidad: cantidadDe(i.cantidad) }));
  const transferenciaId = randomUUID();
  await conReintento(() => db.$transaction(async tx => {
    await exigirSede(tx, actorId, organizacionId, datos.origenId, "stock:gestionar");
    await exigirSede(tx, actorId, organizacionId, datos.destinoId, "stock:gestionar");
    if (!await tx.sede.count({ where: { id: datos.destinoId, organizacionId, activo: true } })) throw new DatosInvalidos("La sede de destino está inactiva");
    await productosDe(tx, organizacionId, lineas.map(l => l.productoId));
    await aplicarMovimientos(tx, organizacionId, actorId, [
      ...lineas.map(l => ({ sedeId: datos.origenId, productoId: l.productoId, tipo: "TRANSFERENCIA_SALIDA" as const, cantidad: -l.cantidad, motivo, transferenciaId })),
      ...lineas.map(l => ({ sedeId: datos.destinoId, productoId: l.productoId, tipo: "TRANSFERENCIA_ENTRADA" as const, cantidad: l.cantidad, motivo, transferenciaId })),
    ]);
  }));
  return { transferenciaId };
}

/**
 * Corrige una compra, un consumo o un ajuste con un movimiento REVERSO de signo contrario. El índice
 * único sobre revierteId impide revertir dos veces el mismo movimiento, también en paralelo.
 */
export async function revertirMovimiento(db: Database, actorId: string, organizacionId: string, movimientoId: string, motivo: string) {
  exigirIds(movimientoId);
  const m = motivoDe(motivo, true);
  try {
    await conReintento(() => db.$transaction(async tx => {
      const original = await tx.movimientoStock.findFirst({ where: { id: movimientoId, organizacionId }, select: { sedeId: true, productoId: true, tipo: true, cantidad: true, revertidoPor: { select: { id: true } } } });
      if (!original) throw new AccesoDenegado();
      await exigirSede(tx, actorId, organizacionId, original.sedeId, "stock:gestionar");
      if (!reversible(original.tipo)) throw new DatosInvalidos("Solo se revierten compras, consumos y ajustes. Las ventas se anulan desde la venta y las transferencias con otra transferencia");
      if (original.revertidoPor) throw new DatosInvalidos("Ese movimiento ya fue revertido");
      await aplicarMovimientos(tx, organizacionId, actorId, [{ sedeId: original.sedeId, productoId: original.productoId, tipo: "REVERSO", cantidad: -desdeDecimal(original.cantidad.toFixed(3)), motivo: m, revierteId: movimientoId }]);
      await auditar(tx, organizacionId, actorId, "stock.reverso", "MovimientoStock", movimientoId, { motivo: m });
    }));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos("Ese movimiento ya fue revertido");
    throw e;
  }
}

/**
 * Egreso de stock por venta, para usar dentro de la transacción de la venta (O01): así la venta y su
 * egreso quedan juntos o no queda ninguno. Bloquea las filas de saldo en orden estable y rechaza con
 * SinStock si no alcanza, por lo que dos ventas concurrentes nunca dejan el saldo negativo (además
 * lo impide un CHECK). Solo productos vendibles. Quien llama envuelve su transacción con conReintento.
 */
export async function egresarPorVenta(tx: Tx, actorId: string, organizacionId: string, datos: { sedeId: string; ventaId?: string | null; items: ItemCantidad[] }) {
  exigirIds(datos.ventaId);
  const lineas = items(datos.items).map(i => ({ productoId: i.productoId, cantidad: cantidadDe(i.cantidad) }));
  await exigirSede(tx, actorId, organizacionId, datos.sedeId, "stock:consumir");
  await productosDe(tx, organizacionId, lineas.map(l => l.productoId), { vendibles: true });
  await aplicarMovimientos(tx, organizacionId, actorId, lineas.map(l => ({ sedeId: datos.sedeId, productoId: l.productoId, tipo: "VENTA", cantidad: -l.cantidad, ventaId: datos.ventaId ?? null })));
}
