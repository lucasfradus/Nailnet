import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, crearTipoRecurso, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente, publicarConsentimiento } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearBloqueo, crearProfesional, crearRecurso, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { pasarAtencion, registrarLlegada, reprogramarReserva, sentarTurno, sumarServicio, terminarAtencion, tomarTurno } from "../src/reservas.ts";
import { agregarEspera, esperaSeFue, sentarEspera, tableroSede } from "../src/tablero.ts";
import { destinosDeTurno } from "../src/agenda-dia.ts";
import { disponiblesAhora } from "../src/disponibilidad.ts";
import { prepararVenta, registrarVenta } from "../src/ventas.ts";
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

    await t.test("disponiblesAhora: lo que entra pisando un turno, y hasta cuándo", async () => {
      const de = async (id: string, hhmm: string) => {
        const p = (await disponiblesAhora(db, R, O, centro, en(hhmm))).profesionales.find(x => x.id === id)!;
        return { estado: p.estado, ahora: [...p.entranAhora].sort(), pisando: [...p.entranPisando].sort(), libreHasta: p.libreHasta, finJornada: p.finJornada };
      };
      assert.deepEqual(await de(ana, "09:30"), { estado: "libre", ahora: [], pisando: [manos, pies].sort(), libreHasta: en("22:00"), finJornada: en("22:00") }, "pisaría su turno de las 10:00");
      assert.deepEqual(await de(dani, "10:00"), { estado: "libre", ahora: [], pisando: [], libreHasta: en("10:30"), finJornada: en("10:30") }, "no le entra antes del fin de su jornada");
      assert.deepEqual(await de(bea, "10:35"), { estado: "ocupada", ahora: [], pisando: [pies], libreHasta: en("11:30"), finJornada: en("22:00") }, "manos no entra antes de su ausencia; pies sí, pisando");
      assert.deepEqual(await de(eli, "09:30"), { estado: "libre", ahora: [manos, pies].sort(), pisando: [], libreHasta: en("22:00"), finJornada: en("22:00") }, "a Eli le entra todo sin pisar");
      assert.deepEqual((await de(dani, "07:30")).finJornada, null, "fuera de su horario");
    });

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

    // ─── 3b ──────────────────────────────────────────────────────────────────
    // Otro martes, para empezar con la agenda limpia. Se suma Tratamientos (Fiona, masajes) para ver el
    // filtro de universo, y Semi, que exige consentimiento.
    const F2 = "2099-11-10";
    const F3 = "2099-11-17";
    const e2 = (hhmm: string) => en(hhmm, F2);
    const iso2 = (hhmm: string) => e2(hhmm).toISOString();
    await publicarConsentimiento(db, M, O, { tipo: "PRACTICA", clave: "semi", titulo: "Semipermanente", texto: "Consentimiento de práctica para el esmaltado semipermanente." });
    const semi = (await guardarServicio(db, M, O, { ...base, nombre: "Semi", duracionMinutos: 30, consentimientos: ["semi"] }))!.id;
    const masajes = (await crearCategoria(db, M, O, "Masajes", 1, "TRATAMIENTOS"))!;
    const masaje = (await guardarServicio(db, M, O, { ...base, categoriaId: masajes.id, nombre: "Masaje", duracionMinutos: 60 }))!.id;
    for (const s of [semi, masaje]) await guardarServicioSede(db, M, O, centro, s, { habilitado: true, precio: "15000", duracionMinutos: null, sena: null, reservableOnline: true });
    for (const p of [ana, bea, caro, eli]) await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [manos, pies, semi] });
    const fiona = (await crearProfesional(db, M, O, centro, { nombre: "Fiona" })).id;
    await guardarHabilidades(db, M, O, fiona, { skillIds: [], servicioIds: [masaje] });
    await guardarHorarioProfesional(db, M, O, fiona, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    const marta = (await crearCliente(db, R, O, centro, { nombre: "Marta", telefono: "1166667777", email: "marta@ejemplo.com" }))!.id;
    const turno2 = (profesionalId: string, hhmm: string, opciones: { servicioId?: string; clienteId?: string; fecha?: string } = {}) =>
      tomarTurno(db, R, O, { sedeId: centro, fecha: opciones.fecha ?? F2, canal: "RECEPCION", clienteId: opciones.clienteId ?? lucia, items: [{ servicioId: opciones.servicioId ?? manos, profesionalId }], inicio: en(hhmm, opciones.fecha ?? F2) }, e2("08:00")).then(r => r.reservaId);
    const espera2 = (nombre: string, hhmm: string, servicioIds = [manos]) => agregarEspera(db, R, O, { sedeId: centro, nombre, servicioIds }, e2(hhmm));
    const sentar2 = (esperaId: string, items: { servicioId: string; profesionalId: string }[], hhmm: string, pisar?: boolean) => sentarEspera(db, R, O, { esperaId, items, ...(pisar ? { pisar } : {}) }, e2(hhmm));
    const tablero2 = (hhmm: string, universo?: "MANOS_PIES" | "TRATAMIENTOS") => tableroSede(db, R, O, centro, e2(hhmm), universo ? { universo } : {});
    const reserva = (id: string) => db.reservaItem.findMany({ where: { reservaId: id }, orderBy: { posicion: "asc" }, include: { recursos: true } });

    const tAna10 = await turno2(ana, "10:00");
    const tBea10 = await turno2(bea, "10:00", { clienteId: marta });
    const tCaro11 = await turno2(caro, "11:00");
    const tEli11 = await turno2(eli, "11:00");
    const tEli12 = await turno2(eli, "12:00");
    const tAna13 = await turno2(ana, "13:00");
    const tCaro1330 = await turno2(caro, "13:30");
    const tBea14 = await turno2(bea, "14:00");
    const tFiona16 = await turno2(fiona, "16:00", { servicioId: masaje });
    const tManana = await turno2(ana, "10:00", { fecha: F3 });
    // Una espera de otra organización (para el relleno y la FK).
    const esperaAjena = (await db.esperaRecepcion.create({ data: { organizacionId: b.org.id, sedeId: b.centro.id, nombre: "Ajena", servicioIds: [manos], llegada: e2("09:00"), estado: "ESPERANDO", registradaPorId: b.recepcion.id } })).id;
    const vera = await espera2("Vera", "09:25");
    const deVera = (await sentar2(vera.id, [{ servicioId: manos, profesionalId: bea }], "09:30", true)).reservaId;

    let nBea = "";
    await t.test("registrarLlegada: empieza, espera a su profesional ocupada, adelanta, o no puede adelantar", async () => {
      assert.deepEqual(await registrarLlegada(db, R, O, tAna10, e2("10:00")), { empezo: true });
      const r1 = await db.reserva.findUniqueOrThrow({ where: { id: tAna10 } });
      assert.deepEqual([r1.iniciadaEn?.toISOString(), r1.llegoEn], [iso2("10:00"), null]);

      assert.deepEqual(await registrarLlegada(db, R, O, tBea10, e2("10:02")), { empezo: false }, "Bea atiende a Vera");
      assert.deepEqual(await registrarLlegada(db, R, O, tBea10, e2("10:03")), { empezo: false }, "sigue ocupada");
      const r2 = await db.reserva.findUniqueOrThrow({ where: { id: tBea10 } });
      assert.deepEqual([r2.iniciadaEn, r2.llegoEn?.toISOString()], [null, iso2("10:02")], "conserva la primera llegada");
      const log = await db.auditLog.findFirstOrThrow({ where: { organizacionId: O, accion: "reserva.llegada", entidadId: tBea10 } });
      assert.deepEqual(log.datos, { esperando: true, motivos: ["Bea está atendiendo a otra clienta"] });

      // Llegó antes y Caro está libre hasta su turno: se adelanta a este minuto.
      assert.deepEqual(await registrarLlegada(db, R, O, tCaro11, e2("10:40")), { empezo: true });
      assert.deepEqual((await reserva(tCaro11)).map(i => [i.inicio.toISOString(), i.fin.toISOString()]), [[iso2("10:40"), iso2("11:40")]]);

      await assert.rejects(registrarLlegada(db, R, O, tAna10, e2("10:41")), /ya está en atención/);
      await assert.rejects(registrarLlegada(db, R, O, tManana, e2("10:41")), /de hoy/);
      await assert.rejects(registrarLlegada(db, a.profesional.id, O, tEli12, e2("10:41")), AccesoDenegado);
      await assert.rejects(registrarLlegada(db, b.recepcion.id, b.org.id, tEli12, e2("10:41")), AccesoDenegado);
    });

    await t.test("tablero: `llegaron` por orden de llegada, fuera de `porLlegar`, con el filtro de universo", async () => {
      const x = await tablero2("10:05");
      assert.deepEqual(x.llegaron, [{
        reservaId: tBea10, cliente: { id: marta, nombre: "Marta", apellido: null }, clienteProvisional: null, llegoEn: e2("10:02"), inicio: e2("10:00"),
        items: [{ servicioId: manos, servicio: "Manos", profesionalId: bea, profesional: "Bea" }],
      }]);
      assert.equal(x.porLlegar.some(r => r.reservaId === tBea10), false);
      assert.equal(x.porLlegar.some(r => r.reservaId === tEli11), true);
      assert.deepEqual((await tablero2("10:05", "MANOS_PIES")).llegaron.map(r => r.reservaId), [tBea10]);
      assert.deepEqual((await tablero2("10:05", "TRATAMIENTOS")).llegaron, []);
      assert.deepEqual(x.universos.map(u => [u.universo, u.esperas]), [["MANOS_PIES", 1], ["TRATAMIENTOS", 0]]);
    });

    await t.test("sentarTurno con la misma profesional: conserva cliente, precio, llegada y la cadena; sin email", async () => {
      await terminarAtencion(db, R, O, deVera, e2("10:20"));
      const nueva = await sentarTurno(db, R, O, { reservaId: tBea10 }, new Date(e2("10:21").getTime() + 20_000));
      nBea = nueva.reservaId;
      assert.deepEqual(nueva.items.map(i => [i.servicioId, i.profesionalId, i.inicio.toISOString(), i.fin.toISOString(), i.precio]), [[manos, bea, iso2("10:21"), iso2("11:21"), "20000.00"]]);
      const r = await db.reserva.findUniqueOrThrow({ where: { id: nBea } });
      assert.deepEqual([r.reemplazaId, r.clienteId, r.canal, r.estado, r.sinTurnoPrevio, r.iniciadaEn?.toISOString(), r.llegoEn?.toISOString()], [tBea10, marta, "RECEPCION", "CONFIRMADA", false, iso2("10:21"), iso2("10:02")]);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: tBea10 } })).estado, "CANCELADA");
      assert.deepEqual(await creada(nBea), { reprogramadaDesde: tBea10, sentada: true });
      assert.equal(await db.job.count({ where: { organizacionId: O, tipo: "email.reserva_reprogramada" } }), 0, "la clienta está en el local");
      const x = await tablero2("10:22");
      assert.deepEqual(x.llegaron, []);
      assert.equal(x.profesionales.find(p => p.id === bea)!.atencion?.reservaId, nBea);
      await assert.rejects(sentarTurno(db, R, O, { reservaId: nBea }, e2("10:23")), /ya está en atención/);
      await assert.rejects(sentarTurno(db, R, O, { reservaId: tBea10 }, e2("10:23")), /cancelado/);
    });

    await t.test("sumarServicio: otra profesional ocupada, la misma, pisando, turno sin empezar, permisos", async () => {
      await assert.rejects(sumarServicio(db, R, O, { reservaId: nBea, servicioId: pies, profesionalId: ana }, e2("10:30")), OCUPADA, "Ana atiende");
      await assert.rejects(sumarServicio(db, R, O, { reservaId: nBea, servicioId: pies, profesionalId: bea }, e2("10:30")), /ya tiene un servicio sin terminar/);
      await assert.rejects(sumarServicio(db, R, O, { reservaId: nBea, servicioId: pies, profesionalId: eli }, e2("10:30")), OCUPADA, "su turno de las 11:00");
      await assert.rejects(sumarServicio(db, R, O, { reservaId: tCaro1330, servicioId: pies, profesionalId: eli, pisar: true }, e2("10:30")), /no está en curso/);
      await assert.rejects(sumarServicio(db, a.profesional.id, O, { reservaId: nBea, servicioId: pies, profesionalId: eli, pisar: true }, e2("10:30")), AccesoDenegado);
      await assert.rejects(sumarServicio(db, b.recepcion.id, b.org.id, { reservaId: nBea, servicioId: pies, profesionalId: eli, pisar: true }, e2("10:30")), AccesoDenegado);
      await sumarServicio(db, R, O, { reservaId: nBea, servicioId: pies, profesionalId: eli, pisar: true }, e2("10:30"));
      const items = await reserva(nBea);
      assert.deepEqual(items.map(i => [i.posicion, i.servicioId, i.profesionalId, i.inicio.toISOString(), i.fin.toISOString(), i.precio.toFixed(2), i.recursos.length]), [
        [0, manos, bea, iso2("10:21"), iso2("11:21"), "20000.00", 0],
        [1, pies, eli, iso2("10:30"), iso2("11:15"), "20000.00", 1],
      ], "el motor asigna el sillón");
      const ev = await db.reservaEvento.findFirstOrThrow({ where: { reservaId: nBea, tipo: "SERVICIO_SUMADO" } });
      assert.deepEqual([ev.estadoAnterior, ev.estadoNuevo, ev.detalle], ["CONFIRMADA", "CONFIRMADA", { servicios: [{ servicioId: pies, profesionalId: eli }], pisadas: [tEli11] }]);
      const x = await tablero2("10:31");
      assert.deepEqual([bea, eli].map(id => x.profesionales.find(p => p.id === id)!.atencion?.reservaId), [nBea, nBea]);
    });

    await t.test("«Terminó» por profesional y el cobro con todos los servicios en una venta", async () => {
      await terminarAtencion(db, R, O, tAna10, e2("11:00"));
      await terminarAtencion(db, R, O, nBea, e2("11:00"), { profesionalId: eli });
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: nBea } })).estado, "CONFIRMADA", "falta Bea");
      assert.equal((await tablero2("11:01")).profesionales.find(p => p.id === eli)!.atencion, null);
      await terminarAtencion(db, R, O, nBea, e2("11:20"), { profesionalId: bea });
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: nBea } })).estado, "ATENDIDA");
      const prep = await prepararVenta(db, R, O, centro, nBea);
      assert.deepEqual([prep.turno?.items.map(i => [i.servicioId, i.profesionalId]), prep.turno?.subtotal], [[[manos, bea], [pies, eli]], "40000.00"]);
      const venta = await registrarVenta(db, R, O, { sedeId: centro, reservaId: nBea, productos: [], cobros: [{ medio: "TRANSFERENCIA", monto: "40000" }], claveIdempotencia: randomUUID() });
      assert.equal(venta.estado, "COMPLETADA");
      const lineas = await db.ventaItem.findMany({ where: { ventaId: venta.id }, orderBy: { posicion: "asc" } });
      assert.deepEqual(lineas.map(l => [l.servicioId, l.profesionalId, l.subtotal.toFixed(2), !!l.reservaItemId]), [[manos, bea, "20000.00", true], [pies, eli, "20000.00", true]]);
      assert.equal((await tablero2("11:30")).porCobrar.some(p => p.reservaId === nBea), false);
    });

    await t.test("sentarTurno: no puede adelantar, carrera entre dos recepcionistas, otra profesional, pisando, otro día, permisos", async () => {
      await terminarAtencion(db, R, O, tCaro11, e2("11:40"));
      // Eli está libre, pero su turno de las 11:00 (sin llegar) no deja adelantar el de las 12:00.
      assert.deepEqual(await registrarLlegada(db, R, O, tEli12, e2("11:30")), { empezo: false });
      assert.deepEqual((await tablero2("11:35")).llegaron.map(r => r.reservaId), [tEli12]);

      const intentos = await Promise.allSettled([[db, eli, true], [db2, ana, false]].map(([c, p, pisar]) => sentarTurno(c as typeof db, R, O, { reservaId: tEli12, profesionales: [p as string], pisar: pisar as boolean }, e2("11:45"))));
      assert.deepEqual(intentos.map(x => x.status).sort(), ["fulfilled", "rejected"]);
      const rechazo = intentos.find(x => x.status === "rejected") as PromiseRejectedResult;
      assert.ok(rechazo.reason instanceof DatosInvalidos && /cancelado|cambió mientras tanto/.test(rechazo.reason.message), String(rechazo.reason));
      assert.equal(await db.reserva.count({ where: { reemplazaId: tEli12 } }), 1);
      const ganador = (intentos.find(x => x.status === "fulfilled") as PromiseFulfilledResult<{ reservaId: string }>).value.reservaId;
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: ganador } })).llegoEn?.toISOString(), iso2("11:30"));
      await terminarAtencion(db, R, O, ganador, e2("11:55"));

      await assert.rejects(sentarTurno(db, R, O, { reservaId: tAna13, profesionales: [dani] }, e2("12:00")), /no hace ese servicio/);
      const otra = await sentarTurno(db, R, O, { reservaId: tAna13, profesionales: [bea] }, e2("12:00"));
      assert.deepEqual(otra.items.map(i => [i.profesionalId, i.inicio.toISOString()]), [[bea, iso2("12:00")]]);
      await terminarAtencion(db, R, O, otra.reservaId, e2("13:00"));

      await assert.rejects(sentarTurno(db, R, O, { reservaId: tCaro1330, profesionales: [bea] }, e2("13:30")), OCUPADA, "pisaría el turno de las 14:00 de Bea");
      const pisando = await sentarTurno(db, R, O, { reservaId: tCaro1330, profesionales: [bea], pisar: true }, e2("13:30"));
      assert.deepEqual(await creada(pisando.reservaId), { reprogramadaDesde: tCaro1330, sentada: true, pisadas: [tBea14] });
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: tBea14 } })).estado, "CONFIRMADA");
      await terminarAtencion(db, R, O, pisando.reservaId, e2("14:00"));

      await assert.rejects(sentarTurno(db, R, O, { reservaId: tManana }, e2("13:35")), /turno de hoy/);
      await assert.rejects(sentarTurno(db, a.profesional.id, O, { reservaId: tBea14 }, e2("13:35")), AccesoDenegado);
      await assert.rejects(sentarTurno(db, b.recepcion.id, b.org.id, { reservaId: tBea14 }, e2("13:35")), AccesoDenegado);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: tBea14 } })).estado, "CONFIRMADA", "los rechazos no cambian nada");
    });

    await t.test("una comanda por visita: sentarEspera en dos tiempos suma al turno en curso; consentimiento sin ficha", async () => {
      const olga = await espera2("Olga", "14:10", [manos, pies, semi]);
      const primero = await sentar2(olga.id, [{ servicioId: pies, profesionalId: caro }], "14:15");
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: primero.reservaId } })).esperaId, olga.id);
      await assert.rejects(sentar2(olga.id, [{ servicioId: semi, profesionalId: ana }], "14:20"), /consentimiento.*ficha/, "sin ficha");
      const segundo = await sentar2(olga.id, [{ servicioId: manos, profesionalId: ana }], "14:20");
      assert.equal(segundo.reservaId, primero.reservaId, "un solo turno");
      assert.deepEqual(segundo.items.map(i => [i.servicioId, i.profesionalId, i.inicio.toISOString()]), [[pies, caro, iso2("14:15")], [manos, ana, iso2("14:20")]]);
      const abierta = await db.esperaRecepcion.findUniqueOrThrow({ where: { id: olga.id } });
      assert.deepEqual([abierta.estado, abierta.servicioIds], ["ESPERANDO", [semi]], "falta el semi");
      assert.deepEqual((await db.reservaEvento.findFirstOrThrow({ where: { reservaId: primero.reservaId, tipo: "SERVICIO_SUMADO" } })).detalle, { servicios: [{ servicioId: manos, profesionalId: ana }], esperaId: olga.id });
      await assert.rejects(sumarServicio(db, R, O, { reservaId: primero.reservaId, servicioId: semi, profesionalId: eli }, e2("14:21")), /consentimiento.*ficha/);
      await esperaSeFue(db, R, O, olga.id, e2("14:22"));
      const prep = await prepararVenta(db, R, O, centro, primero.reservaId);
      assert.deepEqual(prep.turno?.espera, { nombre: "Olga", telefono: null });
      await terminarAtencion(db, R, O, primero.reservaId, e2("15:20"));

      // Tratamientos: la clienta de Fiona llegó con Fiona atendiendo; se ve solo en su pestaña.
      const ivi = await espera2("Ivi", "15:20", [masaje]);
      await sentar2(ivi.id, [{ servicioId: masaje, profesionalId: fiona }], "15:30", true);
      assert.deepEqual(await registrarLlegada(db, R, O, tFiona16, e2("15:50")), { empezo: false });
      assert.deepEqual((await tablero2("15:51", "TRATAMIENTOS")).llegaron.map(r => r.reservaId), [tFiona16]);
      assert.deepEqual((await tablero2("15:51", "MANOS_PIES")).llegaron, []);
      assert.deepEqual((await tablero2("15:51")).universos.map(u => [u.universo, u.esperas]), [["MANOS_PIES", 0], ["TRATAMIENTOS", 1]]);
    });

    await t.test("migración: el relleno de esperaId (por la espera cerrada y por el evento de creación)", async () => {
      // Un sentado parcial que dejó la espera abierta: el turno solo queda unido a ella por el evento.
      const sol = await espera2("Sol", "16:00", [manos, pies]);
      const deSol = (await sentar2(sol.id, [{ servicioId: manos, profesionalId: ana }], "16:05")).reservaId;
      // Eventos de creación con un esperaId que no sirve: de otra organización, o que no es un UUID.
      await db.reservaEvento.create({ data: { organizacionId: O, reservaId: tAna10, tipo: "CREADA", estadoAnterior: null, estadoNuevo: "CONFIRMADA", detalle: { esperaId: "no-es-un-uuid" } } });
      await db.reservaEvento.create({ data: { organizacionId: O, reservaId: tCaro11, tipo: "CREADA", estadoAnterior: null, estadoNuevo: "CONFIRMADA", detalle: { esperaId: esperaAjena } } });

      const antes = new Map((await db.reserva.findMany({ where: { organizacionId: O }, select: { id: true, esperaId: true } })).map(r => [r.id, r.esperaId]));
      assert.equal(antes.get(deSol), sol.id);
      assert.equal(antes.get(deVera), vera.id, "cerró su espera");
      assert.ok([...antes.values()].filter(Boolean).length >= 5);
      await db.reserva.updateMany({ where: { organizacionId: O }, data: { esperaId: null } });
      const sql = await readFile(new URL("../prisma/migrations/202611110030_flexibilidad_salon/migration.sql", import.meta.url), "utf8");
      const relleno = sql.slice(sql.indexOf("-- relleno:desde"), sql.indexOf("-- relleno:hasta"));
      const sentencias = relleno.split(/;\s*$/m).map(x => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
      assert.equal(sentencias.length, 2);
      for (const s of sentencias) await db.$executeRawUnsafe(s);
      const despues = new Map((await db.reserva.findMany({ where: { organizacionId: O }, select: { id: true, esperaId: true } })).map(r => [r.id, r.esperaId]));
      assert.deepEqual(despues, antes);
    });

    await t.test("CHECK y FK: llegada solo con turno previo; la espera, de la misma organización", async () => {
      await assert.rejects(db.reserva.update({ where: { id: deVera }, data: { llegoEn: e2("17:00") } }), /Reserva_llegada/);
      await assert.rejects(db.reserva.update({ where: { id: tBea14 }, data: { esperaId: esperaAjena } }), /esperaId_fkey|Foreign key|foreign key/i);
      await db.reserva.update({ where: { id: tBea14 }, data: { llegoEn: e2("13:50") } });
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
