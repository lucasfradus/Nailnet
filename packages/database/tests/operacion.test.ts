import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente, publicarConsentimiento, registrarConsentimiento } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearBloqueo, crearExcepcion, crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { TurnoNoDisponible, cancelarReserva, historialReserva, marcarAtendida, marcarAusente, reprogramarReserva, tomarTurno } from "../src/reservas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");

test("operación del turno: cancelar, atender, ausente, reprogramar (R03)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id;
    const cat = (await crearCategoria(db, M, O, "Depilación"))!;
    await publicarConsentimiento(db, M, O, { tipo: "PRACTICA", clave: "laser", titulo: "Láser", texto: "Declaro conocer riesgos y cuidados de la depilación láser." });
    const laser = (await guardarServicio(db, M, O, { categoriaId: cat.id, nombre: "Láser", duracionMinutos: 30, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "PORCENTAJE", valor: "30" }, activo: true, consentimientos: ["laser"], skillIds: [], recursos: [] }))!.id;
    await guardarServicioSede(db, M, O, a.centro.id, laser, { habilitado: true, precio: "20000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "09:00-20:00" }));
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [], servicioIds: [laser] });
    await guardarHorarioProfesional(db, M, O, ana, a.centro.id, semanaDesdeTextos({ 2: "09:00-18:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30 });
    const cliente = (await crearCliente(db, M, O, a.centro.id, { nombre: "Sol", telefono: "1166667777" }))!.id;
    const tomar = (hhmm: string) => tomarTurno(db, R, O, { sedeId: a.centro.id, fecha: FECHA, canal: "RECEPCION", clienteId: cliente, items: [{ servicioId: laser, profesionalId: ana }], inicio: en(hhmm) }, ahora);

    await t.test("cancelar libera el horario, exige motivo y deja evento", async () => {
      const r = await tomar("09:00");
      await assert.rejects(cancelarReserva(db, R, O, r.reservaId, "  "), DatosInvalidos);
      await cancelarReserva(db, R, O, r.reservaId, "La clienta avisó por WhatsApp", ahora);
      await assert.rejects(cancelarReserva(db, R, O, r.reservaId, "otra vez", ahora), /cancelado/);
      const h = await historialReserva(db, R, O, r.reservaId);
      assert.deepEqual(h.eventos.map(e => e.tipo), ["CREADA", "CANCELADA"]);
      assert.match(JSON.stringify(h.eventos[1]!.detalle), /D5 pendiente/);
      await tomar("09:00"); // el horario quedó libre
    });

    await t.test("atendido exige estar cerca del horario y consentimiento vigente", async () => {
      const r = await tomar("10:00");
      await assert.rejects(marcarAtendida(db, R, O, r.reservaId, ahora), /más de una hora/);
      const cerca = new Date(en("10:00").getTime() - 30 * 60_000);
      await assert.rejects(marcarAtendida(db, R, O, r.reservaId, cerca), /Falta el consentimiento vigente: Láser/);
      const v = await db.consentimientoVersion.findFirstOrThrow({ where: { organizacionId: O, clave: "laser" } });
      await registrarConsentimiento(db, R, O, { clienteId: cliente, versionId: v.id, sedeId: a.centro.id, accion: "ACEPTA" });
      await marcarAtendida(db, R, O, r.reservaId, cerca);
      await assert.rejects(marcarAtendida(db, R, O, r.reservaId, cerca), /atendido/);
      await assert.rejects(cancelarReserva(db, R, O, r.reservaId, "x", cerca), /atendido/);
    });

    await t.test("ausente solo después del inicio", async () => {
      const r = await tomar("11:00");
      await assert.rejects(marcarAusente(db, R, O, r.reservaId, ahora), /no empezó/);
      await marcarAusente(db, R, O, r.reservaId, new Date(en("11:00").getTime() + 60_000));
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: r.reservaId } })).estado, "AUSENTE");
    });

    await t.test("reprogramar es atómico y conserva el precio pactado", async () => {
      const r = await tomar("12:00");
      await guardarServicioSede(db, M, O, a.centro.id, laser, { habilitado: true, precio: "25000", duracionMinutos: null, sena: null, reservableOnline: true });
      // Correrlo 15 minutos se solapa con su propio horario: válido porque se libera en la misma transacción.
      await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 15 });
      const nueva = await reprogramarReserva(db, R, O, r.reservaId, { fecha: FECHA, inicio: en("12:15") }, ahora);
      assert.equal(nueva.items[0]!.precio, "20000.00", "precio congelado");
      assert.equal(nueva.items[0]!.sena, "6000.00");
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: r.reservaId } })).estado, "CANCELADA");
      const h = await historialReserva(db, R, O, nueva.reservaId);
      assert.equal(h.reemplazaId, r.reservaId);
      assert.deepEqual((await historialReserva(db, R, O, r.reservaId)).eventos.map(e => e.tipo), ["CREADA", "REPROGRAMADA"]);
      // A un horario ocupado: falla y el turno queda como estaba.
      await assert.rejects(reprogramarReserva(db, R, O, nueva.reservaId, { fecha: FECHA, inicio: en("09:00") }, ahora), TurnoNoDisponible);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: nueva.reservaId } })).estado, "CONFIRMADA");
      await assert.rejects(reprogramarReserva(db, R, O, r.reservaId, { fecha: FECHA, inicio: en("15:00") }, ahora), /Solo se reprograman turnos confirmados/);
    });

    await t.test("dos reprogramaciones simultáneas del mismo turno: gana una", async () => {
      const r = await tomar("14:00");
      const res = await Promise.allSettled([
        reprogramarReserva(db, R, O, r.reservaId, { fecha: FECHA, inicio: en("15:00") }, ahora),
        reprogramarReserva(db, R, O, r.reservaId, { fecha: FECHA, inicio: en("16:00") }, ahora),
      ]);
      assert.equal(res.filter(x => x.status === "fulfilled").length, 1);
      assert.equal(await db.reserva.count({ where: { reemplazaId: r.reservaId } }), 1);
    });

    await t.test("cambios de calendario no dejan afuera turnos vigentes", async () => {
      await assert.rejects(guardarHorarioProfesional(db, M, O, ana, a.centro.id, semanaDesdeTextos({ 2: "13:00-18:00" })), /deja afuera/);
      await assert.rejects(crearBloqueo(db, M, O, ana, { inicio: en("09:00"), fin: en("09:30") }), /deja afuera 1 turno/);
      await assert.rejects(guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "10:00-20:00" })), /deja afuera/);
      await assert.rejects(crearExcepcion(db, M, O, { sedeId: a.centro.id, fecha: FECHA, rango: { inicio: 600, fin: 1200 }, motivo: "Abre tarde" }), /deja afuera/);
      // Un cambio que respeta los turnos se acepta.
      await guardarHorarioProfesional(db, M, O, ana, a.centro.id, semanaDesdeTextos({ 2: "09:00-19:00" }));
      await crearBloqueo(db, M, O, ana, { inicio: en("18:00"), fin: en("19:00") });
    });

    await t.test("alcance: otra sede no opera los turnos", async () => {
      const r = await tomar("17:00");
      const otra = await db.usuario.create({ data: { email: `r-sur-op-${O}@example.invalid`, nombre: "R", membresias: { create: { organizacionId: O } } } });
      await db.asignacionRol.create({ data: { organizacionId: O, usuarioId: otra.id, rol: "RECEPCIONISTA", alcance: "SEDE", sedeId: a.sur.id } });
      await assert.rejects(cancelarReserva(db, otra.id, O, r.reservaId, "x"), AccesoDenegado);
      await assert.rejects(reprogramarReserva(db, otra.id, O, r.reservaId, { fecha: FECHA, inicio: en("17:30") }), AccesoDenegado);
      await assert.rejects(historialReserva(db, otra.id, O, r.reservaId), AccesoDenegado);
    });
  } finally { await db.$disconnect(); }
});
