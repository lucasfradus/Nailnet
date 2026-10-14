import { test } from "node:test";
import assert from "node:assert/strict";
import { cubreSede, tienePermiso, type Asignacion } from "../src/access.ts";
import { dejaNegativo, diferenciaArqueo, efectivoEsperado, importeNoNegativo, resumirCaja, revertibleDesdeCaja, signoValidoCaja, validarManual, validarObservacionesCierre } from "../src/caja.ts";
import { calcularVenta, claveValida, descuentoDe, esEfectivo, estadoSegunCobros, formatoPesos, precioCobrado, resumirCobros, saldoVenta, validarCobro, validarCobros, validarMotivo } from "../src/ventas.ts";

test("comanda: precio cobrado editable, propuesto el de lista", () => {
  assert.deepEqual(precioCobrado("", 3_000_000n), { precio: 3_000_000n }, "vacío = lista");
  assert.deepEqual(precioCobrado(" 27000,50 ", 3_000_000n), { precio: 2_700_050n });
  assert.deepEqual(precioCobrado("0", 3_000_000n), { precio: 0n }, "cortesía");
  assert.ok("error" in precioCobrado("", null), "sin lista hay que indicar el precio");
  assert.deepEqual(precioCobrado("15000", null), { precio: 1_500_000n });
  assert.ok("error" in precioCobrado("-1", 100n));
  assert.ok("error" in precioCobrado("1,234", 100n));
});

test("cierre: con diferencia la observación es obligatoria", () => {
  assert.equal(validarObservacionesCierre(0n, ""), null);
  assert.match(validarObservacionesCierre(-10_000n, "")!, /explicala/);
  assert.match(validarObservacionesCierre(500n, "ok")!, /explicala/);
  assert.equal(validarObservacionesCierre(-10_000n, "Faltan $100 del cambio"), null);
  assert.ok(validarObservacionesCierre(0n, "x".repeat(501)));
});

const servicio = (pesos: bigint) => ({ cantidad: 1000n, precioUnitario: pesos * 100n });

test("M03: servicio de $30.000 con seña de $9.000 deja $21.000 a cobrar, sin doble ingreso", () => {
  const r = calcularVenta([servicio(30_000n)], 0n, 900_000n);
  assert.ok(!("error" in r));
  assert.deepEqual(r, { subtotal: 3_000_000n, descuento: 0n, total: 3_000_000n, anticipo: 900_000n, aCobrar: 2_100_000n });
  // La venta vale 30.000 (no 39.000): la seña es un cobro de la venta, no un ingreso aparte.
  assert.equal(saldoVenta(r.total, r.anticipo, 0n), 2_100_000n);
  assert.equal(estadoSegunCobros(r.total, r.anticipo, 2_100_000n), "COMPLETADA");
  assert.equal(estadoSegunCobros(r.total, r.anticipo, 2_099_999n), "PENDIENTE");
});

test("venta mixta: servicios y productos con cantidades fraccionarias, descuento al centavo", () => {
  // Servicio 30.000 + 2 esmaltes de 4.500 + 12,5 ml a $3,33 (41,625 → 41,63) − 1.000 de descuento.
  const r = calcularVenta([servicio(30_000n), { cantidad: 2000n, precioUnitario: 450_000n }, { cantidad: 12_500n, precioUnitario: 333n }], 100_000n, 900_000n);
  assert.ok(!("error" in r));
  assert.equal(r.subtotal, 3_000_000n + 900_000n + 4163n);
  assert.equal(r.total, r.subtotal - 100_000n);
  assert.equal(r.aCobrar, r.total - 900_000n);
});

