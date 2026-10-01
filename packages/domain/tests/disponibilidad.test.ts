import { test } from "node:test";
import assert from "node:assert/strict";
import { aUtc } from "../src/agenda.ts";
import { aIntervalos, aperturaDelDia, asignarEn, buscarTurnos, jornadaDelDia, type Consulta, type DatosProfesional, type ItemPedido } from "../src/disponibilidad.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13"; // martes
const h = (hhmm: string) => { const [a, b] = hhmm.split(":").map(Number); return aUtc(FECHA, a! * 60 + b!, TZ).getTime(); };
const iv = (desde: string, hasta: string) => ({ desde: h(desde), hasta: h(hasta) });
const hora = (ms: number) => new Date(ms).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const item = (extra: Partial<ItemPedido> = {}): ItemPedido => ({ servicioId: "s1", duracionMinutos: 50, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, requisitos: [], candidatos: ["ana"], ...extra });
const pro = (extra: Partial<DatosProfesional> = {}): DatosProfesional => ({ jornada: [iv("09:00", "13:00")], ocupado: [], cargaMinutos: 0, ...extra });
const consulta = (extra: Partial<Consulta> = {}): Consulta => ({
  fecha: FECHA, tz: TZ, pasoMinutos: 60, apertura: [iv("09:00", "20:00")], items: [item()],
  profesionales: new Map([["ana", pro()]]), recursos: [], desdeMs: 0, hastaMs: null, ...extra,
});
const inicios = (c: Consulta) => buscarTurnos(c).map(t => hora(t.inicio));

test("apertura: fecha especial de sede > feriado de organización > semanal", () => {
  const semanal = [{ diaSemana: 2, inicioMinutos: 540, finMinutos: 1200, vigenteDesde: null, vigenteHasta: null }];
  assert.deepEqual(aperturaDelDia(semanal, [], [], FECHA), [{ inicio: 540, fin: 1200 }]);
  assert.deepEqual(aperturaDelDia(semanal, [], [{ cerrado: true, inicioMinutos: null, finMinutos: null }], FECHA), []);
  assert.deepEqual(aperturaDelDia(semanal, [{ cerrado: false, inicioMinutos: 600, finMinutos: 840 }], [{ cerrado: true, inicioMinutos: null, finMinutos: null }], FECHA), [{ inicio: 600, fin: 840 }]);
  assert.deepEqual(jornadaDelDia([{ ...semanal[0]!, vigenteHasta: "2099-01-01" }], FECHA), [], "vigencia vencida");
  assert.deepEqual(aIntervalos([{ inicio: 540, fin: 600 }], FECHA, TZ), [iv("09:00", "10:00")]);
});

