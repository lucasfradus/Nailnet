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
import { cambiarEstadoRecurso, crearBloqueo, crearProfesional, crearRecurso, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { TurnoNoDisponible, cancelarReserva, empezarSesion, marcarAusente, reprogramarReserva, terminarAtencion, tomarTurno } from "../src/reservas.ts";
import { agendaDia, destinosDeTurno } from "../src/agenda-dia.ts";
import { registrarVenta } from "../src/ventas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13"; // martes
const en = (hhmm: string, fecha = FECHA) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(fecha, h! * 60 + m!, TZ); };
const iso = (hhmm: string) => en(hhmm).toISOString();

test("grilla del día de Tratamientos (doc 31, etapa 4)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const db2 = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id;
    const centro = a.centro.id;

    // Manos y pies: Manos (sin recurso) y Pies (sillón). Tratamientos: Limpieza facial (60 min) y Masaje
    // (30 min, con seña), los dos en una cabina.
    const nails = (await crearCategoria(db, M, O, "Nails"))!;
    const faciales = (await crearCategoria(db, M, O, "Faciales", 1, "TRATAMIENTOS"))!;
    const tipoCabina = (await crearTipoRecurso(db, M, O, "Cabina"))!;
    const tipoSillon = (await crearTipoRecurso(db, M, O, "Sillón"))!;
    const base = { bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "NINGUNA" as const, valor: null }, activo: true, consentimientos: [], skillIds: [] };
    const cabina = [{ tipoRecursoId: tipoCabina.id, cantidad: 1 }];
    const manos = (await guardarServicio(db, M, O, { ...base, categoriaId: nails.id, nombre: "Manos", duracionMinutos: 60, recursos: [] }))!.id;
    const pies = (await guardarServicio(db, M, O, { ...base, categoriaId: nails.id, nombre: "Pies", duracionMinutos: 45, recursos: [{ tipoRecursoId: tipoSillon.id, cantidad: 1 }] }))!.id;
    const facial = (await guardarServicio(db, M, O, { ...base, categoriaId: faciales.id, nombre: "Limpieza facial", duracionMinutos: 60, recursos: cabina }))!.id;
    const masaje = (await guardarServicio(db, M, O, { ...base, categoriaId: faciales.id, nombre: "Masaje", duracionMinutos: 30, recursos: cabina, sena: { tipo: "FIJA", valor: "5000" } }))!.id;
    for (const s of [manos, pies, facial, masaje]) await guardarServicioSede(db, M, O, centro, s, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    const cab1 = (await crearRecurso(db, M, O, centro, { tipoRecursoId: tipoCabina.id, nombre: "Cabina 1" })).id;
    const cab2 = (await crearRecurso(db, M, O, centro, { tipoRecursoId: tipoCabina.id, nombre: "Cabina 2" })).id;
    const cab3 = (await crearRecurso(db, M, O, centro, { tipoRecursoId: tipoCabina.id, nombre: "Cabina 3" })).id;
    const vieja = (await crearRecurso(db, M, O, centro, { tipoRecursoId: tipoCabina.id, nombre: "Cabina vieja" })).id;
    await cambiarEstadoRecurso(db, M, O, vieja, false);
    const sillon = (await crearRecurso(db, M, O, centro, { tipoRecursoId: tipoSillon.id, nombre: "Sillón 1" })).id;
    const cabNorte = (await crearRecurso(db, M, O, a.norte.id, { tipoRecursoId: tipoCabina.id, nombre: "Cabina Norte" })).id;
    await guardarHorarioSede(db, M, O, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana" })).id; // manos y pies
    const eva = (await crearProfesional(db, M, O, centro, { nombre: "Eva" })).id; // tratamientos
    const flor = (await crearProfesional(db, M, O, centro, { nombre: "Flor" })).id; // tratamientos
    const gabi = (await crearProfesional(db, M, O, centro, { nombre: "Gabi" })).id; // todavía sin servicios
    await guardarHabilidades(db, M, O, ana, { skillIds: [], servicioIds: [manos, pies] });
    for (const p of [eva, flor]) await guardarHabilidades(db, M, O, p, { skillIds: [], servicioIds: [facial, masaje] });
    for (const p of [ana, eva, flor, gabi]) await guardarHorarioProfesional(db, M, O, p, centro, semanaDesdeTextos({ 2: "08:00-22:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    const lucia = (await crearCliente(db, R, O, centro, { nombre: "Lucía", telefono: "1144445555" }))!.id;

    const temprano = en("08:00");
    const turno = (profesionalId: string, hhmm: string, recursoIds?: string[], servicioId = facial) =>
      tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId, profesionalId, ...(recursoIds ? { recursoIds } : {}) }], inicio: en(hhmm) }, temprano);
    const item = async (reservaId: string) => db.reservaItem.findFirstOrThrow({ where: { reservaId }, include: { recursos: true }, orderBy: { posicion: "asc" } });

    let original = "", movido = "", deFlor = "";
    await t.test("cabina pedida al tomar el turno: libre, ocupada, de otro tipo, de otra sede; el portal no elige", async () => {
      const r = await turno(eva, "10:00", [cab2]);
      original = r.reservaId;
      assert.deepEqual(r.items[0]!.recursoIds, [cab2], "usa la elegida aunque haya otras libres");
      await assert.rejects(turno(flor, "10:00", [cab2]), TurnoNoDisponible, "ocupada aunque haya otras libres");
      deFlor = (await turno(flor, "10:00", [cab1])).reservaId;
      await assert.rejects(turno(flor, "11:00", [sillon]), (e: unknown) => e instanceof DatosInvalidos && /Sillón 1 no es de las que usa Limpieza facial/.test(e.message));
      await assert.rejects(turno(flor, "11:00", [cabNorte]), /no está disponible en esta sede/);
      await assert.rejects(turno(flor, "11:00", [vieja]), /no está disponible en esta sede/, "inactiva");
      await assert.rejects(turno(flor, "11:00", [cab1, cab2]), /una sola unidad/);
      await assert.rejects(turno(flor, "11:00", [cab1, cab1]), /dos veces/);
      await assert.rejects(turno(flor, "11:00", ["no-es-un-id"]), AccesoDenegado);
      await assert.rejects(tomarTurno(db, null, O, { sedeId: centro, fecha: FECHA, canal: "ONLINE", items: [{ servicioId: facial, recursoIds: [cab3] }], inicio: en("11:00") }, temprano), /se elige en recepción/);
      // Sin pedir nada sigue como siempre: cualquiera libre.
      const libre = await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: facial, profesionalId: flor }], inicio: en("11:00") }, temprano);
      assert.equal(libre.items[0]!.recursoIds.length, 1);
      await cancelarReserva(db, R, O, libre.reservaId, "prueba");
    });

    await t.test("reprogramar con cabina: cambiar solo la cabina, ocupada, de otro tipo, de otra sede", async () => {
      const mismo = { fecha: FECHA, inicio: en("10:00"), profesionales: [eva] };
      await assert.rejects(reprogramarReserva(db, R, O, original, { ...mismo, recursos: [[cab1]] }, temprano), TurnoNoDisponible, "Cabina 1 la tiene Flor");
      await assert.rejects(reprogramarReserva(db, R, O, original, { ...mismo, recursos: [[sillon]] }, temprano), /no es de las que usa/);
      await assert.rejects(reprogramarReserva(db, R, O, original, { ...mismo, recursos: [[cabNorte]] }, temprano), /no está disponible en esta sede/);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: original } })).estado, "CONFIRMADA", "los rechazos no cambian nada");
      const nueva = await reprogramarReserva(db, R, O, original, { ...mismo, recursos: [[cab3]] }, temprano);
      assert.deepEqual(nueva.items.map(i => [i.profesionalId, i.inicio.toISOString(), i.recursoIds, i.precio]), [[eva, iso("10:00"), [cab3], "30000.00"]]);
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: original } })).estado, "CANCELADA");
      movido = nueva.reservaId;
    });

    // Turnos del resto del día (todos tomados temprano, con la cabina elegida).
    const deEva12 = (await turno(eva, "12:00", [cab1])).reservaId;
    const deFlor14 = (await turno(flor, "14:00", [cab2])).reservaId;
    const deEva15 = (await turno(eva, "15:00", [cab1])).reservaId;
    const deEva16 = (await turno(eva, "16:00", [cab2])).reservaId;
    const deEva17 = (await turno(eva, "17:00", [cab3])).reservaId;
    const deFlor18 = (await turno(flor, "18:00", [cab3])).reservaId;
    const deEva19 = (await turno(eva, "19:00", [cab1])).reservaId;
    // Dos servicios encadenados de Eva, y una reserva mixta: facial con Eva y manos con Ana, a la vez.
    const varios = (await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: facial, profesionalId: eva }, { servicioId: masaje, profesionalId: eva }], inicio: en("20:00") }, temprano)).reservaId;
    const mixta = (await tomarTurno(db, R, O, { sedeId: centro, fecha: FECHA, canal: "RECEPCION", clienteId: lucia, items: [{ servicioId: facial, profesionalId: eva, recursoIds: [cab1] }, { servicioId: manos, profesionalId: ana, conAnterior: true }], inicio: en("13:00") }, temprano)).reservaId;
    await crearBloqueo(db, M, O, flor, { inicio: en("20:00"), fin: en("21:00"), motivo: "Médico" });

    await t.test("destinos: ignora la ocupación del propio turno y da las cabinas libres por inicio", async () => {
      const d = await destinosDeTurno(db, R, O, movido, FECHA, temprano);
      assert.deepEqual([d.reservaId, d.fecha, d.timezone], [movido, FECHA, TZ]);
      assert.deepEqual(d.destinos.map(x => x.profesionalIds).sort(), [[eva], [flor]].sort(), "solo las que hacen el servicio");
      const deEva = d.destinos.find(x => x.profesionalIds[0] === eva)!;
      const inicios = deEva.inicios.map(i => i.inicio.toISOString());
      assert.ok(inicios.includes(iso("10:00")) && inicios.includes(iso("10:30")), "su propio horario y media hora después");
      assert.ok(inicios.includes(iso("08:00")) && inicios.includes(iso("11:00")));
      assert.ok(!inicios.includes(iso("11:30")) && !inicios.includes(iso("12:00")), "pisaría su turno de las 12");
      const a10 = deEva.inicios.find(i => i.inicio.toISOString() === iso("10:00"))!;
      assert.deepEqual(a10.fin.toISOString(), iso("11:00"));
      assert.deepEqual(a10.items.map(i => i.recursos.map(r => [r.tipoRecursoId, r.cantidad, r.libres])), [[[tipoCabina.id, 1, [cab2, cab3].sort()]]], "la propia y la que quedó libre; no la de Flor");
      const a8 = deEva.inicios.find(i => i.inicio.toISOString() === iso("08:00"))!;
      assert.deepEqual(a8.items[0]!.recursos[0]!.libres, [cab1, cab2, cab3].sort());
      const deFlorD = d.destinos.find(x => x.profesionalIds[0] === flor)!.inicios.map(i => i.inicio.toISOString());
      assert.ok(!deFlorD.includes(iso("10:00")) && !deFlorD.includes(iso("10:30")) && deFlorD.includes(iso("11:00")), "Flor está ocupada de 10 a 11");

      // Lo que ofrece, reprogramar lo acepta: media hora más tarde, en la misma cabina.
      const nueva = await reprogramarReserva(db, R, O, movido, { fecha: FECHA, inicio: en("10:30"), profesionales: [eva], recursos: [[cab3]] }, temprano);
      assert.deepEqual(nueva.items.map(i => [i.inicio.toISOString(), i.recursoIds]), [[iso("10:30"), [cab3]]]);
      movido = nueva.reservaId;

      // Varios servicios: solo cambiar de horario, con las mismas profesionales.
      const v = await destinosDeTurno(db, R, O, varios, FECHA, temprano);
      assert.deepEqual(v.destinos.map(x => x.profesionalIds), [[eva, eva]]);
      const a20 = v.destinos[0]!.inicios.find(i => i.inicio.toISOString() === iso("20:00"))!;
      assert.deepEqual([a20.fin.toISOString(), a20.items.length], [iso("21:30"), 2]);
    });

    await t.test("destinos: permisos, otra organización y solo turnos confirmados", async () => {
      await assert.rejects(destinosDeTurno(db, a.profesional.id, O, movido, FECHA, temprano), AccesoDenegado);
      await assert.rejects(destinosDeTurno(db, b.recepcion.id, b.org.id, movido, FECHA, temprano), AccesoDenegado);
      await assert.rejects(destinosDeTurno(db, R, O, original, FECHA, temprano), /Solo se mueven turnos confirmados/);
      await assert.rejects(destinosDeTurno(db, R, O, movido, "2099-13-40", temprano), /Fecha inválida/);
    });

    await t.test("«Empezó» a la hora: marca el comienzo sin mover la agenda; después no se mueve", async () => {
      await assert.rejects(empezarSesion(db, a.profesional.id, O, deEva12, en("12:05")), AccesoDenegado);
      await assert.rejects(empezarSesion(db, R, O, deEva12, en("12:05", "2099-10-12")), /de hoy/);
      await empezarSesion(db, R, O, deEva12, en("12:05"));
      const r = await db.reserva.findUniqueOrThrow({ where: { id: deEva12 }, include: { items: true } });
      assert.deepEqual([r.iniciadaEn?.toISOString(), r.items[0]!.inicio.toISOString(), r.items[0]!.ocupaDesde.toISOString()], [iso("12:05"), iso("12:00"), iso("12:00")]);
      await assert.rejects(empezarSesion(db, R, O, deEva12, en("12:06")), /ya empezó/);
      await assert.rejects(reprogramarReserva(db, R, O, deEva12, { fecha: FECHA, inicio: en("12:00"), profesionales: [eva], recursos: [[cab2]] }, temprano), /La sesión ya empezó/);
      await assert.rejects(destinosDeTurno(db, R, O, deEva12, FECHA, temprano), /La sesión ya empezó/);
      const auditoria = await db.auditLog.findFirst({ where: { organizacionId: O, accion: "reserva.sesion_empezada", entidadId: deEva12 } });
      assert.ok(auditoria);
      await terminarAtencion(db, R, O, deEva12, en("12:50"));
    });

    await t.test("«Empezó» antes de hora con todo libre: adelanta la ocupación y «Terminó» vale enseguida", async () => {
      await empezarSesion(db, R, O, deFlor14, new Date(en("13:20").getTime() + 30_000));
      const it = await item(deFlor14);
      assert.deepEqual([it.inicio, it.fin, it.ocupaDesde, it.ocupaHasta].map(d => d.toISOString()), [iso("13:20"), iso("14:20"), iso("13:20"), iso("14:20")]);
      assert.deepEqual(it.recursos.map(r => [r.recursoId, r.ocupaDesde.toISOString(), r.ocupaHasta.toISOString()]), [[cab2, iso("13:20"), iso("14:20")]]);
      const r = await db.reserva.findUniqueOrThrow({ where: { id: deFlor14 } });
      assert.equal(r.iniciadaEn?.toISOString(), new Date(en("13:20").getTime() + 30_000).toISOString());
      await terminarAtencion(db, R, O, deFlor14, en("13:50"));
      const fin = await db.reserva.findUniqueOrThrow({ where: { id: deFlor14 }, include: { items: true } });
      assert.deepEqual([fin.estado, fin.items[0]!.fin.toISOString(), fin.items[0]!.ocupaHasta.toISOString()], ["ATENDIDA", iso("13:50"), iso("13:50")]);
      // La cabina queda libre para otro turno desde las 14 (antes la ocupaba hasta las 15).
      const otro = await turno(flor, "14:00", [cab2]);
      await cancelarReserva(db, R, O, otro.reservaId, "prueba");
    });

    await t.test("«Empezó» antes de hora con la profesional ocupada: se rechaza con el motivo", async () => {
      await assert.rejects(empezarSesion(db, R, O, deEva16, en("15:10")), (e: unknown) => e instanceof DatosInvalidos && e.message === "No se puede empezar antes de las 16:00: Eva tiene otro turno hasta las 16:00");
      const it = await item(deEva16);
      assert.equal(it.inicio.toISOString(), iso("16:00"), "no cambió nada");
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: deEva16 } })).iniciadaEn, null);
      // Con la profesional atendiendo a otra clienta (pasada de su horario) tampoco.
      await empezarSesion(db, R, O, deEva15, en("15:00"));
      await assert.rejects(empezarSesion(db, R, O, deEva16, en("15:59")), /Eva está atendiendo a otra clienta/);
      await terminarAtencion(db, R, O, deEva15, en("15:58"));
      await empezarSesion(db, R, O, deEva16, en("15:59"));
      assert.equal((await item(deEva16)).inicio.toISOString(), iso("15:59"));
      await terminarAtencion(db, R, O, deEva16, en("16:50"));
    });

    await t.test("«Empezó» antes de hora con la cabina ocupada: se rechaza con el motivo", async () => {
      await assert.rejects(empezarSesion(db, R, O, deFlor18, en("17:15")), (e: unknown) => e instanceof DatosInvalidos && e.message === "No se puede empezar antes de las 18:00: Cabina 3 está ocupada hasta las 18:00");
      await db.bloqueoRecurso.create({ data: { organizacionId: O, recursoId: cab3, inicio: en("17:50"), fin: en("17:55"), motivo: "Limpieza" } });
      await assert.rejects(empezarSesion(db, R, O, deFlor18, en("17:45")), /Cabina 3 está ocupada hasta las 18:00; Cabina 3 está bloqueada hasta las 17:55/);
      assert.equal((await item(deFlor18)).inicio.toISOString(), iso("18:00"));
    });

    await t.test("«Empezó» de dos recepcionistas a la vez: vale una sola vez", async () => {
      const r = await Promise.allSettled([db, db2].map(c => empezarSesion(c, R, O, deEva19, en("18:30"))));
      assert.deepEqual(r.map(x => x.status).sort(), ["fulfilled", "rejected"], r.map(x => x.status === "rejected" ? String(x.reason) : "").join(" | "));
      const rechazo = r.find(x => x.status === "rejected") as PromiseRejectedResult;
      assert.ok(rechazo.reason instanceof DatosInvalidos, String(rechazo.reason));
      const it = await item(deEva19);
      assert.deepEqual([it.inicio, it.fin].map(d => d.toISOString()), [iso("18:30"), iso("19:30")], "adelantado una sola vez");
      assert.equal(await db.auditLog.count({ where: { organizacionId: O, accion: "reserva.sesion_empezada", entidadId: deEva19 } }), 1);
    });

    await t.test("agendaDia: forma, estados de la grilla y filtro por universo", async () => {
      // Pendiente de seña: el portal reserva un masaje (con seña) a las 17.
      const pendiente = (await tomarTurno(db, null, O, { sedeId: centro, fecha: FECHA, canal: "ONLINE", items: [{ servicioId: masaje }], inicio: en("17:00") }, en("16:00"))).reservaId;
      await marcarAusente(db, R, O, deEva17, en("17:30"));
      const venta = await item(deEva12);
      await registrarVenta(db, R, O, { sedeId: centro, reservaId: deEva12, productos: [], claveIdempotencia: randomUUID(),
        servicios: [{ servicioId: facial, profesionalId: eva, reservaItemId: venta.id }], cobros: [{ medio: "TARJETA_CREDITO", monto: "30000" }] });

      const ahora = en("16:05");
      const tr = await agendaDia(db, R, O, { sedeId: centro, fecha: FECHA, universo: "TRATAMIENTOS" }, ahora);
      assert.deepEqual([tr.timezone, tr.fecha, tr.esHoy, tr.pasoMinutos], [TZ, FECHA, true, 30]);
      assert.deepEqual(tr.apertura.map(x => [x.desde.toISOString(), x.hasta.toISOString()]), [[iso("08:00"), iso("22:00")]]);
      assert.deepEqual(tr.servicios.map(s => [s.nombre, s.duracionMinutos, s.recursos]), [["Limpieza facial", 60, cabina], ["Masaje", 30, cabina]]);
      assert.deepEqual(tr.recursos.map(r => [r.nombre, r.tipo, r.tipoRecursoId]), [["Cabina 1", "Cabina", tipoCabina.id], ["Cabina 2", "Cabina", tipoCabina.id], ["Cabina 3", "Cabina", tipoCabina.id]], "activas de la sede, del tipo que piden sus servicios");
      // Profesionales del universo y la que no tiene servicios. Ana no: su parte de la reserva mixta es de Manos y pies.
      assert.deepEqual(tr.profesionales.map(p => [p.nombre, p.servicioIds.length]), [["Eva", 2], ["Flor", 2], ["Gabi", 0]]);
      const florDia = tr.profesionales.find(p => p.id === flor)!;
      assert.deepEqual(florDia.jornada.map(j => [j.desde.toISOString(), j.hasta.toISOString()]), [[iso("08:00"), iso("22:00")]]);
      assert.deepEqual(florDia.ausencias.map(x => [x.desde.toISOString(), x.hasta.toISOString(), x.motivo]), [[iso("20:00"), iso("21:00"), "Médico"]]);

      const estado = (reservaId: string) => tr.turnos.filter(x => x.reservaId === reservaId).map(x => x.estado);
      assert.deepEqual(estado(pendiente), ["PENDIENTE_PAGO"]);
      assert.deepEqual(estado(deFlor), ["CONFIRMADA"]);
      assert.deepEqual(estado(deEva19), ["EN_SESION"]);
      assert.deepEqual(estado(deFlor14), ["POR_COBRAR"]);
      assert.deepEqual(estado(deEva12), ["COBRADA"]);
      assert.deepEqual(estado(deEva17), ["AUSENTE"]);
      assert.deepEqual(estado(original), [], "cancelado (reprogramado): no se muestra");
      assert.deepEqual(estado(movido), ["CONFIRMADA"]);
      assert.deepEqual(estado(varios), ["CONFIRMADA", "CONFIRMADA"]);
      const mixtos = tr.turnos.filter(x => x.reservaId === mixta);
      assert.deepEqual(mixtos.map(x => [x.posicion, x.itemsDeLaReserva, x.servicio, x.profesionalId, x.recursoIds]), [[0, 2, "Limpieza facial", eva, [cab1]]], "de la visita mixta, solo el servicio de este universo; itemsDeLaReserva avisa que tiene otro");
      const t19 = tr.turnos.find(x => x.reservaId === deEva19)!;
      assert.deepEqual({ ...t19, inicio: t19.inicio.toISOString(), fin: t19.fin.toISOString(), ocupaDesde: t19.ocupaDesde.toISOString(), ocupaHasta: t19.ocupaHasta.toISOString(), iniciadaEn: null }, {
        reservaId: deEva19, itemId: t19.itemId, posicion: 0, itemsDeLaReserva: 1, profesionalId: eva, recursoIds: [cab1],
        inicio: iso("18:30"), fin: iso("19:30"), ocupaDesde: iso("18:30"), ocupaHasta: iso("19:30"), servicioId: facial, servicio: "Limpieza facial",
        cliente: { id: lucia, nombre: "Lucía", apellido: null, telefono: "1144445555" }, notas: null, canal: "RECEPCION", expiraEn: null, estado: "EN_SESION", iniciadaEn: null, terminadoEn: null,
      });
      assert.ok(tr.turnos.every((x, i, xs) => i === 0 || xs[i - 1]!.inicio <= x.inicio), "ordenados por inicio");

      // La retención vencida ya no se muestra.
      assert.deepEqual((await agendaDia(db, R, O, { sedeId: centro, fecha: FECHA, universo: "TRATAMIENTOS" }, en("16:30"))).turnos.filter(x => x.reservaId === pendiente), []);

      // Manos y pies: solo sus servicios y profesionales; de la reserva mixta, su parte.
      const mp = await agendaDia(db, R, O, { sedeId: centro, fecha: FECHA, universo: "MANOS_PIES" }, ahora);
      assert.deepEqual(mp.servicios.map(s => s.nombre), ["Manos", "Pies"]);
      assert.deepEqual(mp.recursos.map(r => r.nombre), ["Sillón 1"]);
      assert.deepEqual(mp.profesionales.map(p => p.nombre), ["Ana", "Gabi"], "Eva no hace nada de este universo; Gabi, sin servicios, en los dos");
      assert.deepEqual(mp.turnos.map(x => [x.reservaId, x.servicio, x.profesionalId]), [[mixta, "Manos", ana]]);

      // Sin universo, todo.
      const todo = await agendaDia(db, R, O, { sedeId: centro, fecha: FECHA }, ahora);
      assert.deepEqual(todo.servicios.map(s => s.nombre), ["Limpieza facial", "Manos", "Masaje", "Pies"]);
      assert.deepEqual(todo.recursos.map(r => r.nombre), ["Cabina 1", "Cabina 2", "Cabina 3", "Sillón 1"]);
      assert.deepEqual(todo.profesionales.map(p => p.nombre), ["Ana", "Eva", "Flor", "Gabi"]);
      assert.equal(todo.turnos.length, tr.turnos.length + mp.turnos.length, "cada servicio está en un solo universo");

      // Otro día: no es hoy y no hay turnos.
      const manana = await agendaDia(db, R, O, { sedeId: centro, fecha: "2099-10-14", universo: "TRATAMIENTOS" }, ahora);
      assert.deepEqual([manana.esHoy, manana.turnos.length, manana.apertura.length], [false, 0, 0]);
    });

    await t.test("agendaDia: permisos, otra sede y otra organización", async () => {
      await assert.rejects(agendaDia(db, a.profesional.id, O, { sedeId: centro, fecha: FECHA }), AccesoDenegado);
      await assert.rejects(agendaDia(db, R, O, { sedeId: a.sur.id, fecha: FECHA }), AccesoDenegado);
      await assert.rejects(agendaDia(db, R, O, { sedeId: b.centro.id, fecha: FECHA }), AccesoDenegado);
      await assert.rejects(agendaDia(db, b.recepcion.id, b.org.id, { sedeId: centro, fecha: FECHA }), AccesoDenegado);
      await assert.rejects(agendaDia(db, R, O, { sedeId: centro, fecha: "13/10/2099" }), /Fecha inválida/);
      // Norte: la recepcionista tiene acceso, y no hay nada de Centro.
      const norte = await agendaDia(db, R, O, { sedeId: a.norte.id, fecha: FECHA, universo: "TRATAMIENTOS" });
      assert.deepEqual([norte.turnos.length, norte.servicios.length, norte.pasoMinutos], [0, 0, 30]);
    });
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
});