test("venta inválida: sin ítems, descuento mayor al subtotal, seña mayor al total", () => {
  assert.ok("error" in calcularVenta([], 0n, 0n));
  assert.ok("error" in calcularVenta([servicio(100n)], 10_001n, 0n));
  assert.ok("error" in calcularVenta([servicio(100n)], -1n, 0n));
  assert.ok("error" in calcularVenta([servicio(10_000n)], 200_000n, 900_000n), "el descuento no puede dejar el total por debajo de la seña");
  assert.ok("error" in calcularVenta([{ cantidad: 0n, precioUnitario: 1n }], 0n, 0n));
  assert.ok("error" in calcularVenta(Array.from({ length: 51 }, () => servicio(1n)), 0n, 0n));
  assert.ok(!("error" in calcularVenta([servicio(10_000n)], 10_000_00n, 0n)), "descuento total: venta en cero");
});

test("cobros: medios, montos exactos y nunca de más", () => {
  assert.deepEqual(validarCobro({ medio: "EFECTIVO", monto: "21000", referencia: "  " }), { cobro: { medio: "EFECTIVO", monto: 2_100_000n, referencia: null } });
  assert.ok("error" in validarCobro({ medio: "CHEQUE", monto: "1" }));
  for (const monto of ["0", "-1", "1,234", "abc", ""]) assert.ok("error" in validarCobro({ medio: "EFECTIVO", monto }), monto);
  assert.ok("error" in validarCobro({ medio: "TRANSFERENCIA", monto: "1", referencia: "x".repeat(121) }));
  const mixto = validarCobros([{ medio: "EFECTIVO", monto: "10000" }, { medio: "TARJETA_DEBITO", monto: "11000,00" }], 2_100_000n);
  assert.ok("cobros" in mixto && mixto.total === 2_100_000n);
  const deMas = validarCobros([{ medio: "EFECTIVO", monto: "10000" }, { medio: "TARJETA_DEBITO", monto: "11000,01" }], 2_100_000n);
  assert.ok("error" in deMas && /\$ 21\.000,00/.test(deMas.error));
  assert.ok("error" in validarCobros(Array.from({ length: 6 }, () => ({ medio: "EFECTIVO", monto: "1" })), 1_000_000n));
  assert.equal(saldoVenta(100n, 0n, 150n), 0n, "nunca negativo");
});

test("solo el efectivo es de la caja; los digitales se resumen aparte", () => {
  assert.equal(esEfectivo("EFECTIVO"), true);
  for (const m of ["TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADO_PAGO", "OTRO"] as const) assert.equal(esEfectivo(m), false);
  const r = resumirCobros([{ medio: "EFECTIVO", monto: 1000n }, { medio: "MERCADO_PAGO", monto: 500n }, { medio: "EFECTIVO", monto: -1000n }, { medio: "TARJETA_CREDITO", monto: 700n }]);
  assert.deepEqual([r.efectivo, r.otros, r.total], [0n, 1200n, 1200n]);
  assert.deepEqual([...r.porMedio], [["MERCADO_PAGO", 500n], ["TARJETA_CREDITO", 700n]], "el efectivo revertido no aparece");
});

test("caja: signos, esperado, diferencia y efectivo negativo", () => {
  assert.equal(signoValidoCaja("INGRESO_COBRO", 1n), true);
  assert.equal(signoValidoCaja("INGRESO_COBRO", -1n), false);
  assert.equal(signoValidoCaja("EGRESO_GASTO", -1n), true);
  assert.equal(signoValidoCaja("SALIDA", 1n), false);
  assert.equal(signoValidoCaja("REVERSO", -5n), true);
  assert.equal(signoValidoCaja("ENTRADA", 0n), false);
  const movimientos = [{ tipo: "INGRESO_COBRO" as const, monto: 2_100_000n }, { tipo: "EGRESO_GASTO" as const, monto: -350_000n }, { tipo: "SALIDA" as const, monto: -1_000_000n }, { tipo: "REVERSO" as const, monto: 1_000_000n }];
  assert.equal(efectivoEsperado(500_000n, movimientos), 2_250_000n);
  const r = resumirCaja(500_000n, movimientos);
  assert.deepEqual([r.esperado, r.porTipo.get("INGRESO_COBRO"), r.porTipo.get("ENTRADA")], [2_250_000n, 2_100_000n, 0n]);
  assert.equal(diferenciaArqueo(2_240_000n, 2_250_000n), -10_000n, "faltante");
  assert.equal(diferenciaArqueo(2_250_000n, 2_250_000n), 0n);
  assert.equal(dejaNegativo(1000n, -1001n), true);
  assert.equal(dejaNegativo(1000n, -1000n), false);
  assert.equal(revertibleDesdeCaja("ENTRADA"), true);
  assert.equal(revertibleDesdeCaja("INGRESO_COBRO"), false, "un cobro se anula desde la venta");
  assert.equal(revertibleDesdeCaja("REVERSO"), false);
});

