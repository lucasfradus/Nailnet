import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { crearCategoria, crearTipoRecurso, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { ConfiguracionIncompleta, consultarDisponibilidad } from "../src/disponibilidad.ts";
import { crearProfesional, crearRecurso, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos, vincularSede } from "../src/profesionales.ts";
import { TurnoNoDisponible, retenerTurno } from "../src/reservas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13"; // martes
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");
const resultado = (r: PromiseSettledResult<unknown>[]) => ({
  ganan: r.filter(x => x.status === "fulfilled").length,
  ocupados: r.filter(x => x.status === "rejected" && x.reason instanceof TurnoNoDisponible).length,
  otros: r.filter(x => x.status === "rejected" && !(x.reason instanceof TurnoNoDisponible)).map(x => (x as PromiseRejectedResult).reason),
});

test("exclusión concurrente de turnos (C05)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id;
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const cabina = (await crearTipoRecurso(db, M, O, "Láser"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "PORCENTAJE" as const, valor: "30" }, activo: true, consentimientos: [], skillIds: [] };
    const manos = (await guardarServicio(db, M, O, { ...base, nombre: "Manos", duracionMinutos: 50, recursos: [] }))!.id;
    const laser = (await guardarServicio(db, M, O, { ...base, nombre: "Láser", duracionMinutos: 30, recursos: [{ tipoRecursoId: cabina.id, cantidad: 1 }] }))!.id;
    for (const sede of [a.centro.id, a.norte.id]) {
      for (const s of [manos, laser]) await guardarServicioSede(db, M, O, sede, s, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
      await guardarHorarioSede(db, M, O, sede, semanaDesdeTextos({ 2: "08:00-20:00" }));
    }
    await crearRecurso(db, M, O, a.centro.id, { tipoRecursoId: cabina.id, nombre: "Láser A" });
    const pros: string[] = [];
    for (const nombre of ["Ana", "Bea", "Caro"]) {
      const id = (await crearProfesional(db, M, O, a.centro.id, { nombre })).id;
      await guardarHabilidades(db, M, O, id, { skillIds: [], servicioIds: [manos, laser] });
      await guardarHorarioProfesional(db, M, O, id, a.centro.id, semanaDesdeTextos({ 2: "09:00-13:00" }));
      pros.push(id);
    }
    const [ana, bea] = pros as [string, string, string];
    await vincularSede(db, M, O, ana, a.norte.id, true);
    await guardarHorarioProfesional(db, M, O, ana, a.norte.id, semanaDesdeTextos({ 2: "14:00-18:00" }));
    const pedido = (extra: object = {}) => ({ sedeId: a.centro.id, fecha: FECHA, canal: "RECEPCION" as const, items: [{ servicioId: manos, profesionalId: ana }], inicio: en("09:00"), ...extra });

    await t.test("sin retención definida (D4) no se retiene", async () => {
      await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 10 });
      await assert.rejects(retenerTurno(db, a.recepcion.id, O, pedido(), ahora), ConfiguracionIncompleta);
      await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 10, retencionMinutos: 15 });
      await assert.rejects(retenerTurno(db, a.profesional.id, O, pedido(), ahora), AccesoDenegado);
      await assert.rejects(retenerTurno(db, null, O, pedido(), ahora), AccesoDenegado, "sin actor solo canal online");
    });

    await t.test("10 intentos simultáneos por la misma profesional y horario: gana uno", async () => {
      const r = resultado(await Promise.allSettled(Array.from({ length: 10 }, () => retenerTurno(db, a.recepcion.id, O, pedido(), ahora))));
      assert.deepEqual([r.ganan, r.ocupados, r.otros.length], [1, 9, 0], String(r.otros[0] ?? ""));
      assert.equal(await db.reservaItem.count({ where: { profesionalId: ana, inicio: en("09:00") } }), 1);
    });

    await t.test("intervalos contiguos son válidos; uno que se pisa no", async () => {
      const r = await retenerTurno(db, a.recepcion.id, O, pedido({ inicio: en("09:50") }), ahora);
      assert.equal(r.items[0]!.sena, "9000.00", "snapshot de precio y seña");
      await assert.rejects(retenerTurno(db, a.recepcion.id, O, pedido({ inicio: en("10:30") }), ahora), TurnoNoDisponible);
    });

    await t.test("«cualquiera» con 3 profesionales y 5 intentos: ganan 3, sin repetir profesional", async () => {
      const intentos = Array.from({ length: 5 }, () => retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: manos }], inicio: en("11:00") }), ahora));
      const res = await Promise.allSettled(intentos);
      const r = resultado(res);
      assert.deepEqual([r.ganan, r.ocupados, r.otros.length], [3, 2, 0], String(r.otros[0] ?? ""));
      const asignadas = res.filter(x => x.status === "fulfilled").map(x => (x as PromiseFulfilledResult<Awaited<ReturnType<typeof retenerTurno>>>).value.items[0]!.profesionalId);
      assert.equal(new Set(asignadas).size, 3);
    });

    await t.test("un único recurso disputado por profesionales distintos: gana uno", async () => {
      // Compiten Bea y Caro (Ana queda libre para el caso siguiente, que así es determinista).
      const r = resultado(await Promise.allSettled([bea, pros[2]!].map(p => retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: laser, profesionalId: p }], inicio: en("12:00") }), ahora))));
      assert.deepEqual([r.ganan, r.ocupados, r.otros.length], [1, 1, 0], String(r.otros[0] ?? ""));
    });

    await t.test("turnos contiguos de la misma profesional en dos sedes, en paralelo: ambos valen", async () => {
      // Ana: Centro 09-13 y Norte 14-18. Se corre Norte para que empiece justo cuando termina Centro.
      await guardarHorarioProfesional(db, M, O, ana, a.norte.id, semanaDesdeTextos({ 2: "13:00-18:00" }));
      const r = resultado(await Promise.allSettled([
        retenerTurno(db, a.recepcion.id, O, pedido({ inicio: en("12:10") }), ahora),
        retenerTurno(db, a.recepcion.id, O, pedido({ sedeId: a.norte.id, inicio: en("13:00") }), ahora),
      ]));
      assert.deepEqual([r.ganan, r.otros.length], [2, 0], String(r.otros[0] ?? ""));
      // Y el turno ya tomado en Centro bloquea a Ana en Norte (la ocupación es global).
      await assert.rejects(retenerTurno(db, a.recepcion.id, O, pedido({ sedeId: a.norte.id, inicio: en("13:00") }), ahora), TurnoNoDisponible);
    });

    await t.test("varios servicios: todo o nada", async () => {
      const antes = await db.reserva.count({ where: { organizacionId: O } });
      // Ana ya tiene 09:50-10:40: la cadena Bea 09:00 → Ana 09:50 no entra completa.
      await assert.rejects(retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: manos, profesionalId: bea }, { servicioId: manos, profesionalId: ana }], inicio: en("09:00") }), ahora), TurnoNoDisponible);
      assert.equal(await db.reserva.count({ where: { organizacionId: O } }), antes, "no quedó una reserva parcial");
      const ok = await retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: manos, profesionalId: bea }, { servicioId: manos, profesionalId: pros[2]! }], inicio: en("09:00") }), ahora);
      assert.deepEqual(ok.items.map(i => [i.profesionalId, i.inicio.getTime()]), [[bea, en("09:00").getTime()], [pros[2], en("09:50").getTime()]]);
      assert.equal(await db.reservaItem.count({ where: { reservaId: ok.reservaId } }), 2);
    });

    await t.test("una retención vencida se libera y pasa a EXPIRADA al volver a reservar", async () => {
      const r = await retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: manos, profesionalId: pros[2]! }], inicio: en("09:00") }), ahora);
      const despues = new Date(r.expiraEn.getTime() + 1000);
      const libres = await consultarDisponibilidad(db, a.recepcion.id, O, { sedeId: a.centro.id, fecha: FECHA, canal: "RECEPCION", items: [{ servicioId: manos, profesionalId: pros[2]! }] }, despues);
      assert.ok(libres.some(x => new Date(x.inicio).getTime() === en("09:00").getTime()));
      await retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: manos, profesionalId: pros[2]! }], inicio: en("09:00") }), despues);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: r.reservaId } })).estado, "EXPIRADA");
    });

    await t.test("una jornada cambiada en paralelo no deja turnos fuera de horario", async () => {
      const caro = pros[2]!;
      const [cambio, ret] = await Promise.allSettled([
        guardarHorarioProfesional(db, M, O, caro, a.centro.id, semanaDesdeTextos({ 2: "09:00-10:00" })),
        retenerTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: manos, profesionalId: caro }], inicio: en("11:00") }), ahora),
      ]);
      assert.equal(cambio.status, "fulfilled");
      // Serializadas por el mismo lock: si la retención entró primero, la jornada nueva la deja afuera
      // (validación contra turnos pendiente, doc 14); si entró después, la retención se rechaza.
      if (ret.status === "rejected") assert.ok(ret.reason instanceof TurnoNoDisponible);
    });
  } finally { await db.$disconnect(); }
});
