import { test } from "node:test";
import assert from "node:assert/strict";
import { tienePermiso, type Asignacion } from "../src/access.ts";
import { StockInsuficiente, aMilesimas, aplicarDeltas, cantidadTexto, claveSaldo, decimal, deltaAjuste, desdeDecimal, reversible, signoValido, subtotalCentavos, validarCantidad, validarMotivo } from "../src/stock.ts";

test("cantidades fraccionarias exactas en milésimas, sin Number", () => {
  assert.equal(aMilesimas("1,5"), 1500n);
  assert.equal(aMilesimas("0.001"), 1n);
  assert.equal(aMilesimas(" 250 "), 250000n);
  assert.equal(aMilesimas("1.2345"), null, "más de 3 decimales");
  assert.equal(aMilesimas("-1"), null);
  assert.equal(aMilesimas("1e3"), null);
  assert.equal(aMilesimas("1.000.000"), null, "sin separador de miles");
  assert.equal(cantidadTexto(1500n), "1.5");
  assert.equal(cantidadTexto(-250n), "-0.25");
  assert.equal(cantidadTexto(3000n), "3");
  assert.equal(decimal(1500n), "1.500");
  assert.equal(decimal(-1n), "-0.001");
  assert.equal(desdeDecimal("12.345"), 12345n);
  assert.equal(desdeDecimal("-0.500"), -500n);
  assert.throws(() => desdeDecimal("1e3"));
  // 0,1 + 0,2 en punto flotante no da 0,3; en milésimas sí.
  assert.equal(aMilesimas("0.1")! + aMilesimas("0.2")!, aMilesimas("0.3"));
});

test("validación de cantidad y motivo", () => {
  assert.equal(validarCantidad(1n), null);
  assert.match(validarCantidad(0n)!, /mayor a cero/);
  assert.match(validarCantidad(null)!, /inválida/);
  assert.match(validarCantidad(1_000_000_000_000n)!, /grande/);
  assert.equal(validarMotivo("  ", false), null);
  assert.match(validarMotivo("", true)!, /motivo/);
  assert.match(validarMotivo("x".repeat(301), false)!, /300/);
});

test("signo de cada tipo de movimiento y qué se revierte", () => {
  assert.ok(signoValido("COMPRA", 1n));
  assert.ok(!signoValido("COMPRA", -1n));
  assert.ok(signoValido("CONSUMO_INTERNO", -1n));
  assert.ok(!signoValido("VENTA", 1n));
  assert.ok(signoValido("TRANSFERENCIA_SALIDA", -5n));
  assert.ok(signoValido("TRANSFERENCIA_ENTRADA", 5n));
  assert.ok(signoValido("AJUSTE", -1n) && signoValido("AJUSTE", 1n));
  assert.ok(!signoValido("AJUSTE", 0n), "nunca un movimiento en cero");
  assert.deepEqual(["COMPRA", "CONSUMO_INTERNO", "AJUSTE", "VENTA", "TRANSFERENCIA_SALIDA", "REVERSO"].map(t => reversible(t as never)), [true, true, true, false, false, false]);
});

test("aplicar movimientos: todo o nada, nunca negativo, acumula el mismo producto", () => {
  const saldos = new Map([[claveSaldo("s1", "p1"), 1500n]]);
  const r = aplicarDeltas(saldos, [{ sedeId: "s1", productoId: "p1", cantidad: -1000n }, { sedeId: "s1", productoId: "p1", cantidad: -500n }]);
  assert.deepEqual(r.resultantes, [500n, 0n]);
  assert.equal(saldos.get(claveSaldo("s1", "p1")), 1500n, "no muta la entrada");
  assert.throws(() => aplicarDeltas(saldos, [{ sedeId: "s1", productoId: "p1", cantidad: -1000n }, { sedeId: "s1", productoId: "p1", cantidad: -501n }]), (e: unknown) => e instanceof StockInsuficiente && e.disponible === 500n && e.pedido === 501n);
  assert.throws(() => aplicarDeltas(saldos, [{ sedeId: "s2", productoId: "p1", cantidad: -1n }]), StockInsuficiente, "sin saldo previo es cero");
  assert.deepEqual(aplicarDeltas(new Map(), [{ sedeId: "s2", productoId: "p1", cantidad: 250n }]).resultantes, [250n]);
});

test("ajuste por conteo y subtotal de compra al centavo", () => {
  assert.equal(deltaAjuste(10_000n, 9_250n), -750n);
  assert.equal(deltaAjuste(0n, 2_000n), 2_000n);
  assert.equal(subtotalCentavos(2_000n, 150_000n), 300_000n, "2 × $1.500");
  assert.equal(subtotalCentavos(1_500n, 333n), 500n, "1,5 × $3,33 = $4,995 → $5,00");
  assert.equal(subtotalCentavos(250n, 1_001n), 250n, "0,25 × $10,01 = $2,5025 → $2,50");
});

test("permisos de stock por rol", () => {
  const a = (rol: Asignacion["rol"], alcance: Asignacion["alcance"], extra: Partial<Asignacion> = {}): Asignacion => ({ rol, alcance, franquiciadoId: null, sedeId: null, ...extra });
  const master = a("MASTER_FRANQUICIADOR", "ORGANIZACION");
  const fran = a("FRANQUICIADO", "FRANQUICIADO", { franquiciadoId: "f" });
  const admin = a("ADMIN_SEDE", "SEDE", { sedeId: "s" });
  const recepcion = a("RECEPCIONISTA", "SEDE", { sedeId: "s" });
  const profesional = a("PROFESIONAL", "PROPIO");
  assert.deepEqual([master, fran, admin, recepcion, profesional].map(x => tienePermiso(x, "producto:administrar")), [true, false, false, false, false]);
  assert.deepEqual([master, fran, admin, recepcion, profesional].map(x => tienePermiso(x, "stock:gestionar")), [true, true, true, false, false]);
  assert.deepEqual([master, fran, admin, recepcion, profesional].map(x => tienePermiso(x, "stock:consumir")), [true, true, true, true, false]);
  assert.deepEqual([master, fran, admin, recepcion, profesional].map(x => tienePermiso(x, "stock:leer")), [true, true, true, true, false]);
});