test("caja: importes de apertura y movimientos manuales", () => {
  assert.equal(importeNoNegativo("0"), 0n);
  assert.equal(importeNoNegativo("5000,5"), 500_050n);
  assert.equal(importeNoNegativo(""), null);
  assert.equal(importeNoNegativo("-1"), null);
  assert.deepEqual(validarManual("SALIDA", "1000", "  Retiro  para depósito "), { tipo: "SALIDA", monto: -100_000n, motivo: "Retiro para depósito" });
  assert.ok("error" in validarManual("SALIDA", "1000", "x"));
  assert.ok("error" in validarManual("INGRESO_COBRO", "1000", "Motivo largo"));
  assert.ok("error" in validarManual("ENTRADA", "0", "Motivo largo"));
});

test("textos auxiliares: descuento, motivo, clave y formato", () => {
  assert.equal(descuentoDe(""), 0n);
  assert.equal(descuentoDe("1500,5"), 150_050n);
  assert.equal(descuentoDe("abc"), null);
  assert.ok("error" in validarMotivo("mal"));
  assert.equal(claveValida(crypto.randomUUID()), true);
  assert.equal(claveValida("corta"), false);
  assert.equal(claveValida("con espacios y mas de dieciseis"), false);
  assert.equal(formatoPesos(123_456_789n), "$ 1.234.567,89");
  assert.equal(formatoPesos(-5n), "−$ 0,05");
});

test("permisos de ventas y caja por rol", () => {
  const sedes: Record<string, string> = { centro: "franA", sur: "franB" };
  const de = (id: string) => sedes[id];
  const master: Asignacion = { rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION", franquiciadoId: null, sedeId: null };
  const franA: Asignacion = { rol: "FRANQUICIADO", alcance: "FRANQUICIADO", franquiciadoId: "franA", sedeId: null };
  const admin: Asignacion = { rol: "ADMIN_SEDE", alcance: "SEDE", franquiciadoId: null, sedeId: "centro" };
  const recepcion: Asignacion = { rol: "RECEPCIONISTA", alcance: "SEDE", franquiciadoId: null, sedeId: "centro" };
  const profesional: Asignacion = { rol: "PROFESIONAL", alcance: "PROPIO", franquiciadoId: null, sedeId: null };
  for (const a of [master, franA, admin]) for (const p of ["venta:leer", "venta:registrar", "venta:anular", "caja:leer", "caja:operar"] as const) assert.equal(tienePermiso(a, p), true, `${a.rol} ${p}`);
  assert.deepEqual((["venta:leer", "venta:registrar", "venta:anular", "caja:leer", "caja:operar"] as const).map(p => tienePermiso(recepcion, p)), [true, true, true, true, true], "recepción también anula (Sicurella, 2026-10-14)");
  assert.equal(tienePermiso(profesional, "venta:leer"), false);
  assert.equal(tienePermiso(profesional, "caja:leer"), false);
  assert.equal(tienePermiso({ ...recepcion, alcance: "ORGANIZACION" }, "venta:leer"), false, "forma inválida");
  assert.deepEqual((["gasto:leer", "gasto:registrar_caja", "gasto:registrar", "gasto:anular", "gasto:categorias"] as const).map(p => tienePermiso(recepcion, p)), [true, true, false, false, false], "recepción: gastos de la caja, sin anular");
  assert.equal(cubreSede(franA, "sur", de), false);
});
