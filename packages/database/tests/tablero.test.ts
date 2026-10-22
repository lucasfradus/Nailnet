import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, crearTipoRecurso, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearProfesional, crearRecurso, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { PROFESIONAL_OCUPADA, atenderAhora, marcarLlegada, reprogramarReserva, terminarAtencion, tomarTurno } from "../src/reservas.ts";
import { registrarEntrada, registrarSalida, tableroSede } from "../src/tablero.ts";
import { registrarVenta } from "../src/ventas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ocupada = (e: unknown) => e instanceof DatosInvalidos && e.message === PROFESIONAL_OCUPADA;

test("tablero de recepción (doc 29)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const db2 = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id;
    const centro = a.centro.id;

    // Manos (60 min) sin recurso; Pies (45 min) en el único sillón de pedicuría de la sede.
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const sillon = (await crearTipoRecurso(db, M, O, "Sillón de pedicuría"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "NINGUNA" as const, valor: null }, activo: true, consentimientos: [], skillIds: [] };
    const manos = (await guardarServicio(db, M, O, { ...base, nombre: "Manos", duracionMinutos: 60, recursos: [] }))!.id;
    const pies = (await guardarServicio(db, M, O, { ...base, nombre: "Pies", duracionMinutos: 45, recursos: [{ tipoRecursoId: sillon.id, cantidad: 1 }] }))!.id;
    for (const s of [manos, pies]) await guardarServicioSede(db, M, O, centro, s, { habilitado: true, precio: "20000", duracionMinutos: null, sena: null, reservableOnline: true });
    await crearRecurso(db, M, O, centro, { tipoRecursoId: sillon.id, nombre: "Sillón 1" });
    await guardarHorarioSede(db, M, O, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana" })).id;
    const bea = (await crearProfesional(db, M, O, centro, { nombre: "Bea" })).id;
    const caro = (await crearProfesional(db, M, O, centro, { nombre: "Caro" })).id;
    const dora = (await crearProfesional(db, M, O, a.norte.id, { nombre: "Dora" })).id;
    for (const p of [ana, bea]) await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [manos, pies] });
    await guardarHabilidades(db, M, O, caro, { skillIds: [], servicioIds: [manos] });
    for (const p of [ana, bea, caro]) await guardarHorarioProfesional(db, M, O, p, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    const lucia = (await crearCliente(db, R, O, centro, { nombre: "Lucía", telefono: "1144445555" }))!.id;
    const fila = async (id: string, ahora: Date) => (await tableroSede(db, R, O, centro, ahora)).profesionales.find(p => p.id === id)!;

    await t.test("presencia: recepción marca la entrada; una sola abierta por profesional", async () => {
      await registrarEntrada(db, R, O, { sedeId: centro, profesionalId: ana }, en("09:00"));
      await assert.rejects(registrarEntrada(db, R, O, { sedeId: centro, profesionalId: ana }, en("09:01")), /Ya está marcada como presente/);
      await assert.rejects(registrarEntrada(db, R, O, { sedeId: centro, profesionalId: dora }, en("09:01")), /no trabaja en esta sede/);
      await assert.rejects(registrarEntrada(db, a.profesional.id, O, { sedeId: centro, profesionalId: bea }, en("09:01")), AccesoDenegado);
      await assert.rejects(registrarEntrada(db, R, O, { sedeId: a.sur.id, profesionalId: bea }, en("09:01")), AccesoDenegado);
      // Dos recepcionistas marcan a Bea a la vez: entra una sola presencia.
      const r = await Promise.allSettled([db, db2].map(c => registrarEntrada(c, R, O, { sedeId: centro, profesionalId: bea }, en("09:02"))));
      assert.deepEqual(r.map(x => x.status).sort(), ["fulfilled", "rejected"]);
      assert.equal(await db.presenciaProfesional.count({ where: { profesionalId: bea, salida: null } }), 1);

      const tablero = await tableroSede(db, R, O, centro, en("09:05"));
      assert.deepEqual(tablero.profesionales.map(p => [p.nombre, !!p.presencia, p.atencion, p.proximo]), [["Ana", true, null, null], ["Bea", true, null, null], ["Caro", false, null, null]]);
      assert.deepEqual((await fila(caro, en("09:05"))).servicioIds, [manos], "Caro no hace pies");
      assert.deepEqual(tablero.servicios.map(s => [s.nombre, s.duracionMinutos]), [["Manos", 60], ["Pies", 45]]);
      await assert.rejects(tableroSede(db, R, O, a.sur.id, en("09:05")), AccesoDenegado);
    });

    let primera = "";
    await t.test("despacho sin turno: la profesional queda atendiendo hasta «Terminó», que libera la agenda", async () => {
      primera = (await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: manos, profesionalId: ana }] }, en("10:00"))).reservaId;
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: primera } })).iniciadaEn?.toISOString(), en("10:00").toISOString());
      const enAtencion = await fila(ana, en("11:15"));
      assert.deepEqual([enAtencion.atencion?.reservaId, enAtencion.atencion?.servicios, enAtencion.atencion?.finEstimado.toISOString()], [primera, ["Manos"], en("11:00").toISOString()],
        "pasada del estimado sigue atendiendo (demorada) hasta que recepción marque «Terminó»");
      await assert.rejects(registrarSalida(db, R, O, enAtencion.presencia!.id, en("10:30")), /clienta en atención/);
      await assert.rejects(atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: manos, profesionalId: ana }] }, en("10:41")), ocupada);

      await assert.rejects(terminarAtencion(db, a.profesional.id, O, primera, en("10:40")), AccesoDenegado);
      await terminarAtencion(db, R, O, primera, en("10:40"));
      const r = await db.reserva.findUniqueOrThrow({ where: { id: primera }, include: { items: true, eventos: { orderBy: { orden: "asc" } } } });
      assert.deepEqual([r.estado, r.terminadaEn?.toISOString(), r.items[0]!.fin.toISOString(), r.items[0]!.ocupaHasta.toISOString()], ["ATENDIDA", en("10:40").toISOString(), en("10:40").toISOString(), en("10:40").toISOString()]);
      assert.equal(r.eventos.at(-1)!.tipo, "ATENDIDA");
      await assert.rejects(terminarAtencion(db, R, O, primera, en("10:41")), /atendido/);
      // Ana queda libre en el acto: se la puede despachar otra vez a las 10:41 (antes estaba tomada hasta las 11).
      assert.equal((await fila(ana, en("10:41"))).atencion, null);
      const otra = await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: manos, profesionalId: ana }] }, en("10:41"));
      await terminarAtencion(db, R, O, otra.reservaId, en("11:50"));
      assert.equal((await db.reservaItem.findFirstOrThrow({ where: { reservaId: otra.reservaId } })).fin.toISOString(), en("11:41").toISOString(), "un servicio ya terminado en la agenda no cambia");
    });

    await t.test("encadenados: lo que no empezó se quita del turno y libera profesional y sillón", async () => {
      const r = await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: pies, profesionalId: bea }, { servicioId: manos, profesionalId: bea }] }, en("12:00"));
      await assert.rejects(atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: pies, profesionalId: ana }] }, en("12:31")), ocupada, "el sillón está tomado");
      await terminarAtencion(db, R, O, r.reservaId, en("12:30"));
      const items = await db.reservaItem.findMany({ where: { reservaId: r.reservaId }, include: { recursos: true } });
      assert.deepEqual(items.map(i => [i.servicioId, i.fin.toISOString(), i.recursos[0]?.ocupaHasta.toISOString()]), [[pies, en("12:30").toISOString(), en("12:30").toISOString()]]);
      const ev = await db.reservaEvento.findFirstOrThrow({ where: { reservaId: r.reservaId, tipo: "ATENDIDA" } });
      assert.deepEqual((ev.detalle as { quitados: { servicioId: string }[] }).quitados.map(q => q.servicioId), [manos]);
      await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: pies, profesionalId: ana }] }, en("12:31"));
    });

    await t.test("clienta con turno: por llegar, «Llegó» y «Terminó» después de su horario", async () => {
      const turno = await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: manos, profesionalId: caro }], inicio: en("15:00") }, en("08:00"));
      const antes = await tableroSede(db, R, O, centro, en("14:30"));
      assert.deepEqual(antes.porLlegar.map(p => p.reservaId), [turno.reservaId]);
      assert.equal(antes.profesionales.find(p => p.id === caro)!.proximo?.inicio.toISOString(), en("15:00").toISOString(), "Caro está libre hasta las 15");
      await assert.rejects(marcarLlegada(db, R, O, turno.reservaId, en("13:50")), /más de una hora/);
      await marcarLlegada(db, R, O, turno.reservaId, en("14:30"));
      await assert.rejects(marcarLlegada(db, R, O, turno.reservaId, en("14:31")), /ya está en atención/);
      const despues = await tableroSede(db, R, O, centro, en("14:31"));
      assert.deepEqual([despues.porLlegar.length, despues.profesionales.find(p => p.id === caro)!.atencion?.desde.toISOString()], [0, en("14:30").toISOString()]);
      await assert.rejects(terminarAtencion(db, R, O, turno.reservaId, en("14:50")), /todavía no empezó en la agenda/);
      await terminarAtencion(db, R, O, turno.reservaId, en("15:40"));
      const r = await db.reserva.findUniqueOrThrow({ where: { id: turno.reservaId } });
      assert.deepEqual([r.iniciadaEn?.toISOString(), r.terminadaEn?.toISOString()], [en("14:30").toISOString(), en("15:40").toISOString()]);
    });

    await t.test("por cobrar: atenciones terminadas sin venta; la venta las saca de la lista", async () => {
      const antes = (await tableroSede(db, R, O, centro, en("16:00"))).porCobrar;
      assert.equal(antes.length, 4);
      assert.equal(antes[0]!.reservaId, primera, "la más vieja primero");
      assert.deepEqual(antes[0]!.servicios, ["Manos · Ana"]);
      const item = await db.reservaItem.findFirstOrThrow({ where: { reservaId: primera } });
      await registrarVenta(db, R, O, { sedeId: centro, reservaId: primera, productos: [], claveIdempotencia: randomUUID(),
        servicios: [{ servicioId: manos, profesionalId: ana, reservaItemId: item.id }], cobros: [{ medio: "TARJETA_CREDITO", monto: "20000" }] });
      assert.deepEqual((await tableroSede(db, R, O, centro, en("16:00"))).porCobrar.map(p => p.reservaId), antes.slice(1).map(p => p.reservaId));
    });

    await t.test("salida: cierra la presencia; después se puede volver a marcar la entrada", async () => {
      assert.equal((await fila(caro, en("16:00"))).presencia, null, "Caro nunca marcó la entrada");
      const ana16 = await fila(ana, en("16:00"));
      await assert.rejects(registrarSalida(db, R, O, ana16.presencia!.id, en("16:00")), /clienta en atención/, "sigue con la clienta de pies de las 12:31");
      await terminarAtencion(db, R, O, ana16.atencion!.reservaId, en("16:00"));
      await registrarSalida(db, R, O, ana16.presencia!.id, en("16:05"));
      await assert.rejects(registrarSalida(db, R, O, ana16.presencia!.id, en("16:06")), /ya está marcada/);
      assert.equal((await fila(ana, en("16:06"))).presencia, null);
      await registrarEntrada(db, R, O, { sedeId: centro, profesionalId: ana }, en("17:00"));
      assert.equal(await db.presenciaProfesional.count({ where: { profesionalId: ana } }), 2, "turno mañana y turno tarde");
    });

    await t.test("a la vez (etapa 2): manos y pies con dos profesionales; «Terminó» por profesional", async () => {
      const r = await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: manos, profesionalId: ana }, { servicioId: pies, profesionalId: bea, conAnterior: true }] }, en("18:00"));
      assert.deepEqual(r.items.map(i => [i.profesionalId, i.inicio.toISOString()]), [[ana, en("18:00").toISOString()], [bea, en("18:00").toISOString()]]);
      await assert.rejects(atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: manos, profesionalId: caro }, { servicioId: manos, profesionalId: caro, conAnterior: true }] }, en("18:01")), ocupada, "una profesional no hace dos cosas a la vez");
      const antes = await tableroSede(db, R, O, centro, en("18:20"));
      assert.deepEqual([ana, bea].map(id => antes.profesionales.find(p => p.id === id)!.atencion?.reservaId), [r.reservaId, r.reservaId]);

      // Bea termina los pies: queda libre (y el sillón también), Ana sigue con las manos.
      await terminarAtencion(db, R, O, r.reservaId, en("18:30"), { profesionalId: bea });
      const medio = await tableroSede(db, R, O, centro, en("18:31"));
      assert.deepEqual([ana, bea].map(id => medio.profesionales.find(p => p.id === id)!.atencion?.reservaId ?? null), [r.reservaId, null]);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: r.reservaId } })).estado, "CONFIRMADA", "todavía no está por cobrar");
      assert.ok(!medio.porCobrar.some(p => p.reservaId === r.reservaId));
      await assert.rejects(terminarAtencion(db, R, O, r.reservaId, en("18:32"), { profesionalId: bea }), /no tiene servicios pendientes/);
      const otra = await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: pies, profesionalId: bea }] }, en("18:31"));

      // Ana termina: el turno pasa a atendido y queda por cobrar.
      await terminarAtencion(db, R, O, r.reservaId, en("18:50"), { profesionalId: ana });
      const fin = await db.reserva.findUniqueOrThrow({ where: { id: r.reservaId }, include: { items: { orderBy: { posicion: "asc" } } } });
      assert.deepEqual([fin.estado, fin.terminadaEn?.toISOString(), ...fin.items.map(i => i.terminadoEn?.toISOString())], ["ATENDIDA", en("18:50").toISOString(), en("18:50").toISOString(), en("18:30").toISOString()]);
      assert.ok((await tableroSede(db, R, O, centro, en("18:51"))).porCobrar.some(p => p.reservaId === r.reservaId));
      await terminarAtencion(db, R, O, otra.reservaId, en("19:20"));
    });

    await t.test("a la vez: el portal no lo ofrece y reprogramar lo conserva", async () => {
      await assert.rejects(tomarTurno(db, null, O, { sedeId: centro, fecha: FECHA, canal: "ONLINE", items: [{ servicioId: manos }, { servicioId: pies, conAnterior: true }], inicio: en("20:00") }, en("08:00")), /en recepción/);
      const turno = await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: manos }, { servicioId: pies, conAnterior: true }], inicio: en("20:00") }, en("08:00"));
      assert.equal(new Set(turno.items.map(i => i.profesionalId)).size, 2, "«cualquiera» elige dos profesionales distintas");
      const nueva = await reprogramarReserva(db, R, O, turno.reservaId, { fecha: FECHA, inicio: en("20:30") }, en("08:00"));
      assert.deepEqual(nueva.items.map(i => i.inicio.toISOString()), [en("20:30").toISOString(), en("20:30").toISOString()]);
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
