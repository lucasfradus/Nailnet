import { test } from "node:test";
import assert from "node:assert/strict";
import { aLocal, aUtc, diaSemana, formatearRangos, parsearRangos, solapan, validarFecha, vigenciasSeCruzan } from "../src/agenda.ts";

test("rangos horarios: formato, orden, múltiplos de 5 y sin superposición", () => {
  const r = parsearRangos("14:00-20:00, 09:00-13:00");
  assert.ok("rangos" in r);
  assert.deepEqual(r.rangos, [{ inicio: 540, fin: 780 }, { inicio: 840, fin: 1200 }]);
  assert.equal(formatearRangos(r.rangos), "09:00-13:00, 14:00-20:00");
  assert.deepEqual(parsearRangos(""), { rangos: [] });
  assert.ok("error" in parsearRangos("09:00-13:00, 12:00-15:00"));
  assert.ok("error" in parsearRangos("13:00-09:00"));
  assert.ok("error" in parsearRangos("09:02-10:00"));
  assert.ok("error" in parsearRangos("9-10"));
  assert.ok("rangos" in parsearRangos("00:00-24:00"));
});
test("intervalos semiabiertos: turnos contiguos no se solapan", () => {
  assert.equal(solapan({ inicio: 540, fin: 590 }, { inicio: 590, fin: 640 }), false);
  assert.equal(solapan({ inicio: 540, fin: 600 }, { inicio: 590, fin: 640 }), true);
});
test("vigencias y fechas", () => {
  assert.equal(vigenciasSeCruzan(null, null, "2026-10-01", null), true);
  assert.equal(vigenciasSeCruzan("2026-01-01", "2026-09-30", "2026-10-01", null), false);
  assert.equal(vigenciasSeCruzan("2026-01-01", "2026-10-01", "2026-10-01", null), true);
  assert.equal(validarFecha("2026-02-30"), false);
  assert.equal(validarFecha("2026-10-12"), true);
  assert.equal(diaSemana("2026-10-12"), 1, "lunes");
});
test("hora local ↔ UTC por zona, incluido cambio de horario", () => {
  const ba = "America/Argentina/Buenos_Aires";
  assert.equal(aUtc("2026-10-12", 9 * 60, ba).toISOString(), "2026-10-12T12:00:00.000Z");
  assert.deepEqual(aLocal(new Date("2026-10-12T12:00:00Z"), ba), { fecha: "2026-10-12", minutos: 540 });
  // Santiago de Chile cambia a horario de verano el 6/9/2026 a las 00:00 (-04 → -03).
  const scl = "America/Santiago";
  assert.equal(aUtc("2026-09-05", 600, scl).toISOString(), "2026-09-05T14:00:00.000Z");
  assert.equal(aUtc("2026-09-07", 600, scl).toISOString(), "2026-09-07T13:00:00.000Z");
  for (const m of [0, 30, 59, 60, 600]) { const u = aUtc("2026-09-06", m, scl); assert.equal(aLocal(u, scl).fecha, "2026-09-06"); }
});
