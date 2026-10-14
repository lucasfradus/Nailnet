import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { SinStock, ajustarStock, egresarPorVenta, fichaProducto, guardarPrecioProducto, guardarProducto, listarCompras, registrarCompra, registrarConsumo, revertirMovimiento, stockSede, transferirStock } from "../src/stock.ts";
import { conReintento } from "../src/reservas.ts";
import { crearFixture } from "../prisma/fixture.ts";

test("stock por sede, compras, consumo interno y ajustes (O03)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  // Segunda conexión independiente (otro pool) para la prueba de concurrencia.
  const db2 = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const O = a.org.id;
    const saldo = async (sedeId: string, productoId: string) => (await fichaProducto(db, a.master.id, O, productoId, sedeId)).cantidad;
    let esmalte = "", algodon = "", removedor = "";

    await t.test("productos globales: solo el master los define; la unidad no cambia con movimientos", async () => {
      await assert.rejects(guardarProducto(db, a.franquiciado.id, O, { nombre: "Esmalte", unidad: "UNIDAD", vendible: true, activo: true }), AccesoDenegado);
      await assert.rejects(guardarProducto(db, a.admin.id, O, { nombre: "Esmalte", unidad: "UNIDAD", vendible: true, activo: true }), AccesoDenegado);
      esmalte = (await guardarProducto(db, a.master.id, O, { nombre: "Esmalte rojo 15 ml", sku: "ESM-R", unidad: "UNIDAD", vendible: true, activo: true })).id;
      algodon = (await guardarProducto(db, a.master.id, O, { nombre: "Algodón", unidad: "GRAMO", vendible: false, activo: true })).id;
      removedor = (await guardarProducto(db, a.master.id, O, { nombre: "Removedor", unidad: "MILILITRO", vendible: true, activo: true })).id;
      await assert.rejects(guardarProducto(db, a.master.id, O, { nombre: "Esmalte rojo 15 ml", unidad: "UNIDAD", vendible: true, activo: true }), DatosInvalidos, "nombre repetido");
      await assert.rejects(guardarProducto(db, a.master.id, O, { nombre: "Otro", sku: "ESM-R", unidad: "UNIDAD", vendible: true, activo: true }), DatosInvalidos, "código repetido");
      await assert.rejects(guardarProducto(db, a.master.id, O, { nombre: "X", unidad: "BARRIL" as never, vendible: true, activo: true }), DatosInvalidos);
      await assert.rejects(guardarProducto(db, b.master.id, b.org.id, { nombre: "Ajeno", unidad: "UNIDAD", vendible: true, activo: true }, esmalte), AccesoDenegado, "editar producto de otra organización");
      // Mismo nombre en otra organización: válido.
      await guardarProducto(db, b.master.id, b.org.id, { nombre: "Esmalte rojo 15 ml", unidad: "UNIDAD", vendible: true, activo: true });
      // Sin movimientos todavía la unidad se puede corregir.
      await guardarProducto(db, a.master.id, O, { nombre: "Algodón", unidad: "KILOGRAMO", vendible: false, activo: true }, algodon);
      await guardarProducto(db, a.master.id, O, { nombre: "Algodón", unidad: "GRAMO", vendible: false, activo: true }, algodon);
    });

    await t.test("precio de venta por sede, solo para vendibles", async () => {
      await guardarPrecioProducto(db, a.admin.id, O, a.centro.id, esmalte, "4500");
      await assert.rejects(guardarPrecioProducto(db, a.admin.id, O, a.norte.id, esmalte, "4500"), AccesoDenegado, "sede fuera de alcance");
      await assert.rejects(guardarPrecioProducto(db, a.recepcion.id, O, a.centro.id, esmalte, "4500"), AccesoDenegado);
      await assert.rejects(guardarPrecioProducto(db, a.admin.id, O, a.centro.id, algodon, "100"), DatosInvalidos, "consumo interno no lleva precio");
      await assert.rejects(guardarPrecioProducto(db, a.admin.id, O, a.centro.id, esmalte, "-1"), DatosInvalidos);
      const s = await stockSede(db, a.recepcion.id, O, a.centro.id);
      assert.equal(s.productos.find(p => p.id === esmalte)!.precio, "4500.00");
      assert.equal((await stockSede(db, a.recepcion.id, O, a.norte.id)).productos.find(p => p.id === esmalte)!.precio, null, "la otra sede no hereda el precio");
    });

    await t.test("compra con cantidades fraccionarias: ingreso por ítem y total al centavo", async () => {
      const compra = { sedeId: a.centro.id, proveedor: "Distribuidora Uno", comprobante: "A-0001-00001234", fecha: "2026-10-14", items: [
        { productoId: esmalte, cantidad: "12", costoUnitario: "2100" },
        { productoId: algodon, cantidad: "500,5", costoUnitario: "3,33" },
        { productoId: removedor, cantidad: "1000", costoUnitario: "12,5" },
      ] };
      await assert.rejects(registrarCompra(db, a.recepcion.id, O, compra), AccesoDenegado, "recepción no registra compras");
      await assert.rejects(registrarCompra(db, a.admin.id, O, { ...compra, sedeId: a.norte.id }), AccesoDenegado, "admin de otra sede");
      await assert.rejects(registrarCompra(db, a.admin.id, O, { ...compra, items: [{ productoId: esmalte, cantidad: "1,2345", costoUnitario: "1" }] }), DatosInvalidos, "más de 3 decimales");
      await assert.rejects(registrarCompra(db, a.admin.id, O, { ...compra, items: [{ productoId: esmalte, cantidad: "0", costoUnitario: "1" }] }), DatosInvalidos);
      await assert.rejects(registrarCompra(db, a.admin.id, O, { ...compra, fecha: "2026-02-30" }), DatosInvalidos);
      const ajeno = (await guardarProducto(db, b.master.id, b.org.id, { nombre: "Lima", unidad: "UNIDAD", vendible: true, activo: true })).id;
      await assert.rejects(registrarCompra(db, a.admin.id, O, { ...compra, items: [{ productoId: ajeno, cantidad: "1", costoUnitario: "1" }] }), AccesoDenegado, "producto de otra organización");
      const r = await registrarCompra(db, a.admin.id, O, compra);
      // 12 × 2100 + 500,5 × 3,33 (= 1666,665 → 1666,67) + 1000 × 12,5
      assert.equal(r.total, "39366.67");
      assert.deepEqual([await saldo(a.centro.id, esmalte), await saldo(a.centro.id, algodon), await saldo(a.centro.id, removedor)], ["12", "500.5", "1000"]);
      assert.equal(await saldo(a.norte.id, esmalte), "0", "el stock es por sede");
      const compras = await listarCompras(db, a.recepcion.id, O, a.centro.id);
      assert.deepEqual([compras.length, compras[0]!.items.length, compras[0]!.items[1]!.subtotal], [1, 3, "1666.67"]);
      await assert.rejects(listarCompras(db, a.recepcion.id, O, a.sur.id), AccesoDenegado);
    });

    await t.test("consumo interno: nunca deja negativo y es todo o nada", async () => {
      await registrarConsumo(db, a.recepcion.id, O, { sedeId: a.centro.id, items: [{ productoId: algodon, cantidad: "0,25" }, { productoId: removedor, cantidad: "30" }] });
      assert.deepEqual([await saldo(a.centro.id, algodon), await saldo(a.centro.id, removedor)], ["500.25", "970"]);
      await assert.rejects(registrarConsumo(db, a.recepcion.id, O, { sedeId: a.centro.id, items: [{ productoId: removedor, cantidad: "10" }, { productoId: algodon, cantidad: "500.251" }] }),
        (e: unknown) => e instanceof SinStock && e.disponible === "500.25" && /Algodón/.test(e.message));
      assert.equal(await saldo(a.centro.id, removedor), "970", "el primer ítem tampoco se aplicó");
      await assert.rejects(registrarConsumo(db, a.recepcion.id, O, { sedeId: a.sur.id, items: [{ productoId: algodon, cantidad: "1" }] }), AccesoDenegado);
      await assert.rejects(registrarConsumo(db, a.profesional.id, O, { sedeId: a.centro.id, items: [{ productoId: algodon, cantidad: "1" }] }), AccesoDenegado);
      await assert.rejects(registrarConsumo(db, a.recepcion.id, O, { sedeId: a.centro.id, items: [] }), DatosInvalidos);
    });

    await t.test("ajuste por conteo físico, con motivo; reverso sin editar ni borrar", async () => {
      await assert.rejects(ajustarStock(db, a.admin.id, O, { sedeId: a.centro.id, productoId: esmalte, contado: "11", motivo: " " }), DatosInvalidos, "motivo obligatorio");
      await assert.rejects(ajustarStock(db, a.recepcion.id, O, { sedeId: a.centro.id, productoId: esmalte, contado: "11", motivo: "Conteo" }), AccesoDenegado);
      await assert.rejects(ajustarStock(db, a.admin.id, O, { sedeId: a.centro.id, productoId: esmalte, contado: "12", motivo: "Conteo" }), DatosInvalidos, "sin diferencia");
      assert.equal((await ajustarStock(db, a.admin.id, O, { sedeId: a.centro.id, productoId: esmalte, contado: "11", motivo: "Conteo mensual: uno roto" })).diferencia, "-1");
      assert.equal(await saldo(a.centro.id, esmalte), "11");

      const ficha = await fichaProducto(db, a.admin.id, O, esmalte, a.centro.id);
      assert.deepEqual(ficha.movimientos.map(m => [m.tipo, m.cantidad, m.saldo]), [["AJUSTE", "-1", "11"], ["COMPRA", "12", "12"]]);
      assert.equal(ficha.movimientos[1]!.compra!.proveedor, "Distribuidora Uno");
      const ajuste = ficha.movimientos[0]!;
      await assert.rejects(revertirMovimiento(db, a.recepcion.id, O, ajuste.id, "Error"), AccesoDenegado);
      await assert.rejects(revertirMovimiento(db, b.master.id, b.org.id, ajuste.id, "Error"), AccesoDenegado, "movimiento de otra organización");
      await revertirMovimiento(db, a.admin.id, O, ajuste.id, "El esmalte apareció");
      assert.equal(await saldo(a.centro.id, esmalte), "12");
      await assert.rejects(revertirMovimiento(db, a.admin.id, O, ajuste.id, "Otra vez"), DatosInvalidos, "no se revierte dos veces");
      const reverso = (await fichaProducto(db, a.admin.id, O, esmalte, a.centro.id)).movimientos[0]!;
      assert.deepEqual([reverso.tipo, reverso.revierteId, reverso.reversible], ["REVERSO", ajuste.id, false]);
      await assert.rejects(revertirMovimiento(db, a.admin.id, O, reverso.id, "x"), DatosInvalidos, "un reverso no se revierte");

      // Revertir una compra ya consumida dejaría negativo: se rechaza.
      const compraRemovedor = (await fichaProducto(db, a.admin.id, O, removedor, a.centro.id)).movimientos.find(m => m.tipo === "COMPRA")!;
      await assert.rejects(revertirMovimiento(db, a.admin.id, O, compraRemovedor.id, "Factura mal cargada"), SinStock);
    });

    await t.test("transferencia entre sedes del alcance", async () => {
      await assert.rejects(transferirStock(db, a.admin.id, O, { origenId: a.centro.id, destinoId: a.norte.id, items: [{ productoId: esmalte, cantidad: "2" }] }), AccesoDenegado, "admin sin alcance en destino");
      await assert.rejects(transferirStock(db, a.franquiciado.id, O, { origenId: a.centro.id, destinoId: a.sur.id, items: [{ productoId: esmalte, cantidad: "2" }] }), AccesoDenegado, "sede de otro franquiciado");
      await assert.rejects(transferirStock(db, a.franquiciado.id, O, { origenId: a.centro.id, destinoId: a.centro.id, items: [{ productoId: esmalte, cantidad: "2" }] }), DatosInvalidos);
      await assert.rejects(transferirStock(db, a.franquiciado.id, O, { origenId: a.centro.id, destinoId: a.norte.id, items: [{ productoId: esmalte, cantidad: "12.001" }] }), SinStock);
      await transferirStock(db, a.franquiciado.id, O, { origenId: a.centro.id, destinoId: a.norte.id, items: [{ productoId: esmalte, cantidad: "2" }], motivo: "Reposición" });
      assert.deepEqual([await saldo(a.centro.id, esmalte), await saldo(a.norte.id, esmalte)], ["10", "2"]);
      const enNorte = await fichaProducto(db, a.franquiciado.id, O, esmalte, a.norte.id);
      assert.deepEqual([enNorte.movimientos[0]!.tipo, enNorte.movimientos[0]!.otraSede, enNorte.movimientos[0]!.reversible], ["TRANSFERENCIA_ENTRADA", "Centro", false]);
      assert.deepEqual(enNorte.otrasSedes.map(s => [s.sede, s.cantidad]), [["Centro", "10"]]);
    });

    await t.test("lectura por ID: sede y producto fuera de alcance", async () => {
      await assert.rejects(stockSede(db, a.admin.id, O, a.norte.id), AccesoDenegado);
      await assert.rejects(stockSede(db, a.profesional.id, O, a.centro.id), AccesoDenegado);
      await assert.rejects(fichaProducto(db, a.recepcion.id, O, esmalte, a.sur.id), AccesoDenegado);
      await assert.rejects(fichaProducto(db, b.master.id, b.org.id, esmalte, b.centro.id), AccesoDenegado, "producto de otra organización");
      await assert.rejects(stockSede(db, a.admin.id, O, "no-es-un-id"), AccesoDenegado);
      // El admin de Centro no ve el saldo de Norte en la ficha.
      assert.deepEqual((await fichaProducto(db, a.admin.id, O, esmalte, a.centro.id)).otrasSedes, []);
      const s = await stockSede(db, a.recepcion.id, O, a.centro.id);
      assert.deepEqual([s.puede.consumir, s.puede.gestionar, s.puede.administrarProductos], [true, false, false]);
    });

    await t.test("movimientos inmutables y saldo nunca negativo en la base", async () => {
      const mov = await db.movimientoStock.findFirstOrThrow({ where: { organizacionId: O } });
      await assert.rejects(db.movimientoStock.update({ where: { id: mov.id }, data: { motivo: "editado" } }), /solo inserción/);
      await assert.rejects(db.movimientoStock.delete({ where: { id: mov.id } }), /solo inserción/);
      const compra = await db.compra.findFirstOrThrow({ where: { organizacionId: O } });
      await assert.rejects(db.compra.update({ where: { id: compra.id }, data: { proveedor: "Otro" } }), /solo inserción/);
      await assert.rejects(db.stockSede.update({ where: { sedeId_productoId: { sedeId: a.centro.id, productoId: esmalte } }, data: { cantidad: "-0.001" } }), "CHECK de saldo no negativo");
      await assert.rejects(db.movimientoStock.create({ data: { organizacionId: O, sedeId: a.centro.id, productoId: esmalte, tipo: "VENTA", cantidad: "1", saldoResultante: "11", actorId: a.master.id } }), "CHECK de signo");
      await assert.rejects(db.movimientoStock.create({ data: { organizacionId: O, sedeId: a.centro.id, productoId: esmalte, tipo: "AJUSTE", cantidad: "1", saldoResultante: "11", actorId: a.master.id } }), "ajuste sin motivo");
      // La unidad ya no se puede cambiar.
      await assert.rejects(guardarProducto(db, a.master.id, O, { nombre: "Algodón", unidad: "KILOGRAMO", vendible: false, activo: true }, algodon), DatosInvalidos);
    });

    await t.test("egreso por venta: solo vendibles y con permiso en la sede", async () => {
      const vender = (actorId: string, sedeId: string, productoId: string, cantidad: string, conexion = db) =>
        conReintento(() => conexion.$transaction(tx => egresarPorVenta(tx, actorId, O, { sedeId, items: [{ productoId, cantidad }] })));
      await assert.rejects(vender(a.recepcion.id, a.centro.id, algodon, "1"), DatosInvalidos, "consumo interno no se vende");
      await assert.rejects(vender(a.recepcion.id, a.sur.id, esmalte, "1"), AccesoDenegado);
      await assert.rejects(vender(a.profesional.id, a.centro.id, esmalte, "1"), AccesoDenegado);
      await vender(a.recepcion.id, a.centro.id, esmalte, "1");
      assert.equal(await saldo(a.centro.id, esmalte), "9");
      const venta = (await fichaProducto(db, a.admin.id, O, esmalte, a.centro.id)).movimientos[0]!;
      assert.deepEqual([venta.tipo, venta.reversible], ["VENTA", false]);
      await assert.rejects(revertirMovimiento(db, a.admin.id, O, venta.id, "x"), DatosInvalidos, "la venta se anula desde la venta (O01)");
    });

    await t.test("venta concurrente desde dos conexiones no produce negativo", async () => {
      // Saldo 1,5; dos ventas de 1 desde conexiones distintas. La primera retiene el lock de la fila de
      // saldo mientras «termina» su venta; la segunda espera, lee 0,5 y se rechaza.
      await registrarCompra(db, a.franquiciado.id, O, { sedeId: a.norte.id, proveedor: "Distribuidora Uno", fecha: "2026-10-14", items: [{ productoId: removedor, cantidad: "1.5", costoUnitario: "10" }] });
      let conLock!: () => void;
      const primeraTieneLock = new Promise<void>(r => { conLock = r; });
      let segundaTermino = false;
      const primera = db.$transaction(async tx => {
        await egresarPorVenta(tx, a.recepcion.id, O, { sedeId: a.norte.id, items: [{ productoId: removedor, cantidad: "1" }] });
        conLock();
        await tx.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.6)`;
        assert.equal(segundaTermino, false, "la segunda espera el lock: no puede leer el saldo viejo");
      });
      primera.catch(() => conLock());
      await primeraTieneLock;
      const segunda = db2.$transaction(tx => egresarPorVenta(tx, a.recepcion.id, O, { sedeId: a.norte.id, items: [{ productoId: removedor, cantidad: "1" }] }))
        .finally(() => { segundaTermino = true; });
      const [r1, r2] = await Promise.allSettled([primera, segunda]);
      assert.equal(r1.status, "fulfilled");
      assert.ok(r2.status === "rejected" && r2.reason instanceof SinStock && r2.reason.disponible === "0.5", String(r2.status === "rejected" ? r2.reason : "la segunda no debía pasar"));
      assert.equal(await saldo(a.norte.id, removedor), "0.5");

      // Diez ventas de 0,75 en paralelo, repartidas entre las dos conexiones, sobre un saldo de 5,5: ganan 7.
      await registrarCompra(db, a.admin.id, O, { sedeId: a.centro.id, proveedor: "Distribuidora Uno", fecha: "2026-10-14", items: [{ productoId: removedor, cantidad: "5.5", costoUnitario: "10" }] });
      await registrarConsumo(db, a.admin.id, O, { sedeId: a.centro.id, items: [{ productoId: removedor, cantidad: "970" }] });
      assert.equal(await saldo(a.centro.id, removedor), "5.5");
      const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => conReintento(() => (i % 2 ? db2 : db).$transaction(tx =>
        egresarPorVenta(tx, a.recepcion.id, O, { sedeId: a.centro.id, items: [{ productoId: removedor, cantidad: "0.75" }] })))));
      assert.equal(r.filter(x => x.status === "fulfilled").length, 7);
      assert.ok(r.every(x => x.status === "fulfilled" || x.reason instanceof SinStock), "solo fallan por falta de stock");
      assert.equal(await saldo(a.centro.id, removedor), "0.25");
    });

    await t.test("el saldo es siempre la suma de sus movimientos", async () => {
      const descuadres = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "StockSede" s
        LEFT JOIN (SELECT "sedeId", "productoId", sum("cantidad") AS total FROM "MovimientoStock" GROUP BY 1, 2) m USING ("sedeId", "productoId")
        WHERE s."organizacionId" = ${O}::uuid AND s."cantidad" <> COALESCE(m.total, 0)`;
      assert.equal(Number(descuadres[0]!.n), 0);
      const ultimos = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "StockSede" s
        JOIN LATERAL (SELECT "saldoResultante" FROM "MovimientoStock" m WHERE m."sedeId" = s."sedeId" AND m."productoId" = s."productoId" ORDER BY "orden" DESC LIMIT 1) u ON true
        WHERE s."organizacionId" = ${O}::uuid AND s."cantidad" <> u."saldoResultante"`;
      assert.equal(Number(ultimos[0]!.n), 0, "el saldo resultante del último movimiento coincide con el saldo");
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
