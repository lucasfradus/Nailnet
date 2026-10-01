import { test } from "node:test";
import assert from "node:assert/strict";
import { aCentavos, importe, montoSena, servicioEfectivo, validarDuracion, validarSena } from "../src/catalogo.ts";

test("importes en centavos, sin Number", () => {
  assert.equal(aCentavos("30000"), 3000000n);
  assert.equal(aCentavos("8750,5"), 875050n);
  assert.equal(aCentavos("0.99"), 99n);
  assert.equal(aCentavos("1.999"), null);
  assert.equal(aCentavos("-5"), null);
  assert.equal(aCentavos("1e3"), null);
  assert.equal(importe(3000000n), "30000.00");
  assert.equal(importe(5n), "0.05");
});
test("seña: ejemplo del plan $30.000 con seña $9.000; porcentaje redondea al centavo", () => {
  assert.equal(montoSena(3000000n, { tipo: "FIJA", valor: "9000" }), 900000n);
  assert.equal(montoSena(3000000n, { tipo: "PORCENTAJE", valor: "30" }), 900000n);
  assert.equal(montoSena(333n, { tipo: "PORCENTAJE", valor: "50" }), 167n);
  assert.equal(montoSena(3000000n, { tipo: "NINGUNA", valor: null }), 0n);
  assert.equal(montoSena(3000000n, null), null, "sin definir");
  assert.ok(validarSena({ tipo: "FIJA", valor: "40000" }, 3000000n), "no supera el precio");
  assert.ok(validarSena({ tipo: "PORCENTAJE", valor: "0" }, null));
  assert.ok(validarSena({ tipo: "PORCENTAJE", valor: "12.5" }, null));
  assert.equal(validarSena({ tipo: "PORCENTAJE", valor: "100" }, null), null);
});
test("duración en múltiplos de 5", () => {
  assert.equal(validarDuracion(50), null);
  assert.ok(validarDuracion(52));
  assert.ok(validarDuracion(0));
});
test("condiciones efectivas: la sede define precio y puede ajustar duración y seña", () => {
  const base = { duracionMinutos: 50, bufferAntesMinutos: 0, bufferDespuesMinutos: 10, sena: { tipo: "PORCENTAJE" as const, valor: "30" }, activo: true };
  const e = servicioEfectivo(base, { habilitado: true, precio: "30000.00", duracionMinutos: 60, sena: null, reservableOnline: true });
  assert.equal(e.duracionMinutos, 60); assert.equal(e.sena, "9000.00"); assert.equal(e.origenSena, "SERVICIO"); assert.equal(e.reservableOnline, true);
  const sinSena = servicioEfectivo({ ...base, sena: null }, { habilitado: true, precio: "30000.00", duracionMinutos: null, sena: null, reservableOnline: true });
  assert.equal(sinSena.reservableOnline, false); assert.ok(sinSena.motivosSinOnline.some(m => m.includes("D3")));
  assert.equal(servicioEfectivo(base, null).habilitado, false);
  const excedida = servicioEfectivo({ ...base, sena: { tipo: "FIJA", valor: "9000" } }, { habilitado: true, precio: "5000", duracionMinutos: null, sena: null, reservableOnline: true });
  assert.equal(excedida.sena, null); assert.equal(excedida.reservableOnline, false);
  assert.equal(servicioEfectivo({ ...base, activo: false }, { habilitado: true, precio: "1", duracionMinutos: null, sena: null, reservableOnline: true }).habilitado, false);
});
