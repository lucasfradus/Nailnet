import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion, configurarSenaRecepcion } from "../src/configuracion.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { TurnoNoDisponible, agendaSede, tomarTurno } from "../src/reservas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");

test("reserva manual en recepción y agenda (R01)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id;
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 10, activo: true, consentimientos: [], skillIds: [], recursos: [] };
    const conSena = (await guardarServicio(db, M, O, { ...base, nombre: "Semi", duracionMinutos: 50, sena: { tipo: "PORCENTAJE", valor: "30" } }))!.id;
    const sinSena = (await guardarServicio(db, M, O, { ...base, nombre: "Retiro", duracionMinutos: 20, sena: { tipo: "NINGUNA", valor: null } }))!.id;
    for (const s of [conSena, sinSena]) await guardarServicioSede(db, M, O, a.centro.id, s, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "09:00-20:00" }));
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana" })).id;
    const bea = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Bea" })).id;
    for (const p of [ana, bea]) {
      await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [conSena, sinSena] });
      await guardarHorarioProfesional(db, M, O, p, a.centro.id, semanaDesdeTextos({ 2: "09:00-18:00" }));
    }
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    // Clienta dada de alta en Norte: al reservar en Centro queda vinculada también ahí.
    const lucia = (await crearCliente(db, M, O, a.norte.id, { nombre: "Lucía", telefono: "1144445555" }))!.id;
    const pedido = (extra: object = {}) => ({ sedeId: a.centro.id, fecha: FECHA, canal: "RECEPCION" as const, clienteId: lucia, items: [{ servicioId: conSena, profesionalId: ana }], inicio: en("10:00"), ...extra });

    await t.test("D6 por defecto: recepción confirma directo, sin vencimiento", async () => {
      const r = await tomarTurno(db, a.recepcion.id, O, { ...pedido(), notas: "Primera vez" }, ahora);
      assert.deepEqual([r.estado, r.expiraEn], ["CONFIRMADA", null]);
      assert.equal(r.items[0]!.sena, "9000.00", "la seña queda como snapshot aunque no se cobre");
      assert.equal(await db.clienteSede.count({ where: { clienteId: lucia, sedeId: a.centro.id } }), 1);
      const ev = await db.reservaEvento.findMany({ where: { reservaId: r.reservaId } });
      assert.deepEqual(ev.map(e => [e.tipo, e.estadoNuevo, e.actorId]), [["CREADA", "CONFIRMADA", a.recepcion.id]]);
      await assert.rejects(db.reservaEvento.delete({ where: { id: ev[0]!.id } }), "historial inmutable");
      await assert.rejects(tomarTurno(db, a.recepcion.id, O, pedido(), ahora), TurnoNoDisponible);
    });

    await t.test("la sede puede exigir seña también en recepción (D6): pendiente 15 min (D4)", async () => {
      await configurarSenaRecepcion(db, a.admin.id, O, a.centro.id, true);
      const r = await tomarTurno(db, a.recepcion.id, O, pedido({ inicio: en("11:00") }), ahora);
      assert.equal(r.estado, "PENDIENTE_PAGO");
      assert.equal(r.expiraEn!.getTime() - ahora.getTime(), 15 * 60_000);
      // Un servicio sin seña se confirma igual.
      const s = await tomarTurno(db, a.recepcion.id, O, pedido({ items: [{ servicioId: sinSena, profesionalId: bea }], inicio: en("11:00") }), ahora);
      assert.equal(s.estado, "CONFIRMADA");
      await assert.rejects(configurarSenaRecepcion(db, a.recepcion.id, O, a.centro.id, false), AccesoDenegado);
      await assert.rejects(configurarSenaRecepcion(db, a.admin.id, O, null, false), AccesoDenegado, "valor de organización: solo master");
      await configurarSenaRecepcion(db, a.admin.id, O, a.centro.id, null);
    });

    await t.test("online: con seña queda pendiente; sin seña se confirma", async () => {
      const online = await tomarTurno(db, null, O, pedido({ canal: "ONLINE", clienteId: null, items: [{ servicioId: conSena }], inicio: en("14:00") }), ahora);
      assert.equal(online.estado, "PENDIENTE_PAGO");
      const gratis = await tomarTurno(db, null, O, pedido({ canal: "ONLINE", clienteId: null, items: [{ servicioId: sinSena }], inicio: en("15:00") }), ahora);
      assert.equal(gratis.estado, "CONFIRMADA");
    });

    await t.test("validaciones de recepción", async () => {
      await assert.rejects(tomarTurno(db, a.recepcion.id, O, pedido({ clienteId: null, inicio: en("16:00") }), ahora), DatosInvalidos);
      await assert.rejects(tomarTurno(db, a.profesional.id, O, pedido({ inicio: en("16:00") }), ahora), AccesoDenegado);
      const b = await crearFixture(db);
      const ajeno = (await crearCliente(db, b.master.id, b.org.id, b.centro.id, { nombre: "Ajeno", telefono: "1199998888" }))!.id;
      await assert.rejects(tomarTurno(db, a.recepcion.id, O, pedido({ clienteId: ajeno, inicio: en("16:00") }), ahora), AccesoDenegado, "cliente de otra organización");
    });

    await t.test("agenda del día: orden, filtros, alcance y cerrados", async () => {
      let ag = await agendaSede(db, a.recepcion.id, O, { sedeId: a.centro.id, desde: FECHA, dias: 1 }, ahora);
      assert.equal(ag.items.length, 5);
      assert.deepEqual([ag.items[0]!.servicio, ag.items[0]!.profesional.nombre, ag.items[0]!.estado], ["Semi", "Ana", "CONFIRMADA"]);
      assert.deepEqual(ag.items.map(i => i.estado).sort(), ["CONFIRMADA", "CONFIRMADA", "CONFIRMADA", "PENDIENTE_PAGO", "PENDIENTE_PAGO"]);
      assert.ok(ag.items.every((x, k) => k === 0 || ag.items[k - 1]!.inicio <= x.inicio), "ordenada por hora");
      assert.equal(ag.items[0]!.cliente?.nombre, "Lucía");
      assert.equal(ag.items[0]!.notas, "Primera vez");
      const soloBea = await agendaSede(db, a.recepcion.id, O, { sedeId: a.centro.id, desde: FECHA, dias: 1, profesionalId: bea }, ahora);
      assert.ok(soloBea.items.every(i => i.profesional.id === bea));
      // Pasado el vencimiento, la pendiente desaparece de la agenda activa pero se ve con cerrados.
      const tarde = new Date(ahora.getTime() + 16 * 60_000);
      ag = await agendaSede(db, a.recepcion.id, O, { sedeId: a.centro.id, desde: FECHA, dias: 1 }, tarde);
      assert.ok(ag.items.every(i => i.estado !== "PENDIENTE_PAGO"));
      const todo = await agendaSede(db, a.recepcion.id, O, { sedeId: a.centro.id, desde: FECHA, dias: 7, incluirCerrados: true }, tarde);
      assert.ok(todo.items.length > ag.items.length);
      await assert.rejects(agendaSede(db, a.recepcion.id, O, { sedeId: a.sur.id, desde: FECHA, dias: 1 }, ahora), AccesoDenegado);
      await assert.rejects(agendaSede(db, a.recepcion.id, O, { sedeId: a.centro.id, desde: FECHA, dias: 3 }, ahora), DatosInvalidos);
    });
  } finally { await db.$disconnect(); }
});