test("grilla configurable y servicio dentro de jornada y apertura", () => {
  assert.deepEqual(inicios(consulta()), ["09:00", "10:00", "11:00", "12:00"]);
  assert.deepEqual(inicios(consulta({ pasoMinutos: 30 })), ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
  assert.deepEqual(inicios(consulta({ apertura: [iv("10:00", "12:00")] })), ["10:00", "11:00"], "sede abre más tarde");
  assert.deepEqual(buscarTurnos(consulta({ pasoMinutos: 0 })), [], "sin paso definido no hay turnos (D17)");
});

test("pausas, ocupaciones en cualquier sede y bloqueos", () => {
  const conPausa = consulta({ profesionales: new Map([["ana", pro({ jornada: [iv("09:00", "11:00"), iv("12:00", "13:00")] })]]) });
  assert.deepEqual(inicios(conPausa), ["09:00", "10:00", "12:00"]);
  const ocupada = consulta({ profesionales: new Map([["ana", pro({ ocupado: [iv("10:00", "10:50"), iv("11:30", "12:10")] })]]) });
  assert.deepEqual(inicios(ocupada), ["09:00"], "10:50 libre pero la grilla es horaria");
  assert.deepEqual(inicios({ ...ocupada, pasoMinutos: 10 }).slice(0, 3), ["09:00", "09:10", "12:10"], "10:50 terminaría 11:40 y choca con 11:30");
});

test("tiempos de preparación ocupan al profesional y deben caber en su jornada", () => {
  const c = consulta({ items: [item({ bufferAntesMinutos: 10, bufferDespuesMinutos: 10 })] });
  assert.deepEqual(inicios(c), ["10:00", "11:00", "12:00"], "09:00 necesitaría preparar desde 08:50; 12:00 libera justo 13:00");
  assert.deepEqual(inicios({ ...c, items: [item({ bufferAntesMinutos: 10, bufferDespuesMinutos: 15 })] }), ["10:00", "11:00"], "12:00 liberaría 13:05");
  const [t] = buscarTurnos(c);
  assert.deepEqual([hora(t!.items[0]!.ocupaDesde), hora(t!.items[0]!.ocupaHasta)], ["09:50", "11:00"]);
});

test("«cualquiera»: menor carga del día, luego ID; o el profesional elegido", () => {
  const profesionales = new Map([["ana", pro({ cargaMinutos: 120 })], ["bea", pro({ cargaMinutos: 30 })], ["caro", pro({ cargaMinutos: 30 })]]);
  const c = consulta({ items: [item({ candidatos: ["ana", "bea", "caro"] })], profesionales });
  assert.equal(buscarTurnos(c)[0]!.items[0]!.profesionalId, "bea");
  assert.equal(buscarTurnos({ ...c, items: [item({ candidatos: ["ana"] })] })[0]!.items[0]!.profesionalId, "ana");
});

test("recursos: unidades distintas libres todo el intervalo", () => {
  const recursos = [{ id: "cab1", tipoRecursoId: "cabina", ocupado: [iv("09:00", "10:00")] }, { id: "cab2", tipoRecursoId: "cabina", ocupado: [iv("09:30", "11:00")] }];
  const c = consulta({ items: [item({ requisitos: [{ tipoRecursoId: "cabina", cantidad: 1 }] })], recursos });
  assert.deepEqual(inicios(c), ["10:00", "11:00", "12:00"]);
  assert.deepEqual(buscarTurnos(c)[0]!.items[0]!.recursoIds, ["cab1"]);
  assert.deepEqual(inicios({ ...c, items: [item({ requisitos: [{ tipoRecursoId: "cabina", cantidad: 2 }] })] }), ["11:00", "12:00"]);
  assert.deepEqual(inicios({ ...c, items: [item({ requisitos: [{ tipoRecursoId: "laser", cantidad: 1 }] })] }), [], "sin unidades del tipo");
});

test("varios servicios encadenados con profesionales distintos (D15) y vuelta atrás", () => {
  const profesionales = new Map([
    ["ana", pro({ cargaMinutos: 0 })],
    ["bea", pro({ cargaMinutos: 60, jornada: [iv("09:00", "13:00")] })],
  ]);
  const manos = item({ servicioId: "manos", candidatos: ["ana", "bea"] });
  const pies = item({ servicioId: "pies", candidatos: ["ana"] });
  const c = consulta({ items: [manos, pies], profesionales });
  const t = asignarEn(c, h("09:00"))!;
  assert.deepEqual(t.items.map(i => [i.servicioId, i.profesionalId, hora(i.inicio)]), [["manos", "ana", "09:00"], ["pies", "ana", "09:50"]]);
  // Si ana está ocupada a las 09:00, la primera parte la hace bea y ana sigue a las 09:50.
  const ocupada = consulta({ items: [manos, pies], profesionales: new Map([["ana", pro({ ocupado: [iv("09:00", "09:50")] })], ["bea", pro()]]) });
  assert.deepEqual(asignarEn(ocupada, h("09:00"))!.items.map(i => i.profesionalId), ["bea", "ana"]);
  // Vuelta atrás: elegir ana primero dejaría pies sin profesional; el motor prueba bea.
  const solo = consulta({ items: [item({ servicioId: "manos", candidatos: ["ana", "bea"] }), item({ servicioId: "pies", candidatos: ["ana"] })],
    profesionales: new Map([["ana", pro({ jornada: [iv("09:00", "13:00")] })], ["bea", pro({ cargaMinutos: 999 })]]) });
  assert.ok(asignarEn(solo, h("09:00")));
  assert.equal(asignarEn(consulta({ items: [manos, pies], apertura: [iv("09:00", "10:30")], profesionales }), h("09:00")), null, "el segundo servicio no entra en la apertura");
});

test("anticipación y horizonte acotan los inicios", () => {
  assert.deepEqual(inicios(consulta({ desdeMs: h("10:30") })), ["11:00", "12:00"]);
  assert.deepEqual(inicios(consulta({ hastaMs: h("10:00") })), ["09:00", "10:00"]);
  assert.equal(asignarEn(consulta({ desdeMs: h("10:30") }), h("10:00")), null);
});
