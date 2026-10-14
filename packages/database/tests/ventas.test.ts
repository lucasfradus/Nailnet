import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { abrirCaja, cerrarCaja, estadoCaja, obtenerCaja, registrarMovimientoManual, revertirMovimientoCaja } from "../src/caja.ts";
import { crearCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { anularGasto, crearCategoriaGasto, registrarGasto } from "../src/gastos.ts";
import { aplicarPago } from "../src/pagos.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { marcarAtendida, tomarTurno } from "../src/reservas.ts";
import { SinStock, fichaProducto, guardarPrecioProducto, guardarProducto, registrarCompra } from "../src/stock.ts";
import { SIN_CAJA_EFECTIVO, anularVenta, listarVentas, obtenerVenta, prepararVenta, registrarCobro, registrarCobroEn, registrarVenta, ventasDeReservas } from "../src/ventas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");
const clave = () => randomUUID();
let pagoExterno = 7_000_000;

test("ventas, cobros y caja (O01, O02, M03)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  // Segunda conexión independiente (otro pool) para las pruebas de concurrencia.
  const db2 = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id, ADM = a.admin.id;
    const centro = a.centro.id, norte = a.norte.id;

    // Catálogo: servicio de $30.000 con seña del 30% ($9.000), una profesional y una clienta.
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const semi = (await guardarServicio(db, M, O, { categoriaId: cat.id, nombre: "Semi", duracionMinutos: 60, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "PORCENTAJE", valor: "30" }, activo: true, consentimientos: [], skillIds: [], recursos: [] }))!.id;
    await guardarServicioSede(db, M, O, centro, semi, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana", apellido: "Pérez" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [], servicioIds: [semi] });
    await guardarHorarioProfesional(db, M, O, ana, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 60 });
    const clienta = (await crearCliente(db, M, O, centro, { nombre: "Lucía", telefono: "1155551234" }))!.id;

    /** Turno de recepción (confirmado) que se marca atendido a su hora. */
    const atendido = async (hhmm: string) => {
      const r = await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: clienta, items: [{ servicioId: semi, profesionalId: ana }], inicio: en(hhmm) }, ahora);
      await marcarAtendida(db, R, O, r.reservaId, en(hhmm));
      return r.reservaId;
    };
    /** Seña de $9.000 aprobada por Mercado Pago, aplicada por el mismo código que usa el worker (R04). */
    const senar = async (reservaId: string, monto = "9000.00") => {
      const checkout = await db.checkoutPago.create({ data: { organizacionId: O, sedeId: centro, reservaId, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA", monto, expiraEn: new Date(ahora.getTime() + 900_000) } });
      const id = String(++pagoExterno);
      const r = await aplicarPago(db, { sedeId: centro, ambiente: "PRUEBA", cuentaId: "cuenta-1" }, { id, status: "approved", statusDetail: "accredited", monto, moneda: "ARS", referenciaExterna: checkout.id, cobradorId: "cuenta-1", aprobadoEn: ahora }, ahora);
      assert.equal(r.resultado, "APROBADO");
      return (await db.pago.findFirstOrThrow({ where: { externoId: id } })).id;
    };

    // Productos: esmalte vendible con precio en Centro y Norte, algodón de consumo interno, removedor sin precio en Centro.
    const esmalte = (await guardarProducto(db, M, O, { nombre: "Esmalte rojo", unidad: "UNIDAD", vendible: true, activo: true })).id;
    const algodon = (await guardarProducto(db, M, O, { nombre: "Algodón", unidad: "GRAMO", vendible: false, activo: true })).id;
    const removedor = (await guardarProducto(db, M, O, { nombre: "Removedor", unidad: "MILILITRO", vendible: true, activo: true })).id;
    await guardarPrecioProducto(db, ADM, O, centro, esmalte, "4500");
    await guardarPrecioProducto(db, M, O, norte, esmalte, "4600");
    for (const sedeId of [centro, norte]) await registrarCompra(db, M, O, { sedeId, proveedor: "Distribuidora", fecha: "2026-10-14", items: [{ productoId: esmalte, cantidad: "10", costoUnitario: "2000" }, { productoId: algodon, cantidad: "100", costoUnitario: "1" }] });
    const stockDe = async (sedeId: string, productoId: string) => (await fichaProducto(db, M, O, productoId, sedeId)).cantidad;
    const esperadoCentro = async () => (await estadoCaja(db, M, O, centro)).abierta?.esperado ?? null;

    let ventaM03 = "", ventaMixta = "", reservaM03 = "", pagoM03 = "";

    await t.test("caja: una sola abierta por sede, entradas, salidas y reversos sin efectivo negativo", async () => {
      await assert.rejects(abrirCaja(db, a.profesional.id, O, { sedeId: centro, montoInicial: "5000" }), AccesoDenegado);
      await assert.rejects(abrirCaja(db, R, O, { sedeId: centro, montoInicial: "-1" }), DatosInvalidos);
      await assert.rejects(abrirCaja(db, R, O, { sedeId: a.sur.id, montoInicial: "0" }), AccesoDenegado, "sede de otro franquiciado");
      await abrirCaja(db, R, O, { sedeId: centro, montoInicial: "5000" });
      await assert.rejects(abrirCaja(db, ADM, O, { sedeId: centro, montoInicial: "1" }), /ya tiene una caja abierta/);
      // Dos aperturas simultáneas desde dos conexiones: la base deja pasar una sola.
      const r = await Promise.allSettled([abrirCaja(db, R, O, { sedeId: norte, montoInicial: "100" }), abrirCaja(db2, a.franquiciado.id, O, { sedeId: norte, montoInicial: "200" })]);
      assert.equal(r.filter(x => x.status === "fulfilled").length, 1);
      assert.ok(r.every(x => x.status === "fulfilled" || x.reason instanceof DatosInvalidos));
      assert.equal(await db.caja.count({ where: { sedeId: norte, estado: "ABIERTA" } }), 1);

      await assert.rejects(registrarMovimientoManual(db, R, O, { sedeId: centro, tipo: "SALIDA", monto: "5000,01", motivo: "Retiro para depositar" }), /no tiene efectivo suficiente/);
      await assert.rejects(registrarMovimientoManual(db, R, O, { sedeId: centro, tipo: "SALIDA", monto: "100", motivo: "x" }), DatosInvalidos, "motivo obligatorio");
      await registrarMovimientoManual(db, R, O, { sedeId: centro, tipo: "SALIDA", monto: "1000", motivo: "Retiro para depositar" });
      await registrarMovimientoManual(db, R, O, { sedeId: centro, tipo: "ENTRADA", monto: "2000", motivo: "Cambio traído del banco" });
      const caja = (await estadoCaja(db, R, O, centro)).abierta!;
      assert.equal(caja.esperado, "6000.00");
      const salida = caja.movimientos.find(m => m.tipo === "SALIDA")!;
      await assert.rejects(revertirMovimientoCaja(db, b.master.id, b.org.id, salida.id, "Error de carga"), AccesoDenegado, "movimiento de otra organización");
      await revertirMovimientoCaja(db, R, O, salida.id, "Se cargó por error");
      await assert.rejects(revertirMovimientoCaja(db, R, O, salida.id, "Otra vez más"), /ya fue revertido/);
      const despues = (await estadoCaja(db, R, O, centro)).abierta!;
      assert.equal(despues.esperado, "7000.00");
      const reverso = despues.movimientos.at(-1)!;
      assert.deepEqual([reverso.tipo, reverso.monto, reverso.revierteId, reverso.revertible], ["REVERSO", "1000.00", salida.id, false]);
      await assert.rejects(revertirMovimientoCaja(db, R, O, reverso.id, "Un reverso no se revierte"), DatosInvalidos);
    });

    await t.test("M03: servicio de $30.000 con seña de $9.000 por MP → venta de $30.000 y se cobran $21.000, sin doble ingreso", async () => {
      reservaM03 = await atendido("09:00");
      pagoM03 = await senar(reservaM03);
      const prep = await prepararVenta(db, R, O, centro, reservaM03);
      assert.deepEqual([prep.turno!.subtotal, prep.turno!.anticipo, prep.turno!.ventaId, prep.cajaAbierta], ["30000.00", "9000.00", null, true]);
      const antes = await esperadoCentro();
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, reservaId: reservaM03, productos: [], cobros: [{ medio: "EFECTIVO", monto: "21000,01" }], claveIdempotencia: clave() }), /más de lo que falta \(\$ 21\.000,00\)/);
      const v = await registrarVenta(db, R, O, { sedeId: centro, reservaId: reservaM03, productos: [], cobros: [{ medio: "EFECTIVO", monto: "21000" }], claveIdempotencia: clave() });
      ventaM03 = v.id;
      assert.deepEqual([v.estado, v.saldo, v.repetida], ["COMPLETADA", "0.00", false]);
      const venta = await obtenerVenta(db, R, O, v.id);
      assert.deepEqual([venta.total, venta.anticipo, venta.cobrado, venta.items.length, venta.items[0]!.descripcion], ["30000.00", "9000.00", "21000.00", 1, "Semi · Ana Pérez"]);
      // Ventas suman 30.000; cobros, 9.000 (MP, ya cobrado) + 21.000 (recepción). Nunca 39.000.
      const dia = await listarVentas(db, R, O, { sedeId: centro, fecha: venta.fecha });
      assert.deepEqual([dia.totales.vendido, dia.totales.senasAplicadas, dia.totales.cobrado, dia.totales.efectivo], ["30000.00", "9000.00", "21000.00", "21000.00"]);
      // Solo los 21.000 en efectivo entran en la caja; la seña no.
      assert.equal(Number(await esperadoCentro()) - Number(antes), 21000);
      // El turno ya está cobrado: no se puede volver a cobrar ni aplicar la misma seña.
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, reservaId: reservaM03, productos: [], cobros: [], claveIdempotencia: clave() }), /ya tiene una venta/);
      assert.equal((await db.pago.findUniqueOrThrow({ where: { id: pagoM03 } })).estado, "APROBADO", "el pago de MP no cambia");
      assert.equal((await ventasDeReservas(db, R, O, centro, [reservaM03])).get(reservaM03)?.ventaId, v.id);
    });

    await t.test("venta mixta: servicio y productos, descuento y cobros con varios medios; los digitales no inflan el efectivo", async () => {
      const reserva = await atendido("10:00");
      const antes = await esperadoCentro();
      // 30.000 + 2 × 4.500 − 1.000 = 38.000. Efectivo 10.000 + débito 20.000 → quedan 8.000.
      const v = await registrarVenta(db, R, O, { sedeId: centro, reservaId: reserva, productos: [{ productoId: esmalte, cantidad: "2" }], descuento: "1000", claveIdempotencia: clave(),
        cobros: [{ medio: "EFECTIVO", monto: "10000" }, { medio: "TARJETA_DEBITO", monto: "20000", referencia: "Lote 12 · cupón 3456" }] });
      ventaMixta = v.id;
      assert.deepEqual([v.estado, v.saldo], ["PENDIENTE", "8000.00"]);
      assert.equal(await stockDe(centro, esmalte), "8", "el egreso de stock va en la misma transacción");
      const mov = (await fichaProducto(db, M, O, esmalte, centro)).movimientos[0]!;
      assert.deepEqual([mov.tipo, mov.ventaId], ["VENTA", v.id]);
      await assert.rejects(registrarCobro(db, R, O, v.id, { medio: "MERCADO_PAGO", monto: "8000,01", claveIdempotencia: clave() }), DatosInvalidos);
      const c = await registrarCobro(db, R, O, v.id, { medio: "MERCADO_PAGO", monto: "8000", referencia: "QR mostrador", claveIdempotencia: clave() });
      assert.deepEqual([c.estado, c.saldo], ["COMPLETADA", "0.00"]);
      await assert.rejects(registrarCobro(db, R, O, v.id, { medio: "EFECTIVO", monto: "1", claveIdempotencia: clave() }), /ya está cobrada/);
      const venta = await obtenerVenta(db, R, O, v.id);
      assert.deepEqual([venta.subtotal, venta.descuento, venta.total, venta.anticipo], ["39000.00", "1000.00", "38000.00", "0.00"]);
      assert.deepEqual(venta.items.map(i => [i.tipo, i.cantidad, i.subtotal]), [["SERVICIO", "1", "30000.00"], ["PRODUCTO", "2", "9000.00"]]);
      // Caja: solo los 10.000 en efectivo. Débito y MP se informan aparte.
      const caja = (await estadoCaja(db, R, O, centro)).abierta!;
      assert.equal(Number(caja.esperado) - Number(antes), 10000);
      assert.deepEqual(caja.noEfectivo.sort((x, y) => x.medio.localeCompare(y.medio)), [{ medio: "MERCADO_PAGO", total: "8000.00" }, { medio: "TARJETA_DEBITO", total: "20000.00" }]);

      // Productos sueltos, sin turno, con transferencia.
      const suelta = await registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [{ medio: "TRANSFERENCIA", monto: "4500" }], claveIdempotencia: clave() });
      assert.equal(suelta.estado, "COMPLETADA");
      assert.equal(await stockDe(centro, esmalte), "7");
    });

    await t.test("validaciones del alta: turno no atendido, productos sin precio o sin stock, sin ítems", async () => {
      const ventas = await db.venta.count({ where: { organizacionId: O } });
      const confirmada = await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: clienta, items: [{ servicioId: semi, profesionalId: ana }], inicio: en("15:00") }, ahora);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, reservaId: confirmada.reservaId, productos: [], cobros: [], claveIdempotencia: clave() }), /turno atendido/);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: removedor, cantidad: "1" }], cobros: [], claveIdempotencia: clave() }), /no tiene precio/);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: algodon, cantidad: "1" }], cobros: [], claveIdempotencia: clave() }), /consumo interno/);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "7.001" }], cobros: [{ medio: "TARJETA_CREDITO", monto: "1" }], claveIdempotencia: clave() }), SinStock);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, productos: [], cobros: [], claveIdempotencia: clave() }), /al menos un producto/);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: "corta" }), /venció/);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], descuento: "4500,01", cobros: [], claveIdempotencia: clave() }), /descuento/);
      assert.equal(await db.venta.count({ where: { organizacionId: O } }), ventas, "nada quedó a medias");
      assert.equal(await stockDe(centro, esmalte), "7");
    });

    await t.test("efectivo sin caja abierta: se rechaza; con otros medios se cobra igual", async () => {
      await cerrarCaja(db, R, O, { cajaId: (await estadoCaja(db, R, O, norte)).abierta!.id, contado: (await estadoCaja(db, R, O, norte)).abierta!.esperado });
      const ventas = await db.venta.count({ where: { organizacionId: O } });
      await assert.rejects(registrarVenta(db, R, O, { sedeId: norte, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [{ medio: "EFECTIVO", monto: "4600" }], claveIdempotencia: clave() }),
        (e: unknown) => e instanceof DatosInvalidos && e.message === SIN_CAJA_EFECTIVO);
      assert.equal(await db.venta.count({ where: { organizacionId: O } }), ventas);
      assert.equal(await stockDe(norte, esmalte), "10", "el stock tampoco se movió");
      const v = await registrarVenta(db, R, O, { sedeId: norte, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [{ medio: "TARJETA_CREDITO", monto: "4600" }], claveIdempotencia: clave() });
      assert.equal(v.estado, "COMPLETADA");
      assert.equal((await db.cobroVenta.findFirstOrThrow({ where: { ventaId: v.id } })).cajaId, null, "sin caja abierta el cobro digital no se asocia a ninguna");
    });

    await t.test("idempotencia: un doble envío del alta o del cobro no duplica", async () => {
      const k = clave();
      const datos = { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: k };
      const primera = await registrarVenta(db, R, O, datos);
      const segunda = await registrarVenta(db, R, O, datos);
      assert.deepEqual([segunda.id, segunda.repetida], [primera.id, true]);
      // Simultáneos desde dos conexiones.
      const k2 = clave();
      const [x, y] = await Promise.all([registrarVenta(db, R, O, { ...datos, claveIdempotencia: k2 }), registrarVenta(db2, R, O, { ...datos, claveIdempotencia: k2 })]);
      assert.equal(x.id, y.id);
      assert.equal(await db.venta.count({ where: { claveIdempotencia: k2 } }), 1);
      assert.equal(await stockDe(centro, esmalte), "5", "dos ventas, no tres");
      await assert.rejects(registrarVenta(db, b.master.id, b.org.id, { ...datos, sedeId: b.centro.id }), AccesoDenegado, "la clave es por organización y el producto es ajeno");
      const kc = clave();
      const c1 = await registrarCobro(db, R, O, primera.id, { medio: "TRANSFERENCIA", monto: "1000", claveIdempotencia: kc });
      const c2 = await registrarCobro(db, R, O, primera.id, { medio: "TRANSFERENCIA", monto: "1000", claveIdempotencia: kc });
      assert.deepEqual([c1.repetido, c2.repetido], [false, true]);
      assert.equal((await obtenerVenta(db, R, O, primera.id)).saldo, "3500.00");
    });

    await t.test("concurrencia: dos cobros simultáneos sobre la misma venta no superan el total", async () => {
      // Venta de un esmalte (4.500) sin cobros.
      const v = await registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: clave() });
      // La primera retiene el lock de la venta mientras «termina»; la segunda (otra conexión) espera y ve saldo 0.
      let conLock!: () => void;
      const primeraTieneLock = new Promise<void>(r => { conLock = r; });
      let segundaTermino = false;
      const primera = db.$transaction(async tx => {
        await registrarCobroEn(tx, R, O, v.id, { medio: "TARJETA_DEBITO", monto: "4500" });
        conLock();
        await tx.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.6)`;
        assert.equal(segundaTermino, false, "la segunda espera el lock: no puede leer el saldo viejo");
      });
      primera.catch(() => conLock());
      await primeraTieneLock;
      const segunda = registrarCobro(db2, R, O, v.id, { medio: "EFECTIVO", monto: "4500", claveIdempotencia: clave() }).finally(() => { segundaTermino = true; });
      const [r1, r2] = await Promise.allSettled([primera, segunda]);
      assert.equal(r1.status, "fulfilled");
      assert.ok(r2.status === "rejected" && r2.reason instanceof DatosInvalidos, String(r2.status === "rejected" ? r2.reason : "la segunda no debía pasar"));
      assert.equal((await obtenerVenta(db, R, O, v.id)).cobrado, "4500.00");

      // Diez cobros de 1.000 en paralelo, repartidos en dos conexiones, sobre 4.500: pasan 4.
      const w = await registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: clave() });
      const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => registrarCobro(i % 2 ? db2 : db, R, O, w.id, { medio: i % 3 ? "TRANSFERENCIA" : "EFECTIVO", monto: "1000", claveIdempotencia: clave() })));
      assert.equal(r.filter(x => x.status === "fulfilled").length, 4);
      assert.ok(r.every(x => x.status === "fulfilled" || x.reason instanceof DatosInvalidos), "solo fallan por saldo");
      const venta = await obtenerVenta(db, R, O, w.id);
      assert.deepEqual([venta.cobrado, venta.saldo, venta.estado], ["4000.00", "500.00", "PENDIENTE"]);
    });

    await t.test("anulación por reverso: cobros revertidos, efectivo devuelto desde la caja, stock repuesto y seña liberada", async () => {
      const ventaPrevia = await obtenerVenta(db, R, O, ventaMixta);
      assert.equal(ventaPrevia.puede.anular, false, "recepción no anula");
      await assert.rejects(anularVenta(db, R, O, ventaMixta, { motivo: "Se cargó mal", reponerStock: true }), AccesoDenegado);
      await assert.rejects(anularVenta(db, ADM, O, ventaMixta, { motivo: "x", reponerStock: true }), DatosInvalidos, "motivo obligatorio");
      const stockAntes = await stockDe(centro, esmalte), cajaAntes = await esperadoCentro();
      const r = await anularVenta(db, ADM, O, ventaMixta, { motivo: "La clienta devolvió los esmaltes", reponerStock: true });
      assert.deepEqual(r, { cobrosRevertidos: 3, productosRepuestos: 1 });
      assert.equal(Number(await stockDe(centro, esmalte)) - Number(stockAntes), 2);
      assert.equal(Number(cajaAntes) - Number(await esperadoCentro()), 10000, "sale de la caja solo el efectivo");
      const anulada = await obtenerVenta(db, ADM, O, ventaMixta);
      assert.equal(anulada.estado, "ANULADA");
      assert.equal(anulada.cobros.filter(c => c.tipo === "REVERSO").length, 3);
      assert.ok(anulada.cobros.filter(c => c.tipo === "COBRO").every(c => c.revertido));
      assert.equal(anulada.anulacion!.motivo, "La clienta devolvió los esmaltes");
      await assert.rejects(anularVenta(db, ADM, O, ventaMixta, { motivo: "Otra vez más", reponerStock: true }), /ya fue anulada/);
      await assert.rejects(registrarCobro(db, R, O, ventaMixta, { medio: "EFECTIVO", monto: "1", claveIdempotencia: clave() }), /anulada/);

      // Anular la venta M03 libera la seña: el turno se vuelve a cobrar con el mismo anticipo, una sola vez.
      await anularVenta(db, ADM, O, ventaM03, { motivo: "Se cobró con el medio equivocado", reponerStock: false });
      const nueva = await registrarVenta(db, R, O, { sedeId: centro, reservaId: reservaM03, productos: [], cobros: [{ medio: "TARJETA_CREDITO", monto: "21000" }], claveIdempotencia: clave() });
      const v = await obtenerVenta(db, R, O, nueva.id);
      assert.deepEqual([v.estado, v.anticipo, v.cobrado], ["COMPLETADA", "9000.00", "21000.00"]);
      assert.equal(await db.venta.count({ where: { pagoAnticipoId: pagoM03, estado: { not: "ANULADA" } } }), 1);
    });

    await t.test("gastos en efectivo: egreso de la caja abierta y contra-movimiento al anular", async () => {
      const categoria = (await crearCategoriaGasto(db, M, O, { nombre: "Limpieza", sedeId: null })).id;
      const base = { sedeId: centro, categoriaId: categoria, fecha: aLocal(new Date(), TZ).fecha, descripcion: "Artículos de limpieza" };
      const antes = await esperadoCentro();
      const g = await registrarGasto(db, ADM, O, { ...base, monto: "1500", medioPago: "EFECTIVO" });
      assert.equal(g.egresoCaja, true);
      assert.equal(Number(antes) - Number(await esperadoCentro()), 1500);
      assert.equal((await registrarGasto(db, ADM, O, { ...base, monto: "800", medioPago: "TRANSFERENCIA" })).egresoCaja, false, "una transferencia no toca la caja");
      assert.equal((await registrarGasto(db, ADM, O, { ...base, monto: "700", medioPago: "EFECTIVO", desdeCaja: false })).egresoCaja, false, "pagado desde afuera de la caja");
      await assert.rejects(registrarGasto(db, ADM, O, { ...base, monto: "999999", medioPago: "EFECTIVO", desdeCaja: true }), /efectivo suficiente/);
      await anularGasto(db, ADM, O, g.id, "Se cargó dos veces");
      assert.equal(await esperadoCentro(), antes, "el reverso devuelve el efectivo a la caja");
      const caja = (await estadoCaja(db, ADM, O, centro)).abierta!;
      const egreso = caja.movimientos.find(m => m.tipo === "EGRESO_GASTO")!;
      assert.deepEqual([egreso.gasto, egreso.revertido, egreso.revertible], ["Artículos de limpieza", true, false]);
      await assert.rejects(revertirMovimientoCaja(db, ADM, O, egreso.id, "Desde la caja"), /un gasto desde Gastos/);
      // Sin caja abierta, un gasto en efectivo sin indicar nada no la toca; si se pide que salga de la caja, se rechaza.
      assert.equal((await registrarGasto(db, a.franquiciado.id, O, { ...base, sedeId: norte, monto: "100", medioPago: "EFECTIVO" })).egresoCaja, false);
      await assert.rejects(registrarGasto(db, a.franquiciado.id, O, { ...base, sedeId: norte, monto: "100", medioPago: "EFECTIVO", desdeCaja: true }), /caja de la sede está cerrada/);
    });

    await t.test("cierre con conteo y diferencia; la caja cerrada no se reescribe", async () => {
      const conEfectivo = (await registrarVenta(db, R, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [{ medio: "EFECTIVO", monto: "4500" }], claveIdempotencia: clave() })).id;
      const abierta = (await estadoCaja(db, R, O, centro)).abierta!;
      const esperado = abierta.esperado;
      const contado = (Number(esperado) - 100).toFixed(2);
      await assert.rejects(cerrarCaja(db, b.master.id, b.org.id, { cajaId: abierta.id, contado }), AccesoDenegado, "caja de otra organización");
      await assert.rejects(cerrarCaja(db, R, O, { cajaId: abierta.id, contado: "-1" }), DatosInvalidos);
      const cierre = await cerrarCaja(db, R, O, { cajaId: abierta.id, contado, observaciones: "Faltan $100: se revisa mañana" });
      assert.deepEqual(cierre, { esperado, contado, diferencia: "-100.00" });
      await assert.rejects(cerrarCaja(db, R, O, { cajaId: abierta.id, contado }), /ya está cerrada/);
      const estado = await estadoCaja(db, R, O, centro);
      assert.equal(estado.abierta, null);
      assert.deepEqual([estado.cierres[0]!.id, estado.cierres[0]!.diferencia, estado.cierres[0]!.observaciones], [abierta.id, "-100.00", "Faltan $100: se revisa mañana"]);
      const detalle = await obtenerCaja(db, R, O, abierta.id);
      assert.equal(detalle.estado, "CERRADA");
      assert.ok(detalle.movimientos.length > 5);
      // Con la caja cerrada: ni movimientos manuales ni efectivo; anular una venta con efectivo tampoco.
      await assert.rejects(registrarMovimientoManual(db, R, O, { sedeId: centro, tipo: "ENTRADA", monto: "1", motivo: "Cambio del banco" }), /cerrada/);
      await assert.rejects(anularVenta(db, ADM, O, conEfectivo, { motivo: "Prueba de caja cerrada", reponerStock: false }), /cerrada/);
      // Al reabrir, el reverso cae en la caja nueva y la cerrada no cambia.
      await abrirCaja(db, R, O, { sedeId: centro, montoInicial: "50000" });
      await anularVenta(db, ADM, O, conEfectivo, { motivo: "Se anula con la caja nueva", reponerStock: false });
      assert.equal((await obtenerCaja(db, R, O, abierta.id)).esperado, esperado);
      assert.ok(Number(await esperadoCentro()) < 50000);
    });

    await t.test("acceso cruzado por ID en lectura y escritura", async () => {
      const enNorte = await registrarVenta(db, R, O, { sedeId: norte, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: clave() });
      // Lectura.
      await assert.rejects(obtenerVenta(db, ADM, O, enNorte.id), AccesoDenegado, "admin de Centro lee una venta de Norte");
      await assert.rejects(obtenerVenta(db, b.master.id, b.org.id, enNorte.id), AccesoDenegado, "otra organización");
      await assert.rejects(obtenerVenta(db, a.profesional.id, O, enNorte.id), AccesoDenegado);
      await assert.rejects(obtenerVenta(db, R, O, "no-es-un-id"), AccesoDenegado);
      await assert.rejects(listarVentas(db, ADM, O, { sedeId: norte }), AccesoDenegado);
      await assert.rejects(listarVentas(db, a.franquiciado.id, O, { sedeId: a.sur.id }), AccesoDenegado, "sede de otro franquiciado");
      await assert.rejects(estadoCaja(db, ADM, O, norte), AccesoDenegado);
      await assert.rejects(estadoCaja(db, a.sinRol.id, O, centro), AccesoDenegado);
      const cajaCentro = (await estadoCaja(db, R, O, centro)).abierta!.id;
      await assert.rejects(obtenerCaja(db, b.master.id, b.org.id, cajaCentro), AccesoDenegado);
      await assert.rejects(obtenerCaja(db, a.franquiciado.id, O, (await db.caja.create({ data: { organizacionId: O, sedeId: a.sur.id, estado: "ABIERTA", montoInicial: "0", abiertaPorId: M } })).id), AccesoDenegado);
      assert.equal((await ventasDeReservas(db, a.profesional.id, O, centro, [reservaM03])).size, 0, "sin permiso, la agenda no ve ventas");
      // Escritura.
      await assert.rejects(registrarCobro(db, ADM, O, enNorte.id, { medio: "TRANSFERENCIA", monto: "1", claveIdempotencia: clave() }), AccesoDenegado);
      await assert.rejects(registrarCobro(db, b.master.id, b.org.id, enNorte.id, { medio: "TRANSFERENCIA", monto: "1", claveIdempotencia: clave() }), AccesoDenegado);
      await assert.rejects(anularVenta(db, ADM, O, enNorte.id, { motivo: "Fuera de alcance", reponerStock: true }), AccesoDenegado);
      await assert.rejects(anularVenta(db, b.master.id, b.org.id, enNorte.id, { motivo: "Otra organización", reponerStock: true }), AccesoDenegado);
      await assert.rejects(registrarVenta(db, ADM, O, { sedeId: norte, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: clave() }), AccesoDenegado);
      await assert.rejects(registrarVenta(db, R, O, { sedeId: norte, reservaId: reservaM03, productos: [], cobros: [], claveIdempotencia: clave() }), AccesoDenegado, "reserva de otra sede");
      await assert.rejects(registrarVenta(db, b.master.id, b.org.id, { sedeId: b.centro.id, reservaId: reservaM03, productos: [], cobros: [], claveIdempotencia: clave() }), AccesoDenegado, "reserva de otra organización");
      await assert.rejects(registrarVenta(db, R, O, { sedeId: centro, reservaId: "no-es-un-id", productos: [], cobros: [], claveIdempotencia: clave() }), AccesoDenegado);
      await assert.rejects(registrarVenta(db, a.profesional.id, O, { sedeId: centro, productos: [{ productoId: esmalte, cantidad: "1" }], cobros: [], claveIdempotencia: clave() }), AccesoDenegado);
      await assert.rejects(registrarMovimientoManual(db, ADM, O, { sedeId: norte, tipo: "ENTRADA", monto: "1", motivo: "Fuera de alcance" }), AccesoDenegado);
      await assert.rejects(prepararVenta(db, ADM, O, norte), AccesoDenegado);
      await assert.rejects(prepararVenta(db, R, O, norte, reservaM03), AccesoDenegado, "reserva de otra sede");
    });

    await t.test("la base rechaza ediciones, borrados, cobros de más y cierres incoherentes", async () => {
      const venta = await db.venta.findFirstOrThrow({ where: { organizacionId: O, sedeId: centro, estado: "PENDIENTE" } });
      await assert.rejects(db.venta.update({ where: { id: venta.id }, data: { total: "1" } }), /no se editan/);
      await assert.rejects(db.venta.update({ where: { id: venta.id }, data: { estado: "COMPLETADA", completadaEn: new Date() } }), /no está cobrada/);
      await assert.rejects(db.venta.delete({ where: { id: venta.id } }), /no se borra/);
      await assert.rejects(db.venta.create({ data: { organizacionId: O, sedeId: centro, fecha: new Date(), subtotal: "1", total: "1", estado: "COMPLETADA", completadaEn: new Date(), claveIdempotencia: clave(), registradoPorId: M } }), /nace pendiente/);
      await assert.rejects(db.venta.create({ data: { organizacionId: O, sedeId: centro, fecha: new Date(), subtotal: "1", total: "1", anticipo: "1", pagoAnticipoId: pagoM03, estado: "PENDIENTE", claveIdempotencia: clave(), registradoPorId: M } }), "el anticipo tiene que ser el monto del pago");
      await assert.rejects(db.cobroVenta.create({ data: { organizacionId: O, sedeId: centro, ventaId: venta.id, tipo: "COBRO", medio: "TRANSFERENCIA", monto: venta.total.add(1), registradoPorId: M } }), /supera el saldo/);
      await assert.rejects(db.cobroVenta.create({ data: { organizacionId: O, sedeId: centro, ventaId: venta.id, tipo: "COBRO", medio: "EFECTIVO", monto: "1", registradoPorId: M } }), "efectivo sin caja");
      const cajaId = (await estadoCaja(db, R, O, centro)).abierta!.id;
      await assert.rejects(db.cobroVenta.create({ data: { organizacionId: O, sedeId: centro, ventaId: venta.id, tipo: "COBRO", medio: "EFECTIVO", monto: "1", cajaId, registradoPorId: M } }), /no tiene su movimiento de caja/);
      const cobro = await db.cobroVenta.findFirstOrThrow({ where: { organizacionId: O } });
      await assert.rejects(db.cobroVenta.update({ where: { id: cobro.id }, data: { monto: "1" } }), /solo inserción/);
      await assert.rejects(db.cobroVenta.delete({ where: { id: cobro.id } }), /solo inserción/);
      const item = await db.ventaItem.findFirstOrThrow({ where: { organizacionId: O } });
      await assert.rejects(db.ventaItem.update({ where: { id: item.id }, data: { subtotal: "0" } }), /solo inserción/);
      const mov = await db.movimientoCaja.findFirstOrThrow({ where: { organizacionId: O } });
      await assert.rejects(db.movimientoCaja.update({ where: { id: mov.id }, data: { monto: "1" } }), /solo inserción/);
      await assert.rejects(db.movimientoCaja.create({ data: { organizacionId: O, sedeId: centro, cajaId, tipo: "SALIDA", monto: "-99999999", motivo: "Retiro imposible", registradoPorId: M } }), /efectivo suficiente/);
      await assert.rejects(db.movimientoCaja.create({ data: { organizacionId: O, sedeId: centro, cajaId, tipo: "ENTRADA", monto: "-1", motivo: "Signo al revés", registradoPorId: M } }), "CHECK de signo");
      await assert.rejects(db.caja.create({ data: { organizacionId: O, sedeId: centro, estado: "ABIERTA", montoInicial: "0", abiertaPorId: M } }), "una sola abierta por sede");
      await assert.rejects(db.caja.update({ where: { id: cajaId }, data: { estado: "CERRADA", cerradaPorId: M, cerradaEn: new Date(), esperado: "1", contado: "1", diferencia: "0" } }), /no coincide/);
      const cerrada = (await estadoCaja(db, R, O, centro)).cierres[0]!.id;
      await assert.rejects(db.caja.update({ where: { id: cerrada }, data: { observaciones: "editada" } }), /Solo se cierra una caja abierta/);
      await assert.rejects(db.movimientoCaja.create({ data: { organizacionId: O, sedeId: centro, cajaId: cerrada, tipo: "ENTRADA", monto: "1", motivo: "Caja ya cerrada", registradoPorId: M } }), /no está abierta/);
      await assert.rejects(db.caja.delete({ where: { id: cerrada } }), /no se borra/);
    });

    await t.test("invariantes: esperado = inicial + movimientos; completada = anticipo + cobros", async () => {
      const descuadres = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Caja" c
        WHERE c."organizacionId" = ${O}::uuid AND c.estado = 'CERRADA'
          AND c.esperado <> c."montoInicial" + COALESCE((SELECT sum(monto) FROM "MovimientoCaja" m WHERE m."cajaId" = c.id), 0)`;
      assert.equal(Number(descuadres[0]!.n), 0);
      const ventas = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Venta" v
        WHERE v."organizacionId" = ${O}::uuid AND v.estado = 'COMPLETADA'
          AND v.total <> v.anticipo + COALESCE((SELECT sum(monto) FROM "CobroVenta" c WHERE c."ventaId" = v.id), 0)`;
      assert.equal(Number(ventas[0]!.n), 0);
      const anuladas = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Venta" v
        WHERE v."organizacionId" = ${O}::uuid AND v.estado = 'ANULADA'
          AND COALESCE((SELECT sum(monto) FROM "CobroVenta" c WHERE c."ventaId" = v.id), 0) <> 0`;
      assert.equal(Number(anuladas[0]!.n), 0, "una venta anulada suma cero en cobros");
      const efectivoSinCaja = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "CobroVenta" c WHERE c."organizacionId" = ${O}::uuid AND c.medio = 'EFECTIVO'
          AND NOT EXISTS (SELECT 1 FROM "MovimientoCaja" m WHERE m."cobroId" = c.id AND m.monto = c.monto)`;
      assert.equal(Number(efectivoSinCaja[0]!.n), 0, "todo efectivo cobrado está en una caja");
      const digitalesEnCaja = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "MovimientoCaja" m JOIN "CobroVenta" c ON c.id = m."cobroId" WHERE m."organizacionId" = ${O}::uuid AND c.medio <> 'EFECTIVO'`;
      assert.equal(Number(digitalesEnCaja[0]!.n), 0, "ningún cobro digital mueve el efectivo");
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
