import assert from "node:assert/strict";
import { test } from "node:test";
import { problemaSlug, slugDesdeNombre, slugLibre } from "../src/sedes.ts";

test("el slug sale del nombre sin acentos ni símbolos", () => {
  assert.equal(slugDesdeNombre("Lomada"), "lomada");
  assert.equal(slugDesdeNombre("  Núñez · Centro  "), "nunez-centro");
  assert.equal(slugDesdeNombre("Sede #1 (Pilar)"), "sede-1-pilar");
  assert.equal(slugDesdeNombre("¡¡!!"), "");
  assert.ok(slugDesdeNombre("a".repeat(80)).length <= 60);
});

test("valida formato y rutas reservadas", () => {
  assert.equal(problemaSlug("lomada-sur"), null);
  assert.match(problemaSlug("")!, /vacía/);
  assert.match(problemaSlug("Lomada")!, /minúsculas/);
  assert.match(problemaSlug("lomada--sur")!, /minúsculas/);
  assert.match(problemaSlug("-lomada")!, /minúsculas/);
  assert.match(problemaSlug("mis-turnos")!, /reservada/);
});

test("busca el primer slug libre", () => {
  assert.equal(slugLibre("Lomada", new Set()), "lomada");
  assert.equal(slugLibre("Lomada", new Set(["lomada", "lomada-2"])), "lomada-3");
  assert.equal(slugLibre("Assets", new Set()), "assets-2");
  assert.equal(slugLibre("???", new Set()), "sede");
  const largo = slugLibre("b".repeat(70), new Set(["b".repeat(60)]));
  assert.equal(largo, `${"b".repeat(58)}-2`);
});
