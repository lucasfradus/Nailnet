import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { abrirCaja } from "../src/caja.ts";
import { crearMedioPago, guardarMediosPago, listarMediosPago, mediosHabilitados, type MedioEdicion } from "../src/medios-pago.ts";
import { guardarPrecioProducto, guardarProducto, registrarCompra } from "../src/stock.ts";
import { anularVenta, obtenerVenta, registrarCobro, registrarVenta } from "../src/ventas.ts";
import { crearFixture } from "../prisma/fixture.ts";

test("medios de pago de la sede (D22, doc 32, etapa 1)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id, ADM = a.admin.id, F = a.franquiciado.id;
    const centro = a.centro.id, norte = a.norte.id, sur = a.sur.id;
    const edicion = (medios: Awaited<ReturnType<typeof listarMediosPago>>["medios"]): MedioEdicion[] =>
      medios.map((m, i) => ({ id: m.id, nombre: m.nombre, ajuste: String(Number(m.ajuste) / 100), habilitado: m.habilitado, orden: i + 1 })); // como la pantalla: 1, 2, 3…
    const POR_DEFECTO = { paso: "100", sentido: "ABAJO" };

    await t.test("cada sede nace con los seis medios estándar en 0% y redondeo $100 hacia abajo", async () => {
      const l = await listarMediosPago(db, R, O, centro);
      assert.deepEqual(l.medios.map(m => [m.nombre, m.tipo, m.ajuste, m.habilitado]), [
        ["Efectivo", "EFECTIVO", 0n, true], ["Transferencia", "TRANSFERENCIA", 0n, true], ["Débito", "TARJETA_DEBITO", 0n, true],
        ["Crédito", "TARJETA_CREDITO", 0n, true], ["Mercado Pago", "MERCADO_PAGO", 0n, true], ["Otro", "OTRO", 0n, true],
      ]);
      assert.deepEqual(l.redondeo, { paso: 100, sentido: "ABAJO" });
      assert.equal(l.puedeEditar, false, "recepción ve, no edita");
      assert.equal((await listarMediosPago(db, ADM, O, centro)).puedeEditar, true);
      assert.equal((await mediosHabilitados(db, O, sur)).length, 6, "también las sedes de otro franquiciado");
    });

    await t.test("permisos: admin de sede, franquiciado y master; nadie fuera de su alcance", async () => {
      const medios = edicion((await listarMediosPago(db, M, O, norte)).medios);
      await assert.rejects(guardarMediosPago(db, R, O, centro, { medios, redondeo: POR_DEFECTO }), AccesoDenegado);
      await assert.rejects(guardarMediosPago(db, ADM, O, norte, { medios, redondeo: POR_DEFECTO }), AccesoDenegado, "admin de Centro en Norte");
      await assert.rejects(listarMediosPago(db, F, O, sur), AccesoDenegado, "Sur es de otro franquiciado");
      await assert.rejects(listarMediosPago(db, a.profesional.id, O, centro), AccesoDenegado);
      await assert.rejects(crearMedioPago(db, R, O, centro, { nombre: "Cuenta DNI", tipo: "OTRO", ajuste: "0" }), AccesoDenegado);
      await guardarMediosPago(db, F, O, norte, { medios, redondeo: POR_DEFECTO });
    });

    await t.test("guardar: porcentajes, nombres, orden, habilitación y redondeo", async () => {
      const antes = edicion((await listarMediosPago(db, ADM, O, centro)).medios);
      const medios = antes.map(m => m.nombre === "Efectivo" ? { ...m, ajuste: "-10" }
        : m.nombre === "Transferencia" ? { ...m, ajuste: "-10", nombre: "Transferencia bancaria" }
        : m.nombre === "Otro" ? { ...m, habilitado: false, orden: 0 } : m);
      await guardarMediosPago(db, ADM, O, centro, { medios, redondeo: { paso: "500", sentido: "CERCANO" } });
      const l = await listarMediosPago(db, ADM, O, centro);
      assert.deepEqual(l.medios.map(m => [m.nombre, m.ajuste, m.habilitado, m.orden]), [
        ["Otro", 0n, false, 0], ["Efectivo", -1000n, true, 1], ["Transferencia bancaria", -1000n, true, 2],
        ["Débito", 0n, true, 3], ["Crédito", 0n, true, 4], ["Mercado Pago", 0n, true, 5],
      ]);
      assert.deepEqual(l.redondeo, { paso: 500, sentido: "CERCANO" });
      assert.ok(!(await mediosHabilitados(db, O, centro)).some(m => m.nombre === "Otro"));
      // Intercambiar dos nombres no choca con el índice único.
      const cruzar = (lista: MedioEdicion[]) => lista.map(m => m.nombre === "Débito" ? { ...m, nombre: "Crédito" } : m.nombre === "Crédito" ? { ...m, nombre: "Débito" } : m);
      await guardarMediosPago(db, ADM, O, centro, { medios: cruzar(edicion(l.medios)), redondeo: POR_DEFECTO });
      const despues = await listarMediosPago(db, ADM, O, centro);
      assert.equal(despues.medios.find(m => m.nombre === "Débito")!.tipo, "TARJETA_CREDITO", "el tipo no cambia con el nombre");
      await guardarMediosPago(db, ADM, O, centro, { medios: cruzar(edicion(despues.medios)), redondeo: POR_DEFECTO });
    });

    await t.test("guardar: rechaza datos inválidos sin tocar nada", async () => {
      const medios = edicion((await listarMediosPago(db, ADM, O, centro)).medios);
      const intento = (m: MedioEdicion[], redondeo = POR_DEFECTO) => assert.rejects(guardarMediosPago(db, ADM, O, centro, { medios: m, redondeo }), DatosInvalidos);
      await intento(medios.map(m => ({ ...m, habilitado: false })));
      await intento(medios.map((m, i) => i === 1 ? { ...m, nombre: medios[0]!.nombre.toUpperCase() } : m));
      await intento(medios.map((m, i) => i === 0 ? { ...m, ajuste: "-95" } : m));
      await intento(medios.map((m, i) => i === 0 ? { ...m, ajuste: "abc" } : m));
      await intento(medios.slice(1));
      await intento(medios, { paso: "7", sentido: "ABAJO" });
      await intento([...medios.slice(1), { ...medios[0]!, id: randomUUID() }]);
      assert.equal((await listarMediosPago(db, ADM, O, centro)).medios.find(m => m.nombre === "Efectivo")!.ajuste, -1000n);
    });

    let dni = "";
    await t.test("crear: un medio nuevo al final; nombre único sin distinguir mayúsculas", async () => {
      dni = (await crearMedioPago(db, ADM, O, centro, { nombre: "Cuenta DNI", tipo: "TRANSFERENCIA", ajuste: "-10" })).id;
      const l = await listarMediosPago(db, ADM, O, centro);
      assert.deepEqual(l.medios.at(-1), { id: dni, nombre: "Cuenta DNI", tipo: "TRANSFERENCIA", habilitado: true, orden: 6, ajuste: -1000n, conCobros: false });
      await assert.rejects(crearMedioPago(db, ADM, O, centro, { nombre: "cuenta dni", tipo: "OTRO", ajuste: "0" }), DatosInvalidos);
      await assert.rejects(crearMedioPago(db, ADM, O, centro, { nombre: "Cheque", tipo: "CHEQUE", ajuste: "0" }), DatosInvalidos);
      assert.equal((await listarMediosPago(db, M, O, norte)).medios.length, 6, "no aparece en otra sede");
    });

    await t.test("cobros: guardan el medio de la sede; el reverso lo repite aunque se haya deshabilitado", async () => {
      const esmalte = (await guardarProducto(db, M, O, { nombre: "Esmalte", unidad: "UNIDAD", vendible: true, activo: true })).id;
      await guardarPrecioProducto(db, ADM, O, centro, esmalte, "1000");
      await registrarCompra(db, M, O, { sedeId: centro, proveedor: "Distribuidora", fecha: "2026-11-16", items: [{ productoId: esmalte, cantidad: "10", costoUnitario: "500" }] });
      await abrirCaja(db, R, O, { sedeId: centro, montoInicial: "0" });
      const efectivo = (await mediosHabilitados(db, O, centro)).find(m => m.tipo === "EFECTIVO")!;
      const venta = await registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "3" }], cobros: [{ medio: dni, monto: "1000" }, { medio: efectivo.id, monto: "500" }], claveIdempotencia: randomUUID() });
      // Compatibilidad: un tipo sigue siendo válido y toma el primer medio habilitado de ese tipo.
      await registrarCobro(db, R, O, venta.id, { medio: "TARJETA_DEBITO", monto: "1500", claveIdempotencia: randomUUID() });
      const v = await obtenerVenta(db, R, O, venta.id);
      assert.deepEqual(v.cobros.map(c => [c.medio, c.medioNombre, c.monto]), [["TRANSFERENCIA", "Cuenta DNI", "1000.00"], ["EFECTIVO", "Efectivo", "500.00"], ["TARJETA_DEBITO", "Débito", "1500.00"]]);
      assert.equal((await listarMediosPago(db, ADM, O, centro)).medios.find(m => m.id === dni)!.conCobros, true);

      // Deshabilitado: no se cobra con él, pero la anulación igual revierte sus cobros.
      const l = await listarMediosPago(db, ADM, O, centro);
      await guardarMediosPago(db, ADM, O, centro, { medios: edicion(l.medios).map(m => m.id === dni ? { ...m, habilitado: false } : m), redondeo: POR_DEFECTO });
      const otra = await registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: randomUUID() });
      await assert.rejects(registrarCobro(db, R, O, otra.id, { medio: dni, monto: "1000", claveIdempotencia: randomUUID() }), DatosInvalidos);
      await anularVenta(db, ADM, O, venta.id, { motivo: "Prueba de reverso", reponerStock: false });
      const anulada = await obtenerVenta(db, R, O, venta.id);
      assert.deepEqual(anulada.cobros.filter(c => c.tipo === "REVERSO").map(c => c.medioNombre), ["Cuenta DNI", "Efectivo", "Débito"]);
    });

    await t.test("base: el tipo no cambia, un medio no se borra y el cobro respeta el tipo de su medio", async () => {
      const [m] = await db.medioPagoSede.findMany({ where: { organizacionId: O, sedeId: norte, tipo: "EFECTIVO" } });
      await assert.rejects(db.medioPagoSede.update({ where: { id: m!.id }, data: { tipo: "OTRO" } }), /no cambian/);
      await assert.rejects(db.medioPagoSede.delete({ where: { id: m!.id } }), /no se borra/);
      await assert.rejects(db.medioPagoSede.update({ where: { id: m!.id }, data: { ajustePct: "-95" } }), /MedioPagoSede_valores/);
      await assert.rejects(db.configuracionSede.upsert({ where: { sedeId: norte }, create: { organizacionId: O, sedeId: norte, redondeoPaso: 7 }, update: { redondeoPaso: 7 } }), /ConfiguracionSede_redondeo/);
      const venta = await db.venta.findFirst({ where: { organizacionId: O, sedeId: centro, estado: "PENDIENTE" } });
      const debito = (await mediosHabilitados(db, O, centro)).find(x => x.tipo === "TARJETA_DEBITO")!;
      await assert.rejects(db.cobroVenta.create({ data: { organizacionId: O, sedeId: centro, ventaId: venta!.id, tipo: "COBRO", medio: "TRANSFERENCIA", medioPagoId: debito.id, medioNombre: "Débito", monto: "1", registradoPorId: R } }), /tipo de su medio/);
      await assert.rejects(db.cobroVenta.create({ data: { organizacionId: O, sedeId: centro, ventaId: venta!.id, tipo: "COBRO", medio: "EFECTIVO", medioPagoId: m!.id, medioNombre: "Efectivo", monto: "1", registradoPorId: R } }), "un medio de otra sede");
    });
  } finally {
    await db.$disconnect();
  }
});
