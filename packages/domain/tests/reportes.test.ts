import { test } from "node:test";
import assert from "node:assert/strict";
import { tienePermiso, type Asignacion } from "../src/access.ts";
import { aCsv, celdaCsv, porcentaje, prorratearDescuento } from "../src/reportes.ts";

test("descuento prorrateado por línea: proporcional y la suma da exacta", () => {
  assert.deepEqual(prorratearDescuento([3000000n, 1000000n], 400000n), [300000n, 100000n], "$30.000 + $10.000 con $4.000 de descuento");
  assert.deepEqual(prorratearDescuento([100n, 100n, 100n], 100n), [34n, 33n, 33n], "el centavo que sobra va a la primera");
  assert.deepEqual(prorratearDescuento([100n, 200n], 1n), [0n, 1n], "el resto va a la de mayor resto");
  assert.deepEqual(prorratearDescuento([5000n, 0n], 0n), [0n, 0n]);
  assert.deepEqual(prorratearDescuento([0n, 0n], 0n), [0n, 0n], "venta en cero");
  for (const [subs, d] of [[[1n, 2n, 3n, 7n], 5n], [[999n, 1n], 500n], [[333n, 333n, 334n], 1000n]] as const) {
    assert.equal(prorratearDescuento(subs, d).reduce((a, b) => a + b, 0n), d);
  }
});

test("porcentaje: un decimal y sin denominador no es 0 %", () => {
  assert.equal(porcentaje(1, 3), 33.3);
  assert.equal(porcentaje(2, 3), 66.7);
  assert.equal(porcentaje(0, 5), 0);
  assert.equal(porcentaje(0, 0), null);
});

test("CSV para Excel argentino: «;», coma decimal, BOM y sin fórmulas", () => {
  assert.equal(celdaCsv(123450n), "1234,50");
  assert.equal(celdaCsv(-5n), "-0,05", "un reverso no se neutraliza: es un número");
  assert.equal(celdaCsv(33.3), "33,3");
  assert.equal(celdaCsv(null), "");
  assert.equal(celdaCsv('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`, "fórmula neutralizada y entrecomillada");
  for (const t of ["+54 11", "-1", "@SUMA", "\tx"]) assert.ok(celdaCsv(t).replace(/^"/, "").startsWith("'"), t);
  assert.equal(celdaCsv("Pérez; Ana"), "\"Pérez; Ana\"");
  assert.equal(aCsv(["a", "b"], [["x", 100n]]), "﻿a;b\r\nx;1,00\r\n");
});

test("reportes: master, franquiciado y admin de sede; recepción y profesional no", () => {
  const a = (rol: Asignacion["rol"], alcance: Asignacion["alcance"], extra: Partial<Asignacion> = {}): Asignacion => ({ rol, alcance, franquiciadoId: null, sedeId: null, ...extra });
  assert.ok(tienePermiso(a("MASTER_FRANQUICIADOR", "ORGANIZACION"), "reporte:leer"));
  assert.ok(tienePermiso(a("FRANQUICIADO", "FRANQUICIADO", { franquiciadoId: "f" }), "reporte:leer"));
  assert.ok(tienePermiso(a("ADMIN_SEDE", "SEDE", { sedeId: "s" }), "reporte:leer"));
  assert.ok(!tienePermiso(a("RECEPCIONISTA", "SEDE", { sedeId: "s" }), "reporte:leer"));
  assert.ok(!tienePermiso(a("PROFESIONAL", "PROPIO"), "reporte:leer"));
});
