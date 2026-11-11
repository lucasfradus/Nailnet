import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, crearTipoRecurso, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearBloqueo, crearProfesional, crearRecurso, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { pasarAtencion, reprogramarReserva, terminarAtencion, tomarTurno } from "../src/reservas.ts";
import { agregarEspera, esperaSeFue, sentarEspera, tableroSede } from "../src/tablero.ts";
import { destinosDeTurno } from "../src/agenda-dia.ts";
import { crearFixture } from "../prisma/fixture.ts";

// Universos, etapa 3 (doc 31): flexibilidad en Manos y pies. El sistema avisa, no traba.

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-11-03"; // martes
const en = (hhmm: string, fecha = FECHA) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(fecha, h! * 60 + m!, TZ); };
const iso = (hhmm: string) => en(hhmm).toISOString();
const OCUPADA = /no está libre ahora/;

test("flexibilidad en Manos y pies (doc 31, etapa 3)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const db2 = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id;
    const centro = a.centro.id;

    // Manos (sin recurso) y Pies (con el único sillón). Ana, Bea, Caro y Eli hacen manos y pies; Dani, solo
    // pies y hasta las 10:30.
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const tipoSillon = (await crearTipoRecurso(db, M, O, "Sillón"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "NINGUNA" as const, valor: null }, activo: true, consentimientos: [] as string[], skillIds: [], recursos: [] as { tipoRecursoId: string; cantidad: number }[] };
    const manos = (await guardarServicio(db, M, O, { ...base, nombre: "Manos", duracionMinutos: 60 }))!.id;
    const pies = (await guardarServicio(db, M, O, { ...base, nombre: "Pies", duracionMinutos: 45, recursos: [{ tipoRecursoId: tipoSillon.id, cantidad: 1 }] }))!.id;
    for (const s of [manos, pies]) await guardarServicioSede(db, M, O, centro, s, { habilitado: true, precio: "20000", duracionMinutos: null, sena: null, reservableOnline: true });
    await crearRecurso(db, M, O, centro, { tipoRecursoId: tipoSillon.id, nombre: "Sillón 1" });
    await guardarHorarioSede(db, M, O, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana" })).id;
    const bea = (await crearProfesional(db, M, O, centro, { nombre: "Bea" })).id;
    const caro = (await crearProfesional(db, M, O, centro, { nombre: "Caro" })).id;
    const dani = (await crearProfesional(db, M, O, centro, { nombre: "Dani" })).id;
    const eli = (await crearProfesional(db, M, O, centro, { nombre: "Eli" })).id;
    for (const p of [ana, bea, caro, eli]) {
      await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [manos, pies] });
      await guardarHorarioProfesional(db, M, O, p, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    }
    await guardarHabilidades(db, M, O, dani, { skillIds: [], servicioIds: [pies] });
    await guardarHorarioProfesional(db, M, O, dani, centro, semanaDesdeTextos({ 2: "08:00-10:30" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    const zoe = (await crearProfesional(db, b.master.id, b.org.id, b.centro.id, { nombre: "Zoe" })).id;
    const lucia = (await crearCliente(db, R, O, centro, { nombre: "Lucía", telefono: "1144445555" }))!.id;

    const temprano = en("08:00");
    const turno = (profesionalId: string, hhmm: string, servicioId = manos) =>
      tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId, profesionalId }], inicio: en(hhmm) }, temprano);
    const espera = (nombre: string, hhmm: string, servicioIds = [manos]) => agregarEspera(db, R, O, { sedeId: centro, nombre, servicioIds }, en(hhmm));
    const sentar = (esperaId: string, servicioId: string, profesionalId: string, hhmm: string, pisar?: boolean) =>
      sentarEspera(db, R, O, { esperaId, items: [{ servicioId, profesionalId }], ...(pisar === undefined ? {} : { pisar }) }, en(hhmm));
    const tablero = (hhmm: string) => tableroSede(db, R, O, centro, en(hhmm));
    const creada = async (reservaId: string) => (await db.reservaEvento.findFirstOrThrow({ where: { reservaId, tipo: "CREADA" } })).detalle as Record<string, unknown>;

    // Turnos reservados del día, tomados temprano.
    const deAna10 = (await turno(ana, "10:00")).reservaId;
    const deBea1030 = (await turno(bea, "10:30")).reservaId;
    const piesCaro11 = (await turno(caro, "11:00", pies)).reservaId;
    const deCaro1230 = (await turno(caro, "12:30")).reservaId;
    await crearBloqueo(db, M, O, bea, { inicio: en("11:30"), fin: en("12:00"), motivo: "Médico" });

    // ─── 3a ──────────────────────────────────────────────────────────────────

    let deEva = "";
    await t.test("sentar igual: sin pisar no entra; con pisar entra y el evento guarda lo pisado", async () => {
      const eva = await espera("Eva", "09:20");
      await assert.rejects(sentar(eva.id, manos, ana, "09:30"), OCUPADA, "el turno de las 10:00 de Ana");
      await assert.rejects(sentar(eva.id, manos, ana, "09:30", false), OCUPADA);
      const sentado = await sentar(eva.id, manos, ana, "09:30", true);
      deEva = sentado.reservaId;
      assert.deepEqual(sentado.items.map(i => [i.profesionalId, i.inicio.toISOString(), i.fin.toISOString()]), [[ana, iso("09:30"), iso("10:30")]]);
      const d = await creada(deEva);
      assert.deepEqual([d.pisadas, d.esperaId, d.sinTurnoPrevio], [[deAna10], eva.id, true]);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: deAna10 } })).estado, "CONFIRMADA", "el turno pisado sigue en pie");
      // Un sentado que no pisa nada no deja `pisadas`, con o sin la opción.
      const flor = await espera("Flor", "09:21");
      const libre = await sentar(flor.id, manos, eli, "09:30", true);
      assert.equal("pisadas" in await creada(libre.reservaId), false);
      await terminarAtencion(db, R, O, libre.reservaId, en("09:45"));
    });

    await t.test("turno en riesgo: atendiendo, demorada y sin riesgo", async () => {
      const riesgos = async (hhmm: string, reservaId: string) => (await tablero(hhmm)).porLlegar.find(r => r.reservaId === reservaId)!.riesgos;
      assert.deepEqual(await riesgos("09:40", deAna10), [{ profesionalId: ana, profesional: "Ana", demorada: false, libreEstimado: en("10:30") }]);
      assert.deepEqual(await riesgos("09:40", deBea1030), [], "Bea no atiende");
      assert.deepEqual(await riesgos("10:31", deAna10), [{ profesionalId: ana, profesional: "Ana", demorada: true, libreEstimado: null }], "se pasó del estimado");
    });

    await t.test("con pisar sigue rechazando: atención en curso, ausencia, fuera de jornada y recurso ocupado", async () => {
      const fede = await espera("Fede", "10:33");
      await assert.rejects(sentar(fede.id, manos, ana, "10:20", true), OCUPADA, "Ana atiende a Eva");
      await assert.rejects(sentar(fede.id, manos, ana, "10:35", true), OCUPADA, "Ana atiende a Eva, pasada del estimado");
      await assert.rejects(sentar(fede.id, manos, bea, "10:35", true), OCUPADA, "pisa su turno de las 10:30, pero tiene una ausencia a las 11:30");
      const gabi = await espera("Gabi", "09:55", [pies]);
      await assert.rejects(sentar(gabi.id, pies, dani, "10:00", true), OCUPADA, "Dani trabaja hasta las 10:30");
      await assert.rejects(sentar(gabi.id, pies, caro, "10:35", true), OCUPADA, "pisaría su propio turno de pies, pero el sillón está ocupado a las 11:00");
      assert.deepEqual(await db.esperaRecepcion.findMany({ where: { id: { in: [fede.id, gabi.id] } }, select: { estado: true } }), [{ estado: "ESPERANDO" }, { estado: "ESPERANDO" }]);
      // Sin el sillón de por medio, manos con Caro pisando su turno de pies sí entra.
      const conCaro = await sentar(fede.id, manos, caro, "10:35", true);
      assert.deepEqual((await creada(conCaro.reservaId)).pisadas, [piesCaro11]);
      await terminarAtencion(db, R, O, conCaro.reservaId, en("11:30"));
      await terminarAtencion(db, R, O, deEva, en("10:40"));
      await esperaSeFue(db, R, O, gabi.id, en("10:41"));
    });

    let deRosa = "";
    await t.test("pasar una atención: la nueva no hace el servicio, atiende, tiene un turno (con y sin pisar), permisos", async () => {
      const ines = await espera("Inés", "11:45");
      const deInes = (await sentar(ines.id, manos, ana, "11:50", true)).reservaId;
      const rosa = await espera("Rosa", "11:55");
      deRosa = (await sentar(rosa.id, manos, bea, "12:00")).reservaId;
      const pasar = (aProfesionalId: string, hhmm: string, pisar?: boolean, deProfesionalId = bea) => pasarAtencion(db, R, O, { reservaId: deRosa, deProfesionalId, aProfesionalId, ...(pisar === undefined ? {} : { pisar }) }, en(hhmm));

      await assert.rejects(pasar(dani, "12:05"), (e: unknown) => e instanceof DatosInvalidos && e.message === "Dani no hace ese servicio");
      await assert.rejects(pasar(ana, "12:05"), /Ana está atendiendo a otra clienta/);
      await assert.rejects(pasar(caro, "12:05"), (e: unknown) => e instanceof DatosInvalidos && e.message === "Caro tiene un turno a las 12:30");
      await assert.rejects(pasar(bea, "12:05"), /otra profesional/);
      await assert.rejects(pasar(caro, "12:05", true, eli), /no tiene servicios en curso/);
      await assert.rejects(pasarAtencion(db, a.profesional.id, O, { reservaId: deRosa, deProfesionalId: bea, aProfesionalId: caro, pisar: true }, en("12:05")), AccesoDenegado);
      await assert.rejects(pasarAtencion(db, b.recepcion.id, b.org.id, { reservaId: deRosa, deProfesionalId: bea, aProfesionalId: caro, pisar: true }, en("12:05")), AccesoDenegado, "turno de otra organización");
      await assert.rejects(pasarAtencion(db, R, O, { reservaId: deRosa, deProfesionalId: bea, aProfesionalId: zoe, pisar: true }, en("12:05")), AccesoDenegado, "profesional de otra organización");
      await assert.rejects(pasarAtencion(db, R, O, { reservaId: deAna10, deProfesionalId: ana, aProfesionalId: caro }, en("12:05")), /no está en curso/);
      assert.equal((await db.reservaItem.findFirstOrThrow({ where: { reservaId: deRosa } })).profesionalId, bea, "los rechazos no cambian nada");

      await pasar(caro, "12:05", true);
      const item = await db.reservaItem.findFirstOrThrow({ where: { reservaId: deRosa } });
      assert.deepEqual([item.profesionalId, item.inicio.toISOString(), item.fin.toISOString(), item.terminadoEn], [caro, iso("12:00"), iso("13:00"), null], "mismo horario, otra profesional");
      const log = await db.auditLog.findFirstOrThrow({ where: { organizacionId: O, accion: "reserva.atencion_pasada", entidadId: deRosa } });
      assert.deepEqual(log.datos, { deProfesionalId: bea, aProfesionalId: caro, servicioIds: [manos], pisadas: [deCaro1230] });
      const x = await tablero("12:06");
      const de = (id: string) => x.profesionales.find(p => p.id === id)!;
      assert.equal(de(caro).atencion?.reservaId, deRosa);
      assert.equal(de(bea).atencion, null);
      await terminarAtencion(db, R, O, deInes, en("12:50"));
    });

    await t.test("pasar una atención: dos recepcionistas a la vez, con dos conexiones", async () => {
      const r = await Promise.allSettled([[db, eli], [db2, bea]].map(([c, p]) => pasarAtencion(c as typeof db, R, O, { reservaId: deRosa, deProfesionalId: caro, aProfesionalId: p as string }, en("12:10"))));
      assert.deepEqual(r.map(x => x.status).sort(), ["fulfilled", "rejected"]);
      const rechazo = r.find(x => x.status === "rejected") as PromiseRejectedResult;
      assert.ok(rechazo.reason instanceof DatosInvalidos && /no tiene servicios en curso/.test(rechazo.reason.message), String(rechazo.reason));
      const ganadora = (await db.reservaItem.findFirstOrThrow({ where: { reservaId: deRosa } })).profesionalId;
      assert.ok([eli, bea].includes(ganadora));
      assert.equal(await db.auditLog.count({ where: { organizacionId: O, accion: "reserva.atencion_pasada", entidadId: deRosa } }), 2);
      await terminarAtencion(db, R, O, deRosa, en("12:55"), { profesionalId: ganadora });
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: deRosa } })).estado, "ATENDIDA");
    });

    await t.test("cambiar de profesional un turno por llegar: destinosDeTurno y reprogramarReserva a la misma hora", async () => {
      const deAna15 = (await turno(ana, "15:00")).reservaId;
      await turno(caro, "15:00");
      const d = await destinosDeTurno(db, R, O, deAna15, FECHA, en("13:00"));
      const libresALas15 = d.destinos.filter(x => x.inicios.some(i => i.inicio.getTime() === en("15:00").getTime())).map(x => x.profesionalIds[0]).sort();
      assert.deepEqual(libresALas15, [ana, bea, eli].sort(), "Caro tiene otro turno; Dani no hace manos");
      const nueva = await reprogramarReserva(db, R, O, deAna15, { fecha: FECHA, inicio: en("15:00"), profesionales: [bea] }, en("13:00"));
      assert.deepEqual(nueva.items.map(i => [i.profesionalId, i.inicio.toISOString(), i.precio]), [[bea, iso("15:00"), "20000.00"]]);
      const r = await db.reserva.findUniqueOrThrow({ where: { id: nueva.reservaId } });
      assert.deepEqual([r.reemplazaId, r.clienteId, r.estado], [deAna15, lucia, "CONFIRMADA"]);
      const x = await tablero("14:00");
      assert.deepEqual(x.porLlegar.find(p => p.reservaId === nueva.reservaId)?.servicios, ["Manos · Bea"]);
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
