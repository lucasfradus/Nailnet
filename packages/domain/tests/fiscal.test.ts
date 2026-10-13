import { test } from "node:test";
import assert from "node:assert/strict";
import { formatearCuit, normalizarCuit, puntoVentaValido } from "../src/fiscal.ts";

test("CUIT: normaliza separadores y valida el dígito verificador", () => {
  assert.equal(normalizarCuit("20-00000000-1"), "20000000001");
  assert.equal(normalizarCuit("20000000002"), null, "verificador incorrecto");
  assert.equal(normalizarCuit("2000000000"), null, "menos de 11 dígitos");
  assert.equal(normalizarCuit("20a00000001"), null);
  assert.equal(normalizarCuit("30500010912"), "30500010912");
  assert.equal(formatearCuit("30500010912"), "30-50001091-2");
});

test("punto de venta entre 1 y 99999", () => {
  assert.equal(puntoVentaValido(1), true);
  assert.equal(puntoVentaValido(99999), true);
  assert.equal(puntoVentaValido(0), false);
  assert.equal(puntoVentaValido(100000), false);
  assert.equal(puntoVentaValido(2.5), false);
});
