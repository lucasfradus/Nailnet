import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, crearSkill, crearTipoRecurso, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { actualizarConfiguracionSede } from "../src/configuracion.ts";
import { ConfiguracionIncompleta, consultarDisponibilidad } from "../src/disponibilidad.ts";
import { crearBloqueo, crearExcepcion, crearProfesional, crearRecurso, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos, vincularSede } from "../src/profesionales.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13"; // martes
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const en = (hhmm: string, f = FECHA) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(f, h! * 60 + m!, TZ); };

test("disponibilidad desde la base", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id;
    const skill = (await crearSkill(db, M, O, "Semi"))!;
    const cabina = (await crearTipoRecurso(db, M, O, "Cabina"))!;
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: { tipo: "PORCENTAJE" as const, valor: "30" }, activo: true, consentimientos: [] };
    const manos = (await guardarServicio(db, M, O, { ...base, nombre: "Manos", duracionMinutos: 50, skillIds: [skill.id], recursos: [{ tipoRecursoId: cabina.id, cantidad: 1 }] }))!.id;
    const pies = (await guardarServicio(db, M, O, { ...base, nombre: "Pies", duracionMinutos: 50, skillIds: [], recursos: [] }))!.id;
    for (const s of [manos, pies]) await guardarServicioSede(db, M, O, a.centro.id, s, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "09:00-20:00" }));
    await crearRecurso(db, M, O, a.centro.id, { tipoRecursoId: cabina.id, nombre: "Cabina 1" });
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana" })).id;
    const bea = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Bea" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [skill.id], servicioIds: [manos, pies] });
    await guardarHabilidades(db, M, O, bea, { skillIds: [], servicioIds: [manos, pies] }); // sin skill: no hace manos
    await guardarHorarioProfesional(db, M, O, ana, a.centro.id, semanaDesdeTextos({ 2: "09:00-13:00" }));
    await guardarHorarioProfesional(db, M, O, bea, a.centro.id, semanaDesdeTextos({ 2: "09:00-13:00" }));
    const pedido = (items: { servicioId: string; profesionalId?: string }[], canal: "ONLINE" | "RECEPCION" = "RECEPCION") => ({ sedeId: a.centro.id, fecha: FECHA, canal, items });
    const ahora = new Date("2099-10-01T12:00:00Z");

    await t.test("sin intervalo de grilla (D17) no hay turnos; online exige además D18", async () => {
      await assert.rejects(consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora), ConfiguracionIncompleta);
      await actualizarConfiguracionSede(db, M, O, a.centro.id, { pasoGrillaMinutos: 60 });
      await assert.rejects(consultarDisponibilidad(db, null, O, pedido([{ servicioId: manos }], "ONLINE"), ahora), (e: unknown) => e instanceof ConfiguracionIncompleta && e.faltantes.length === 2);
    });

    await t.test("turnos con skills, jornada y recurso; «cualquiera» elige apta", async () => {
      const turnos = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora);
      assert.deepEqual(turnos.map(x => hora(x.inicio)), ["09:00", "10:00", "11:00", "12:00"]);
      assert.ok(turnos.every(x => x.items[0]!.profesionalId === ana), "bea no tiene la skill");
      assert.equal(turnos[0]!.items[0]!.recursoIds.length, 1);
      assert.deepEqual(await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos, profesionalId: bea }]), ahora), []);
    });

    await t.test("ocupaciones en otra sede, retenciones vigentes y vencidas, bloqueos", async () => {
      await vincularSede(db, M, O, ana, a.norte.id, true);
      const enNorte = await db.reserva.create({ data: { organizacionId: O, sedeId: a.norte.id, canal: "RECEPCION", estado: "CONFIRMADA",
        items: { create: { posicion: 0, servicioId: pies, profesionalId: ana, inicio: en("10:00"), fin: en("10:50"), ocupaDesde: en("10:00"), ocupaHasta: en("10:50"), duracionMinutos: 50, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, precio: "30000" } } } });
      let turnos = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora);
      assert.deepEqual(turnos.map(x => hora(x.inicio)), ["09:00", "11:00", "12:00"], "el turno en Norte bloquea a Ana en Centro");
      await db.reserva.create({ data: { organizacionId: O, sedeId: a.centro.id, canal: "ONLINE", estado: "PENDIENTE_PAGO", expiraEn: new Date(ahora.getTime() - 1000),
        items: { create: { posicion: 0, servicioId: manos, profesionalId: ana, inicio: en("11:00"), fin: en("11:50"), ocupaDesde: en("11:00"), ocupaHasta: en("11:50"), duracionMinutos: 50, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, precio: "30000" } } } });
      turnos = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora);
      assert.ok(turnos.some(x => hora(x.inicio) === "11:00"), "retención vencida no ocupa aunque el worker no la haya expirado");
      await crearBloqueo(db, M, O, ana, { inicio: en("12:00"), fin: en("13:00") });
      turnos = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora);
      assert.deepEqual(turnos.map(x => hora(x.inicio)), ["09:00", "11:00"]);
      await db.reserva.update({ where: { id: enNorte.id }, data: { estado: "CANCELADA" } });
      assert.ok((await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora)).some(x => hora(x.inicio) === "10:00"), "cancelar libera");
    });

    await t.test("recurso ocupado por otro profesional bloquea el turno", async () => {
      const r = await db.recurso.findFirstOrThrow({ where: { sedeId: a.centro.id } });
      await db.reserva.create({ data: { organizacionId: O, sedeId: a.centro.id, canal: "RECEPCION", estado: "CONFIRMADA",
        items: { create: { posicion: 0, servicioId: pies, profesionalId: bea, inicio: en("09:00"), fin: en("09:50"), ocupaDesde: en("09:00"), ocupaHasta: en("09:50"), duracionMinutos: 50, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, precio: "30000",
          recursos: { create: { recursoId: r.id, ocupaDesde: en("09:00"), ocupaHasta: en("09:50") } } } } } });
      const turnos = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }]), ahora);
      assert.equal(turnos.some(x => hora(x.inicio) === "09:00"), false);
    });

    await t.test("manos + pies encadenados con profesionales distintos (D15)", async () => {
      const turnos = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }, { servicioId: pies }]), ahora);
      const t10 = turnos.find(x => hora(x.inicio) === "10:00")!;
      assert.deepEqual(t10.items.map(i => [hora(i.inicio), i.profesional]), [["10:00", "Ana"], ["10:50", "Ana"]], "Ana tiene menos carga del día que Bea (50 min)");
      const conBea = await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: manos }, { servicioId: pies, profesionalId: bea }]), ahora);
      assert.deepEqual(conBea.find(x => hora(x.inicio) === "10:00")!.items.map(i => [hora(i.inicio), i.profesional]), [["10:00", "Ana"], ["10:50", "Bea"]], "profesional elegido por ítem");
    });

    await t.test("feriado de la organización cierra el día", async () => {
      await crearExcepcion(db, M, O, { sedeId: null, fecha: FECHA, rango: null, motivo: "Feriado" });
      assert.deepEqual(await consultarDisponibilidad(db, a.recepcion.id, O, pedido([{ servicioId: pies }]), ahora), []);
    });

    await t.test("online: anticipación y horizonte; alcance y servicios no disponibles", async () => {
      await actualizarConfiguracionSede(db, M, O, a.centro.id, { pasoGrillaMinutos: 60, horizonteReservaDias: 14, anticipacionMinimaMinutos: 120 });
      const otroDia = "2099-10-20"; // martes sin feriado
      const cerca = new Date(en("08:30", otroDia).getTime());
      const online = await consultarDisponibilidad(db, null, O, { sedeId: a.centro.id, fecha: otroDia, canal: "ONLINE", items: [{ servicioId: pies }] }, cerca);
      assert.equal(hora(online[0]!.inicio), "11:00", "08:30 + 120 min → primer inicio 11:00");
      assert.deepEqual(await consultarDisponibilidad(db, null, O, { sedeId: a.centro.id, fecha: otroDia, canal: "ONLINE", items: [{ servicioId: pies }] }, ahora), [], "fuera del horizonte de 14 días");
      await assert.rejects(consultarDisponibilidad(db, null, O, pedido([{ servicioId: pies }]), ahora), AccesoDenegado, "portal no usa canal recepción");
      await assert.rejects(consultarDisponibilidad(db, a.recepcion.id, O, { ...pedido([{ servicioId: pies }]), sedeId: a.sur.id }, ahora), AccesoDenegado);
      await assert.rejects(consultarDisponibilidad(db, a.recepcion.id, O, { ...pedido([{ servicioId: pies }]), sedeId: a.norte.id }, ahora), ConfiguracionIncompleta, "Norte sin intervalo de grilla");
      await actualizarConfiguracionSede(db, M, O, a.norte.id, { pasoGrillaMinutos: 30 });
      await assert.rejects(consultarDisponibilidad(db, a.recepcion.id, O, { ...pedido([{ servicioId: pies }]), sedeId: a.norte.id }, ahora), DatosInvalidos, "no habilitado en Norte");
      await assert.rejects(consultarDisponibilidad(db, a.recepcion.id, O, { ...pedido([{ servicioId: pies }]), fecha: "2099-02-30" }, ahora), DatosInvalidos);
    });
  } finally { await db.$disconnect(); }
});
