import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente, publicarConsentimiento } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { agendaSede, asignarClienteReserva, atenderAhora, cancelarReserva, terminarAtencion, tomarTurno } from "../src/reservas.ts";
import { agregarEspera, esperaSeFue, registrarEntrada, sentarEspera, tableroSede } from "../src/tablero.ts";
import { prepararVenta } from "../src/ventas.ts";
import { crearFixture } from "../prisma/fixture.ts";

// Universos, etapa 2 (doc 31): sentar desde el tablero a una clienta en espera, con ficha o con solo el nombre.

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-20";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const YA_NO = /ya no está en la lista de espera/;

test("sentar desde la espera (doc 31, etapa 2)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const db2 = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id;
    const centro = a.centro.id;

    await publicarConsentimiento(db, M, O, { tipo: "PRACTICA", clave: "semi", titulo: "Semipermanente", texto: "Consentimiento de práctica para el esmaltado semipermanente." });
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "NINGUNA" as const, valor: null }, activo: true, consentimientos: [] as string[], skillIds: [], recursos: [] };
    const manos = (await guardarServicio(db, M, O, { ...base, nombre: "Manos", duracionMinutos: 60 }))!.id;
    const pies = (await guardarServicio(db, M, O, { ...base, nombre: "Pies", duracionMinutos: 45 }))!.id;
    const semi = (await guardarServicio(db, M, O, { ...base, nombre: "Semi", duracionMinutos: 60, consentimientos: ["semi"] }))!.id;
    for (const s of [manos, pies, semi]) await guardarServicioSede(db, M, O, centro, s, { habilitado: true, precio: "20000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana" })).id;
    const bea = (await crearProfesional(db, M, O, centro, { nombre: "Bea" })).id;
    const caro = (await crearProfesional(db, M, O, centro, { nombre: "Caro" })).id;
    for (const p of [ana, bea, caro]) {
      await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [manos, pies, semi] });
      await guardarHorarioProfesional(db, M, O, p, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    }
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    const lucia = (await crearCliente(db, R, O, centro, { nombre: "Lucía", telefono: "1144445555" }))!.id;
    const ajena = (await crearCliente(db, b.recepcion.id, b.org.id, b.centro.id, { nombre: "Ajena", telefono: "1199990000" }))!.id;
    const tablero = (ahora: Date) => tableroSede(db, R, O, centro, ahora);
    const fila = async (id: string, ahora: Date) => (await tablero(ahora)).profesionales.find(p => p.id === id)!;
    const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
    const franja = (x: { desde: Date; hasta: Date; tipo: string }[]) => x.map(o => [o.tipo, iso(o.desde), iso(o.hasta)]);
    await registrarEntrada(db, R, O, { sedeId: centro, profesionalId: ana }, en("08:50"));
    await registrarEntrada(db, R, O, { sedeId: centro, profesionalId: bea }, en("08:55"));

    await t.test("con ficha: el turno queda a nombre del cliente y cierra la espera; libreDesde después de «Terminó»", async () => {
      await assert.rejects(agregarEspera(db, R, O, { sedeId: centro, nombre: "Ajena", servicioIds: [manos], clienteId: ajena }, en("09:00")), AccesoDenegado, "cliente de otra organización");
      const espera = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Lucía", telefono: "1144445555", servicioIds: [manos], clienteId: lucia }, en("09:00"));
      assert.deepEqual((await tablero(en("09:05"))).esperas.map(e => [e.nombre, e.cliente]), [["Lucía", { id: lucia, nombre: "Lucía", apellido: null }]]);

      const turno = await sentarEspera(db, R, O, { esperaId: espera.id, items: [{ servicioId: manos, profesionalId: ana }] }, en("09:10"));
      const r = await db.reserva.findUniqueOrThrow({ where: { id: turno.reservaId }, include: { eventos: true } });
      assert.deepEqual([r.clienteId, r.clienteProvisional, r.sinTurnoPrevio, r.canal, r.estado, iso(r.iniciadaEn)], [lucia, null, true, "RECEPCION", "CONFIRMADA", en("09:10").toISOString()]);
      assert.equal((r.eventos[0]!.detalle as { esperaId?: string }).esperaId, espera.id);
      const cerrada = await db.esperaRecepcion.findUniqueOrThrow({ where: { id: espera.id } });
      assert.deepEqual([cerrada.estado, cerrada.reservaId, iso(cerrada.cerradaEn)], ["ATENDIDA", turno.reservaId, en("09:10").toISOString()]);

      const enAtencion = await tablero(en("09:20"));
      const anaAhora = enAtencion.profesionales.find(p => p.id === ana)!;
      assert.deepEqual([anaAhora.atencion?.cliente?.id, anaAhora.atencion?.clienteProvisional, anaAhora.libreDesde], [lucia, null, null]);
      assert.deepEqual(franja(anaAhora.agenda), [["atencion", en("09:20").toISOString(), en("10:10").toISOString()]], "la atención en curso, desde ahora");
      assert.deepEqual(enAtencion.esperas, []);

      await terminarAtencion(db, R, O, turno.reservaId, en("10:00"));
      const libres = await tablero(en("10:05"));
      const de = (id: string) => libres.profesionales.find(p => p.id === id)!;
      assert.deepEqual([ana, bea, caro].map(id => iso(de(id).libreDesde)), [en("10:00").toISOString(), en("08:55").toISOString(), null], "el último «Terminó», la entrada o nada");
      assert.deepEqual(de(ana).agenda, []);
    });

    let mora = "";
    await t.test("sin ficha: el turno queda con el nombre provisional; tablero, agenda, cobro y después la ficha", async () => {
      const espera = await agregarEspera(db, R, O, { sedeId: centro, nombre: " Mora ", telefono: "1155556666", servicioIds: [manos] }, en("10:10"));
      assert.equal((await tablero(en("10:11"))).esperas[0]!.cliente, null);
      mora = (await sentarEspera(db, R, O, { esperaId: espera.id, items: [{ servicioId: manos, profesionalId: bea }] }, en("10:15"))).reservaId;
      const r = await db.reserva.findUniqueOrThrow({ where: { id: mora } });
      assert.deepEqual([r.clienteId, r.clienteProvisional, r.sinTurnoPrevio], [null, "Mora", true]);

      const beaAhora = await fila(bea, en("10:20"));
      assert.deepEqual([beaAhora.atencion?.cliente, beaAhora.atencion?.clienteProvisional], [null, "Mora"]);
      assert.deepEqual(franja(beaAhora.agenda), [["atencion", en("10:20").toISOString(), en("11:15").toISOString()]]);
      const agenda = await agendaSede(db, R, O, { sedeId: centro, desde: FECHA, dias: 1 }, en("10:20"));
      assert.deepEqual(agenda.items.filter(i => i.reservaId === mora).map(i => [i.cliente, i.clienteProvisional]), [[null, "Mora"]]);

      await terminarAtencion(db, R, O, mora, en("11:00"));
      const porCobrar = (await tablero(en("11:01"))).porCobrar.find(p => p.reservaId === mora)!;
      assert.deepEqual([porCobrar.cliente, porCobrar.clienteProvisional], [null, "Mora"]);
      const prep = await prepararVenta(db, R, O, centro, mora);
      assert.deepEqual([prep.turno?.cliente, prep.turno?.clienteProvisional, prep.turno?.espera], [null, "Mora", { nombre: "Mora", telefono: "1155556666" }]);
      const conFicha = await prepararVenta(db, R, O, centro, (await db.esperaRecepcion.findFirstOrThrow({ where: { organizacionId: O, nombre: "Lucía" } })).reservaId);
      assert.deepEqual([conFicha.turno?.clienteProvisional, conFicha.turno?.espera?.nombre], [null, "Lucía"]);

      // Al cobrar, recepción le crea la ficha (desde otra sede, para ver el vínculo) y se la asigna al turno.
      const ficha = (await crearCliente(db, R, O, a.norte.id, { nombre: "Mora", telefono: "1155556666" }))!.id;
      await assert.rejects(asignarClienteReserva(db, R, O, mora, ajena, en("11:05")), AccesoDenegado, "cliente de otra organización");
      await assert.rejects(asignarClienteReserva(db, a.profesional.id, O, mora, ficha, en("11:05")), AccesoDenegado);
      await assert.rejects(asignarClienteReserva(db, b.recepcion.id, b.org.id, mora, ajena, en("11:05")), AccesoDenegado, "turno de otra organización");
      await asignarClienteReserva(db, R, O, mora, ficha, en("11:05"));
      const asignada = await db.reserva.findUniqueOrThrow({ where: { id: mora } });
      assert.deepEqual([asignada.clienteId, asignada.clienteProvisional, asignada.estado], [ficha, null, "ATENDIDA"]);
      assert.equal(await db.clienteSede.count({ where: { clienteId: ficha, sedeId: centro } }), 1, "queda vinculada a la sede del turno");
      const log = await db.auditLog.findFirstOrThrow({ where: { organizacionId: O, accion: "reserva.cliente_asignado", entidadId: mora } });
      assert.deepEqual(log.datos, { clienteId: ficha, sinFicha: true });
      await assert.rejects(asignarClienteReserva(db, R, O, mora, lucia, en("11:06")), /ya tiene cliente/);
      const ahora = (await tablero(en("11:07"))).porCobrar.find(p => p.reservaId === mora)!;
      assert.deepEqual([ahora.cliente?.id, ahora.clienteProvisional], [ficha, null]);
    });

    await t.test("sin ficha no se sienta un servicio que exige consentimiento de práctica", async () => {
      const espera = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Nina", servicioIds: [semi] }, en("11:02"));
      const antes = await db.reserva.count({ where: { organizacionId: O } });
      await assert.rejects(sentarEspera(db, R, O, { esperaId: espera.id, items: [{ servicioId: semi, profesionalId: ana }] }, en("11:03")), /consentimiento.*ficha/);
      assert.equal(await db.reserva.count({ where: { organizacionId: O } }), antes);
      assert.equal((await db.esperaRecepcion.findUniqueOrThrow({ where: { id: espera.id } })).estado, "ESPERANDO");
      await esperaSeFue(db, R, O, espera.id, en("11:04"));
    });

    await t.test("dos servicios a la vez, con profesionales distintas", async () => {
      const espera = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Olga", servicioIds: [manos, pies] }, en("11:05"));
      const sentar = (items: { servicioId: string; profesionalId: string }[]) => sentarEspera(db, R, O, { esperaId: espera.id, items }, en("11:10"));
      await assert.rejects(sentar([{ servicioId: manos, profesionalId: ana }, { servicioId: pies, profesionalId: ana }]), /profesionales distintas/);
      await assert.rejects(sentar([{ servicioId: manos, profesionalId: ana }, { servicioId: manos, profesionalId: caro }]), /dos veces el mismo servicio/);
      await assert.rejects(sentar([{ servicioId: semi, profesionalId: ana }]), /de los que pidió/);
      await assert.rejects(sentar([]), /al menos un servicio/);
      await assert.rejects(sentar([{ servicioId: manos, profesionalId: "" }]), /profesional de cada servicio/);
      const turno = await sentar([{ servicioId: manos, profesionalId: ana }, { servicioId: pies, profesionalId: caro }]);
      assert.deepEqual(turno.items.map(i => [i.servicioId, i.profesionalId, iso(i.inicio)]), [[manos, ana, en("11:10").toISOString()], [pies, caro, en("11:10").toISOString()]]);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: turno.reservaId } })).clienteProvisional, "Olga");
      assert.equal((await db.esperaRecepcion.findUniqueOrThrow({ where: { id: espera.id } })).estado, "ATENDIDA");
      await terminarAtencion(db, R, O, turno.reservaId, en("12:00"));
    });

    let pia = "";
    await t.test("sentado parcial: la espera sigue con lo que falta y conserva la llegada", async () => {
      const espera = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Pía", telefono: "1177778888", servicioIds: [manos, pies] }, en("12:05"));
      const primero = await sentarEspera(db, R, O, { esperaId: espera.id, items: [{ servicioId: pies, profesionalId: bea }] }, en("12:10"));
      const abierta = await db.esperaRecepcion.findUniqueOrThrow({ where: { id: espera.id } });
      assert.deepEqual([abierta.estado, abierta.servicioIds, iso(abierta.llegada), abierta.reservaId], ["ESPERANDO", [manos], en("12:05").toISOString(), null]);
      assert.deepEqual((await tablero(en("12:11"))).esperas.map(e => [e.nombre, e.servicioIds, iso(e.llegada)]), [["Pía", [manos], en("12:05").toISOString()]]);
      // El cobro del primer turno igual encuentra la espera de la que vino.
      assert.deepEqual((await prepararVenta(db, R, O, centro, primero.reservaId)).turno?.espera, { nombre: "Pía", telefono: "1177778888" });
      await assert.rejects(sentarEspera(db, R, O, { esperaId: espera.id, items: [{ servicioId: pies, profesionalId: ana }] }, en("12:12")), /de los que pidió/, "los pies ya se sentaron");

      // Etapa 3b (doc 31): una sola comanda por visita. Lo que se sienta después se suma al turno en curso.
      const segundo = await sentarEspera(db, R, O, { esperaId: espera.id, items: [{ servicioId: manos, profesionalId: ana }] }, en("12:15"));
      pia = segundo.reservaId;
      assert.equal(segundo.reservaId, primero.reservaId);
      assert.deepEqual(segundo.items.map(i => [i.servicioId, i.profesionalId, iso(i.inicio)]), [[pies, bea, en("12:10").toISOString()], [manos, ana, en("12:15").toISOString()]]);
      const cerrada = await db.esperaRecepcion.findUniqueOrThrow({ where: { id: espera.id } });
      assert.deepEqual([cerrada.estado, cerrada.reservaId, cerrada.servicioIds], ["ATENDIDA", primero.reservaId, [manos]]);
      assert.deepEqual(await db.reserva.findMany({ where: { id: { in: [primero.reservaId, segundo.reservaId] } }, select: { clienteProvisional: true } }), [{ clienteProvisional: "Pía" }]);
      await terminarAtencion(db, R, O, primero.reservaId, en("13:20"));
    });

    await t.test("dos recepcionistas sientan a la misma clienta a la vez: entra un solo turno", async () => {
      const espera = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Rita", servicioIds: [manos] }, en("13:25"));
      const antes = await db.reserva.count({ where: { organizacionId: O } });
      const r = await Promise.allSettled([[db, ana], [db2, bea]].map(([c, p]) => sentarEspera(c as typeof db, R, O, { esperaId: espera.id, items: [{ servicioId: manos, profesionalId: p as string }] }, en("13:30"))));
      assert.deepEqual(r.map(x => x.status).sort(), ["fulfilled", "rejected"]);
      const rechazo = r.find(x => x.status === "rejected") as PromiseRejectedResult;
      assert.ok(rechazo.reason instanceof DatosInvalidos && YA_NO.test(rechazo.reason.message), String(rechazo.reason));
      assert.equal(await db.reserva.count({ where: { organizacionId: O } }), antes + 1);
      const ganador = (r.find(x => x.status === "fulfilled") as PromiseFulfilledResult<{ reservaId: string }>).value.reservaId;
      assert.equal((await db.esperaRecepcion.findUniqueOrThrow({ where: { id: espera.id } })).reservaId, ganador);
      await terminarAtencion(db, R, O, ganador, en("14:00"));

      // Se fue antes de que la sentaran: no se crea nada.
      const uma = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Uma", servicioIds: [manos] }, en("14:01"));
      await esperaSeFue(db, R, O, uma.id, en("14:02"));
      await assert.rejects(sentarEspera(db, R, O, { esperaId: uma.id, items: [{ servicioId: manos, profesionalId: ana }] }, en("14:03")), YA_NO);
      assert.equal(await db.reserva.count({ where: { organizacionId: O } }), antes + 1);
    });

    let xime = "";
    await t.test("franja de las próximas dos horas y nombre provisional en los turnos por llegar", async () => {
      const turnoAna = await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: manos, profesionalId: ana }], inicio: en("15:00") }, en("08:00"));
      await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: manos, profesionalId: bea }], inicio: en("16:00") }, en("08:00"));
      // La reserva manual también puede quedar con solo el nombre si se lo pide explícitamente.
      xime = (await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteProvisional: "Xime", items: [{ servicioId: manos, profesionalId: caro }], inicio: en("16:00") }, en("08:00"))).reservaId;
      const wen = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Wen", servicioIds: [manos] }, en("14:10"));
      await sentarEspera(db, R, O, { esperaId: wen.id, items: [{ servicioId: manos, profesionalId: caro }] }, en("14:15"));

      const x = await tablero(en("14:20"));
      const de = (id: string) => x.profesionales.find(p => p.id === id)!;
      assert.deepEqual(franja(de(ana).agenda), [["turno", en("15:00").toISOString(), en("16:00").toISOString()]]);
      assert.deepEqual(franja(de(bea).agenda), [["turno", en("16:00").toISOString(), en("16:20").toISOString()]], "recortada al final de la ventana");
      assert.deepEqual(franja(de(caro).agenda), [["atencion", en("14:20").toISOString(), en("15:15").toISOString()], ["turno", en("16:00").toISOString(), en("16:20").toISOString()]]);
      assert.equal(de(ana).proximo?.reservaId, turnoAna.reservaId, "el próximo turno no cambia");
      assert.equal(de(caro).libreDesde, null, "atiende");
      const llegan = x.porLlegar.filter(r => r.reservaId === xime || r.reservaId === turnoAna.reservaId).map(r => [r.cliente?.id ?? null, r.clienteProvisional]);
      assert.deepEqual(llegan, [[lucia, null], [null, "Xime"]]);
    });

    await t.test("asignarClienteReserva: no en un turno cancelado", async () => {
      await cancelarReserva(db, R, O, xime, "No viene", en("14:30"));
      await assert.rejects(asignarClienteReserva(db, R, O, xime, lucia, en("14:31")), /cancelado/);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: xime } })).clienteProvisional, "Xime");
      // Un turno en curso o atendido sin ficha, sí (Pía ya está atendida).
      await asignarClienteReserva(db, R, O, pia, lucia, en("14:32"));
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: pia } })).clienteId, lucia);
    });

    await t.test("permisos: rol profesional, otra sede, otra organización", async () => {
      const sara = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Sara", servicioIds: [manos] }, en("14:40"));
      const item = [{ servicioId: manos, profesionalId: ana }];
      await assert.rejects(sentarEspera(db, a.profesional.id, O, { esperaId: sara.id, items: item }, en("14:41")), AccesoDenegado);
      await assert.rejects(sentarEspera(db, b.recepcion.id, b.org.id, { esperaId: sara.id, items: item }, en("14:41")), AccesoDenegado, "espera de otra organización");
      await assert.rejects(sentarEspera(db, b.recepcion.id, O, { esperaId: sara.id, items: item }, en("14:41")), AccesoDenegado, "sin membresía en la organización");
      // Una espera de Sur: la recepcionista solo tiene Centro y Norte.
      await guardarServicioSede(db, M, O, a.sur.id, manos, { habilitado: true, precio: "20000", duracionMinutos: null, sena: null, reservableOnline: true });
      const enSur = await agregarEspera(db, M, O, { sedeId: a.sur.id, nombre: "Tina", servicioIds: [manos] }, en("14:40"));
      await assert.rejects(sentarEspera(db, R, O, { esperaId: enSur.id, items: item }, en("14:41")), AccesoDenegado, "otra sede");
      assert.equal((await db.esperaRecepcion.findUniqueOrThrow({ where: { id: sara.id } })).estado, "ESPERANDO");
      await esperaSeFue(db, R, O, sara.id, en("14:42"));
    });

    await t.test("«Atender ahora» y la reserva manual siguen exigiendo cliente; el portal no acepta nombre provisional", async () => {
      await assert.rejects(atenderAhora(db, R, O, { sedeId: centro, clienteId: "", items: [{ servicioId: manos, profesionalId: bea }] }, en("14:50")), /Elegí o creá el cliente/);
      await assert.rejects(tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", items: [{ servicioId: manos, profesionalId: bea }], inicio: en("18:00") }, en("08:00")), /Elegí el cliente/);
      await assert.rejects(tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteProvisional: "   ", items: [{ servicioId: manos, profesionalId: bea }], inicio: en("18:00") }, en("08:00")), /Elegí el cliente/);
      await assert.rejects(tomarTurno(db, null, O, { sedeId: centro, fecha: FECHA, canal: "ONLINE", clienteProvisional: "Yael", items: [{ servicioId: manos }], inicio: en("18:00") }, en("08:00")), AccesoDenegado);
    });

    await t.test("CHECK: nunca cliente y nombre provisional a la vez; largo entre 1 y 80", async () => {
      await assert.rejects(db.reserva.update({ where: { id: mora }, data: { clienteProvisional: "Mora" } }), /Reserva_cliente_provisional/);
      await assert.rejects(db.reserva.update({ where: { id: xime }, data: { clienteProvisional: "   " } }), /Reserva_cliente_provisional/);
      await assert.rejects(db.reserva.update({ where: { id: xime }, data: { clienteProvisional: "x".repeat(81) } }), /Reserva_cliente_provisional/);
      await db.reserva.update({ where: { id: xime }, data: { clienteProvisional: "x".repeat(80) } });
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
