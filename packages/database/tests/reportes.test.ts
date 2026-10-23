import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { atenderAhora, cancelarReserva, marcarAtendida, marcarAusente, reprogramarReserva, terminarAtencion, tomarTurno } from "../src/reservas.ts";
import { agregarEspera, esperaSeFue, registrarEntrada, registrarSalida } from "../src/tablero.ts";
import { reporteSede } from "../src/reportes.ts";
import { anularVenta, registrarVenta } from "../src/ventas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13"; // martes
const SEMANA_ANTERIOR = "2099-10-06";
const en = (hhmm: string, fecha = FECHA) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(fecha, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");

test("reportes de sede (L03)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id, centro = a.centro.id;
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const semi = (await guardarServicio(db, M, O, { categoriaId: cat.id, nombre: "Semi", duracionMinutos: 60, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "NINGUNA", valor: null }, activo: true, consentimientos: [], skillIds: [], recursos: [] }))!.id;
    await guardarServicioSede(db, M, O, centro, semi, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, centro, semanaDesdeTextos({ 2: "09:00-20:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 60 });
    const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana", apellido: "Pérez" })).id;
    const bea = (await crearProfesional(db, M, O, centro, { nombre: "Bea" })).id;
    for (const p of [ana, bea]) {
      await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [semi] });
      await guardarHorarioProfesional(db, M, O, p, centro, semanaDesdeTextos({ 2: "09:00-18:00" }));
    }
    const lucia = (await crearCliente(db, M, O, centro, { nombre: "Lucía", telefono: "1155551234" }))!.id;
    const marta = (await crearCliente(db, M, O, centro, { nombre: "Marta", telefono: "1155554321" }))!.id;
    const turno = async (profesionalId: string, hhmm: string, clienteId: string, fecha = FECHA) =>
      (await tomarTurno(db, R, O, { sedeId: centro, fecha, canal: "RECEPCION", clienteId, items: [{ servicioId: semi, profesionalId }], inicio: en(hhmm, fecha) }, ahora)).reservaId;

    // Lucía ya vino la semana anterior: en el período es recurrente; Marta es nueva.
    const previa = await turno(ana, "10:00", lucia, SEMANA_ANTERIOR);
    await marcarAtendida(db, R, O, previa, en("10:00", SEMANA_ANTERIOR));
    const r1 = await turno(ana, "10:00", lucia);
    await marcarAtendida(db, R, O, r1, en("10:00"));
    const r2 = await turno(ana, "11:00", marta);
    await marcarAtendida(db, R, O, r2, en("11:00"));
    const r3 = await turno(bea, "10:00", marta);
    await marcarAusente(db, R, O, r3, en("10:30"));
    const r4 = await turno(bea, "12:00", lucia);
    await cancelarReserva(db, R, O, r4, "La clienta avisó", ahora);
    const r5 = await turno(bea, "14:00", lucia);
    await reprogramarReserva(db, R, O, r5, { fecha: FECHA, inicio: en("15:00") }, ahora);

    // Ventas (con la fecha de hoy): completada con descuento, pendiente con cobro parcial y una anulada.
    const v1 = await registrarVenta(db, R, O, { sedeId: centro, reservaId: r1, productos: [], descuento: "3000", cobros: [{ medio: "TARJETA_DEBITO", monto: "27000" }], claveIdempotencia: randomUUID() });
    assert.equal(v1.estado, "COMPLETADA");
    await registrarVenta(db, R, O, { sedeId: centro, reservaId: r2, productos: [], cobros: [{ medio: "TRANSFERENCIA", monto: "10000" }], claveIdempotencia: randomUUID() });
    const v3 = await registrarVenta(db, R, O, { sedeId: centro, reservaId: previa, productos: [], cobros: [{ medio: "TARJETA_DEBITO", monto: "30000" }], claveIdempotencia: randomUUID() });
    await anularVenta(db, R, O, v3.id, { motivo: "Se cargó en la sede equivocada", reponerStock: false });

    const hoy = aLocal(new Date(), TZ).fecha;

    await t.test("ventas por fecha de venta, ticket promedio y anuladas aparte", async () => {
      const { ventas } = await reporteSede(db, a.admin.id, O, { sedeId: centro, desde: hoy, hasta: hoy });
      assert.deepEqual([ventas.cantidad, ventas.completadas, ventas.pendientes], [2, 1, 1]);
      assert.deepEqual([ventas.total, ventas.descuentos, ventas.servicios, ventas.productos], [5700000n, 300000n, 5700000n, 0n]);
      assert.equal(ventas.ticketPromedio, 2700000n, "solo la completada, neta de descuento");
      assert.deepEqual(ventas.anuladas, { cantidad: 1, total: 3000000n });
      assert.deepEqual(ventas.porProfesional, [{ nombre: "Ana Pérez", servicios: 2, neto: 5700000n }]);
      assert.deepEqual(ventas.porServicio, [{ nombre: "Semi", cantidad: 2, neto: 5700000n }]);
    });

    await t.test("cobros por fecha del cobro, con los reversos a la vista", async () => {
      const { cobros } = await reporteSede(db, a.admin.id, O, { sedeId: centro, desde: hoy, hasta: hoy });
      assert.deepEqual(cobros.porMedio, [
        { medio: "TARJETA_DEBITO", cobrado: 5700000n, revertido: -3000000n, neto: 2700000n },
        { medio: "TRANSFERENCIA", cobrado: 1000000n, revertido: 0n, neto: 1000000n },
      ]);
      assert.deepEqual([cobros.neto, cobros.revertido], [3700000n, -3000000n]);
    });

    await t.test("base comisionable: servicios de ventas cobradas completas, sin anuladas", async () => {
      const { comisiones } = await reporteSede(db, a.admin.id, O, { sedeId: centro, desde: hoy, hasta: hoy });
      assert.deepEqual(comisiones.profesionales, [{ nombre: "Ana Pérez", servicios: 1, bruto: 3000000n, descuento: 300000n, base: 2700000n }]);
      assert.equal(comisiones.base, 2700000n);
    });

    await t.test("turnos, ocupación y clientes del día de los turnos", async () => {
      const rep = await reporteSede(db, a.franquiciado.id, O, { sedeId: centro, desde: FECHA, hasta: FECHA }, ahora);
      const { turnos } = rep;
      assert.deepEqual([turnos.total, turnos.atendidos, turnos.ausentes, turnos.cancelados, turnos.confirmados, turnos.reprogramados], [5, 2, 1, 1, 1, 1]);
      assert.deepEqual([turnos.tasaCancelacion, turnos.tasaAusentismo], [20, 33.3]);
      // Ana: 10 y 11 atendidos; Bea: ausente a las 10 y el reprogramado a las 15. El cancelado no ocupa.
      assert.deepEqual(rep.ocupacion.profesionales.map(o => [o.nombre, o.disponibleMinutos, o.ocupadoMinutos, o.pendienteMinutos]), [["Ana Pérez", 540, 120, 0], ["Bea", 540, 120, 0]]);
      assert.equal(rep.ocupacion.porcentaje, 22.2);
      assert.deepEqual(rep.clientes, { atendidos: 2, nuevos: 1, recurrentes: 1, atencionesSinCliente: 0 });
      const vacio = await reporteSede(db, a.admin.id, O, { sedeId: centro, desde: "2099-10-14", hasta: "2099-10-14" }, ahora);
      assert.deepEqual([vacio.turnos.total, vacio.turnos.tasaCancelacion, vacio.ocupacion.porcentaje], [0, null, null], "sin turnos ni jornada: sin tasas");
    });

    await t.test("recepción (tablero, doc 29): presencia contra atención, duración real y lista de espera", async () => {
      const F = "2099-10-20"; // otro martes: no toca los números de arriba
      await registrarEntrada(db, R, O, { sedeId: centro, profesionalId: ana }, en("09:00", F));
      await registrarEntrada(db, R, O, { sedeId: centro, profesionalId: bea }, en("09:00", F));
      // Ana: 60 min estimados, terminó a los 80 (se pasó). Bea: terminó a los 40.
      const deAna = await atenderAhora(db, R, O, { sedeId: centro, clienteId: lucia, items: [{ servicioId: semi, profesionalId: ana }] }, en("09:30", F));
      const sofia = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Sofía", servicioIds: [semi] }, en("09:40", F));
      const vera = await agregarEspera(db, R, O, { sedeId: centro, nombre: "Vera", servicioIds: [semi] }, en("09:45", F));
      const deBea = await atenderAhora(db, R, O, { sedeId: centro, clienteId: marta, items: [{ servicioId: semi, profesionalId: bea }], esperaId: sofia.id }, en("10:00", F));
      await esperaSeFue(db, R, O, vera.id, en("10:15", F));
      await terminarAtencion(db, R, O, deBea.reservaId, en("10:40", F));
      await terminarAtencion(db, R, O, deAna.reservaId, en("10:50", F));
      await agregarEspera(db, R, O, { sedeId: centro, nombre: "Paula", servicioIds: [semi] }, en("11:00", F));
      const presAna = await db.presenciaProfesional.findFirstOrThrow({ where: { profesionalId: ana, salida: null } });
      await registrarSalida(db, R, O, presAna.id, en("13:00", F));

      // A las 14 Bea sigue en el local: su presencia abierta cuenta hasta ese momento.
      const { recepcion } = await reporteSede(db, a.admin.id, O, { sedeId: centro, desde: F, hasta: F }, en("14:00", F));
      assert.deepEqual(recepcion.profesionales.map(p => [p.nombre, p.presenteMinutos, p.atendiendoMinutos, p.atenciones, p.porcentaje]),
        [["Ana Pérez", 240, 80, 1, 33.3], ["Bea", 300, 40, 1, 13.3]]);
      assert.deepEqual(recepcion.atenciones, { cantidad: 2, duracionReal: 60, duracionEstimada: 60, demoradas: 1 });
      assert.deepEqual(recepcion.espera, { anotadas: 3, atendidas: 1, seFueron: 1, sinCerrar: 1, promedioMinutos: 20, maximoMinutos: 20, tasaAbandono: 50 });
      // Otro día no tiene nada del tablero.
      const otro = await reporteSede(db, a.admin.id, O, { sedeId: centro, desde: "2099-10-21", hasta: "2099-10-21" }, en("12:00", F));
      assert.deepEqual([otro.recepcion.profesionales, otro.recepcion.atenciones.duracionReal, otro.recepcion.espera.tasaAbandono], [[], null, null]);
    });

    await t.test("alcance: recepción no ve reportes; nadie ve sedes ajenas; período acotado", async () => {
      await assert.rejects(reporteSede(db, R, O, { sedeId: centro, desde: hoy, hasta: hoy }), AccesoDenegado);
      await assert.rejects(reporteSede(db, a.admin.id, O, { sedeId: a.norte.id, desde: hoy, hasta: hoy }), AccesoDenegado, "admin de otra sede");
      await assert.rejects(reporteSede(db, a.franquiciado.id, O, { sedeId: a.sur.id, desde: hoy, hasta: hoy }), AccesoDenegado, "sede de otro franquiciado");
      await assert.rejects(reporteSede(db, M, O, { sedeId: centro, desde: "2099-01-01", hasta: "2100-06-01" }), DatosInvalidos);
      await assert.rejects(reporteSede(db, M, O, { sedeId: centro, desde: "2099-10-14", hasta: "2099-10-13" }), DatosInvalidos);
    });
  } finally { await db.$disconnect(); }
});
