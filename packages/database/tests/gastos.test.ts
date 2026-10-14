import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { sumarDias } from "@nailnet/domain/gastos";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { SOLO_DESDE_CAJA, actualizarCategoriaGasto, anularGasto, crearCategoriaGasto, listarCategoriasGasto, listarGastos, obtenerGasto, registrarGasto, type DatosGasto } from "../src/gastos.ts";
import { crearFixture } from "../prisma/fixture.ts";

test("gastos: categorías, alta, alcance por ID y anulación por reverso", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const hoy = aLocal(new Date(), "America/Argentina/Buenos_Aires").fecha;
    const ids: Record<string, string> = {};
    const gasto = (extra: Partial<DatosGasto> = {}): DatosGasto => ({
      sedeId: a.centro.id, categoriaId: ids.alquiler!, fecha: hoy, monto: "250000", medioPago: "TRANSFERENCIA", descripcion: "Alquiler del local", comprobante: "Recibo 0001-00000042", ...extra,
    });

    await t.test("categorías globales del master y locales por sede (D12)", async () => {
      await assert.rejects(crearCategoriaGasto(db, a.franquiciado.id, a.org.id, { nombre: "Alquiler", sedeId: null }), AccesoDenegado, "franquiciado no crea globales");
      await assert.rejects(crearCategoriaGasto(db, a.admin.id, a.org.id, { nombre: "Alquiler", sedeId: null }), AccesoDenegado);
      ids.alquiler = (await crearCategoriaGasto(db, a.master.id, a.org.id, { nombre: "Alquiler", sedeId: null })).id;
      ids.limpieza = (await crearCategoriaGasto(db, a.master.id, a.org.id, { nombre: "Limpieza", sedeId: null })).id;
      ids.cafeCentro = (await crearCategoriaGasto(db, a.admin.id, a.org.id, { nombre: "Café", sedeId: a.centro.id })).id;
      await assert.rejects(crearCategoriaGasto(db, a.admin.id, a.org.id, { nombre: "Café", sedeId: a.norte.id }), AccesoDenegado, "admin fuera de su sede");
      await assert.rejects(crearCategoriaGasto(db, a.recepcion.id, a.org.id, { nombre: "Varios", sedeId: a.centro.id }), AccesoDenegado);
      await assert.rejects(crearCategoriaGasto(db, a.franquiciado.id, a.org.id, { nombre: "Insumos", sedeId: a.sur.id }), AccesoDenegado, "sede de otro franquiciado");
      ids.cafeNorte = (await crearCategoriaGasto(db, a.franquiciado.id, a.org.id, { nombre: "café", sedeId: a.norte.id })).id;
      await assert.rejects(crearCategoriaGasto(db, a.admin.id, a.org.id, { nombre: "ALQUILER", sedeId: a.centro.id }), DatosInvalidos, "local no repite una global");
      await assert.rejects(crearCategoriaGasto(db, a.master.id, a.org.id, { nombre: "Café", sedeId: null }), DatosInvalidos, "global no repite una local");
      await assert.rejects(crearCategoriaGasto(db, a.admin.id, a.org.id, { nombre: "CAFÉ", sedeId: a.centro.id }), DatosInvalidos);
      await assert.rejects(crearCategoriaGasto(db, b.master.id, b.org.id, { nombre: "X", sedeId: a.centro.id }), AccesoDenegado, "sede de otra organización");

      const centro = await listarCategoriasGasto(db, a.admin.id, a.org.id, a.centro.id);
      assert.deepEqual(centro.categorias.map(c => [c.nombre, c.global, c.puedeEditar]), [["Alquiler", true, false], ["Café", false, true], ["Limpieza", true, false]]);
      assert.deepEqual([centro.puedeCrearGlobal, centro.puedeCrearLocal], [false, true]);
      await assert.rejects(listarCategoriasGasto(db, a.admin.id, a.org.id, a.norte.id), AccesoDenegado);
      // Recepción ve los gastos de su sede (Sicurella, 2026-10-14), pero no administra categorías.
      const deRecepcion = await listarCategoriasGasto(db, a.recepcion.id, a.org.id, a.centro.id);
      assert.deepEqual([deRecepcion.puedeCrearGlobal, deRecepcion.puedeCrearLocal], [false, false]);
      await assert.rejects(listarCategoriasGasto(db, a.recepcion.id, a.org.id, a.sur.id), AccesoDenegado, "recepción en otra sede");

      await assert.rejects(actualizarCategoriaGasto(db, a.admin.id, a.org.id, ids.alquiler, { nombre: "Renta" }), AccesoDenegado, "admin no edita globales");
      await assert.rejects(actualizarCategoriaGasto(db, a.admin.id, a.org.id, ids.cafeNorte, { activo: false }), AccesoDenegado, "local de otra sede, por ID");
      await assert.rejects(actualizarCategoriaGasto(db, b.master.id, b.org.id, ids.alquiler, { activo: false }), AccesoDenegado, "otra organización, por ID");
      await assert.rejects(actualizarCategoriaGasto(db, a.admin.id, a.org.id, ids.cafeCentro, { nombre: "limpieza" }), DatosInvalidos);
      await actualizarCategoriaGasto(db, a.admin.id, a.org.id, ids.cafeCentro, { nombre: "Café y yerba" });
      await assert.rejects(actualizarCategoriaGasto(db, a.admin.id, a.org.id, "no-es-uuid", { activo: false }), AccesoDenegado);
    });

    await t.test("alta: alcance, categoría aplicable y validaciones", async () => {
      ids.g1 = (await registrarGasto(db, a.admin.id, a.org.id, gasto())).id;
      ids.g2 = (await registrarGasto(db, a.franquiciado.id, a.org.id, gasto({ categoriaId: ids.cafeCentro, monto: "12500,50", medioPago: "EFECTIVO", descripcion: "Café y azúcar", comprobante: "" }))).id;
      ids.sur = (await registrarGasto(db, a.master.id, a.org.id, gasto({ sedeId: a.sur.id, medioPago: "EFECTIVO" }))).id;
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ sedeId: a.norte.id })), AccesoDenegado, "admin en otra sede");
      await assert.rejects(registrarGasto(db, a.franquiciado.id, a.org.id, gasto({ sedeId: a.sur.id })), AccesoDenegado, "franquiciado en sede ajena");
      // Recepción solo carga gastos en efectivo pagados con la caja abierta.
      await assert.rejects(registrarGasto(db, a.recepcion.id, a.org.id, gasto()), (e: unknown) => e instanceof DatosInvalidos && e.message === SOLO_DESDE_CAJA, "transferencia");
      await assert.rejects(registrarGasto(db, a.recepcion.id, a.org.id, gasto({ medioPago: "EFECTIVO", desdeCaja: false })), DatosInvalidos, "efectivo por fuera de la caja");
      await assert.rejects(registrarGasto(db, a.recepcion.id, a.org.id, gasto({ medioPago: "EFECTIVO" })), DatosInvalidos, "sin caja abierta");
      await assert.rejects(registrarGasto(db, a.recepcion.id, a.org.id, gasto({ sedeId: a.sur.id, medioPago: "EFECTIVO" })), AccesoDenegado, "recepción en otra sede");
      await assert.rejects(registrarGasto(db, a.profesional.id, a.org.id, gasto()), AccesoDenegado);
      await assert.rejects(registrarGasto(db, b.master.id, b.org.id, gasto()), AccesoDenegado, "sede de otra organización");
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ categoriaId: ids.cafeNorte })), AccesoDenegado, "categoría local de otra sede");
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ sedeId: "x" })), AccesoDenegado, "ID mal formado");
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ fecha: sumarDias(hoy, 1) })), DatosInvalidos, "fecha futura");
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ monto: "0" })), DatosInvalidos);
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ medioPago: "CHEQUE" })), DatosInvalidos);
      await actualizarCategoriaGasto(db, a.master.id, a.org.id, ids.limpieza, { activo: false });
      await assert.rejects(registrarGasto(db, a.admin.id, a.org.id, gasto({ categoriaId: ids.limpieza })), DatosInvalidos, "categoría inactiva");
      await actualizarCategoriaGasto(db, a.master.id, a.org.id, ids.limpieza, { activo: true });
    });

    await t.test("lectura por ID y por sede respeta el alcance", async () => {
      const g = await obtenerGasto(db, a.franquiciado.id, a.org.id, ids.g1!);
      assert.deepEqual([g.monto, g.medioPago, g.registradoPorId, g.anulacion], ["250000.00", "TRANSFERENCIA", a.admin.id, null]);
      assert.equal((await obtenerGasto(db, a.master.id, a.org.id, ids.sur!)).sedeId, a.sur.id);
      await assert.rejects(obtenerGasto(db, a.admin.id, a.org.id, ids.sur!), AccesoDenegado, "admin de centro lee gasto de sur");
      await assert.rejects(obtenerGasto(db, a.franquiciado.id, a.org.id, ids.sur!), AccesoDenegado);
      assert.equal((await obtenerGasto(db, a.recepcion.id, a.org.id, ids.g1!)).id, ids.g1, "recepción lee los gastos de su sede");
      await assert.rejects(obtenerGasto(db, a.recepcion.id, a.org.id, ids.sur!), AccesoDenegado);
      await assert.rejects(obtenerGasto(db, b.master.id, b.org.id, ids.g1!), AccesoDenegado, "otra organización");
      await assert.rejects(listarGastos(db, a.admin.id, a.org.id, { sedeId: a.sur.id }), AccesoDenegado);
      const deRecepcion = await listarGastos(db, a.recepcion.id, a.org.id, { sedeId: a.centro.id, desde: hoy, hasta: hoy });
      assert.deepEqual([deRecepcion.puedeRegistrar, deRecepcion.soloDesdeCaja, deRecepcion.puedeAnular], [true, true, false]);
      await assert.rejects(listarGastos(db, a.recepcion.id, a.org.id, { sedeId: a.sur.id }), AccesoDenegado);
      const lista = await listarGastos(db, a.admin.id, a.org.id, { sedeId: a.centro.id, desde: hoy, hasta: hoy });
      assert.equal(lista.gastos.length, 2, "no incluye el gasto de sur");
      assert.deepEqual([lista.total, lista.efectivo, lista.puedeRegistrar, lista.puedeAnular], ["262500.50", "12500.50", true, true]);
      await assert.rejects(listarGastos(db, a.admin.id, a.org.id, { sedeId: a.centro.id, desde: hoy, hasta: sumarDias(hoy, -1) }), DatosInvalidos);
    });

    await t.test("anulación: reverso trazable, una sola vez, dentro del alcance", async () => {
      await assert.rejects(anularGasto(db, a.admin.id, a.org.id, ids.sur!, "Cargado en la sede equivocada"), AccesoDenegado, "escritura por ID fuera de alcance");
      await assert.rejects(anularGasto(db, b.master.id, b.org.id, ids.g1!, "Cargado en la sede equivocada"), AccesoDenegado);
      await assert.rejects(anularGasto(db, a.recepcion.id, a.org.id, ids.g1!, "Cargado en la sede equivocada"), AccesoDenegado);
      await assert.rejects(anularGasto(db, a.admin.id, a.org.id, ids.g1!, "no"), DatosInvalidos, "motivo obligatorio");
      const reverso = await anularGasto(db, a.admin.id, a.org.id, ids.g1!, "Cargado dos veces");
      await assert.rejects(anularGasto(db, a.franquiciado.id, a.org.id, ids.g1!, "Otra vez lo mismo"), DatosInvalidos, "ya anulado");
      await assert.rejects(anularGasto(db, a.admin.id, a.org.id, reverso.id, "Anular el reverso"), AccesoDenegado, "un reverso no se anula");

      const g = await obtenerGasto(db, a.admin.id, a.org.id, ids.g1!);
      assert.deepEqual([g.monto, g.anulacion?.monto, g.anulacion?.motivo, g.anulacion?.porId], ["250000.00", "-250000.00", "Cargado dos veces", a.admin.id], "el original no cambia");
      const lista = await listarGastos(db, a.franquiciado.id, a.org.id, { sedeId: a.centro.id, desde: hoy, hasta: hoy });
      assert.equal(lista.gastos.length, 2, "el anulado sigue a la vista");
      assert.equal(lista.gastos.find(x => x.id === ids.g1)?.anulacion?.motivo, "Cargado dos veces");
      assert.deepEqual([lista.total, lista.efectivo], ["12500.50", "12500.50"], "el anulado no suma");
      assert.deepEqual(lista.porCategoria.map(c => [c.nombre, c.total]), [["Café y yerba", "12500.50"]]);
      const filtrado = await listarGastos(db, a.admin.id, a.org.id, { sedeId: a.centro.id, desde: hoy, hasta: hoy, categoriaId: ids.alquiler });
      assert.deepEqual([filtrado.gastos.length, filtrado.total], [1, "0.00"]);
    });

    await t.test("anulaciones simultáneas: solo una gana", async () => {
      const g = await registrarGasto(db, a.admin.id, a.org.id, gasto({ monto: "1000" }));
      const r = await Promise.allSettled([1, 2, 3].map(() => anularGasto(db, a.admin.id, a.org.id, g.id, "Prueba de concurrencia")));
      assert.equal(r.filter(x => x.status === "fulfilled").length, 1);
      for (const x of r) if (x.status === "rejected") assert.ok(x.reason instanceof DatosInvalidos, String(x.reason));
      assert.equal(await db.gasto.count({ where: { revierteId: g.id } }), 1);
    });

    await t.test("la base impide editar, borrar o fabricar reversos incoherentes", async () => {
      await assert.rejects(db.gasto.update({ where: { id: ids.g2! }, data: { descripcion: "Otra cosa" } }), "sin UPDATE");
      await assert.rejects(db.gasto.delete({ where: { id: ids.g2! } }), "sin DELETE");
      const base = { organizacionId: a.org.id, sedeId: a.centro.id, categoriaId: ids.cafeCentro!, fecha: new Date(`${hoy}T00:00:00Z`), medioPago: "EFECTIVO" as const, descripcion: "Directo a la base", registradoPorId: a.admin.id };
      await assert.rejects(db.gasto.create({ data: { ...base, tipo: "REVERSO", monto: "-0.01", revierteId: ids.g2!, motivoAnulacion: "Monto que no coincide" } }), "reverso con otro monto");
      await assert.rejects(db.gasto.create({ data: { ...base, tipo: "GASTO", monto: "-1.00" } }), "gasto negativo");
      await assert.rejects(db.gasto.create({ data: { ...base, tipo: "REVERSO", monto: "-12500.50", revierteId: ids.g2! } }), "reverso sin motivo");
      await assert.rejects(db.gasto.create({ data: { ...base, sedeId: a.norte.id, tipo: "GASTO", monto: "1.00" } }), "categoría local de otra sede");
      await assert.rejects(db.categoriaGasto.create({ data: { organizacionId: a.org.id, sedeId: null, nombre: "alquiler" } }), "nombre global repetido");
    });
  } finally { await db.$disconnect(); }
});
