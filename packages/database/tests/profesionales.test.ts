import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, crearSkill, crearTipoRecurso, guardarServicio } from "../src/catalogo.ts";
import { actualizarProfesional, calendarioSede, cambiarEstadoRecurso, crearBloqueo, crearExcepcion, crearProfesional, crearRecurso, eliminarBloqueo, eliminarExcepcion, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, listarProfesionales, obtenerProfesional, semanaDesdeTextos, vincularSede } from "../src/profesionales.ts";
import { crearFixture } from "../prisma/fixture.ts";

test("profesionales, jornadas, calendario y recursos", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    let profId = "";

    await t.test("alta desde una sede del alcance; lista por alcance", async () => {
      profId = (await crearProfesional(db, a.admin.id, a.org.id, a.centro.id, { nombre: "Carla", apellido: "Ruiz" })).id;
      await assert.rejects(crearProfesional(db, a.admin.id, a.org.id, a.norte.id, { nombre: "X" }), AccesoDenegado);
      await assert.rejects(crearProfesional(db, a.recepcion.id, a.org.id, a.centro.id, { nombre: "X" }), AccesoDenegado);
      assert.equal((await listarProfesionales(db, a.recepcion.id, a.org.id)).length, 1, "recepción la ve en Centro");
      await assert.rejects(obtenerProfesional(db, b.master.id, b.org.id, profId), AccesoDenegado);
      const otra = await db.usuario.create({ data: { email: `recep-sur-p-${a.org.id}@example.invalid`, nombre: "R", membresias: { create: { organizacionId: a.org.id } } } });
      await db.asignacionRol.create({ data: { organizacionId: a.org.id, usuarioId: otra.id, rol: "RECEPCIONISTA", alcance: "SEDE", sedeId: a.sur.id } });
      assert.equal((await listarProfesionales(db, otra.id, a.org.id)).length, 0);
      await assert.rejects(obtenerProfesional(db, otra.id, a.org.id, profId), AccesoDenegado);
    });

    await t.test("multi-sede: vincular exige administrar ambas; no se nombran sedes ajenas", async () => {
      await assert.rejects(vincularSede(db, a.admin.id, a.org.id, profId, a.norte.id, true), AccesoDenegado);
      await vincularSede(db, a.franquiciado.id, a.org.id, profId, a.norte.id, true);
      await vincularSede(db, a.master.id, a.org.id, profId, a.sur.id, true);
      const vistaAdmin = await obtenerProfesional(db, a.admin.id, a.org.id, profId);
      assert.deepEqual([vistaAdmin.sedes.length, vistaAdmin.otrasSedes], [1, 2]);
    });

    await t.test("jornadas: no puede estar en dos sedes a la vez; contiguas valen", async () => {
      await guardarHorarioProfesional(db, a.admin.id, a.org.id, profId, a.centro.id, semanaDesdeTextos({ 1: "09:00-13:00", 2: "09:00-18:00" }));
      await assert.rejects(guardarHorarioProfesional(db, a.franquiciado.id, a.org.id, profId, a.norte.id, semanaDesdeTextos({ 1: "12:00-16:00" })), /Se superpone con su jornada en Centro/);
      await guardarHorarioProfesional(db, a.franquiciado.id, a.org.id, profId, a.norte.id, semanaDesdeTextos({ 1: "13:00-20:00" }));
      await assert.rejects(guardarHorarioProfesional(db, a.master.id, a.org.id, profId, a.sur.id, semanaDesdeTextos({ 2: "17:00-19:00" })), DatosInvalidos);
      await assert.rejects(guardarHorarioProfesional(db, a.admin.id, a.org.id, profId, a.norte.id, semanaDesdeTextos({ 3: "09:00-10:00" })), AccesoDenegado);
      assert.throws(() => semanaDesdeTextos({ 1: "09:00-13:00, 12:00-14:00" }), /Lunes/);
      const p = await obtenerProfesional(db, a.franquiciado.id, a.org.id, profId);
      assert.deepEqual(p.sedes.find(s => s.sedeId === a.centro.id)?.semana[1], [{ inicio: 540, fin: 780 }]);
      // Reemplazar la propia jornada en la misma sede no choca consigo misma.
      await guardarHorarioProfesional(db, a.admin.id, a.org.id, profId, a.centro.id, semanaDesdeTextos({ 1: "08:00-13:00" }));
    });

    await t.test("jornadas concurrentes en dos sedes: solo una gana", async () => {
      const otro = (await crearProfesional(db, a.master.id, a.org.id, a.centro.id, { nombre: "Dana" })).id;
      await vincularSede(db, a.master.id, a.org.id, otro, a.norte.id, true);
      const r = await Promise.allSettled([
        guardarHorarioProfesional(db, a.master.id, a.org.id, otro, a.centro.id, semanaDesdeTextos({ 4: "10:00-14:00" })),
        guardarHorarioProfesional(db, a.master.id, a.org.id, otro, a.norte.id, semanaDesdeTextos({ 4: "12:00-16:00" })),
      ]);
      assert.equal(r.filter(x => x.status === "fulfilled").length, 1);
    });

    await t.test("habilidades y servicios habilitados, sin cruzar organizaciones", async () => {
      const skill = (await crearSkill(db, a.master.id, a.org.id, "Láser"))!;
      const cat = (await crearCategoria(db, a.master.id, a.org.id, "Depilación"))!;
      const serv = (await guardarServicio(db, a.master.id, a.org.id, { categoriaId: cat.id, nombre: "Láser piernas", duracionMinutos: 60, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: null, activo: true, skillIds: [skill.id], recursos: [], consentimientos: [] }))!;
      await guardarHabilidades(db, a.admin.id, a.org.id, profId, { skillIds: [skill.id], servicioIds: [serv.id] });
      assert.deepEqual((await obtenerProfesional(db, a.admin.id, a.org.id, profId)).skillIds, [skill.id]);
      const skillB = (await crearSkill(db, b.master.id, b.org.id, "Ajena"))!;
      await assert.rejects(guardarHabilidades(db, a.admin.id, a.org.id, profId, { skillIds: [skillB.id], servicioIds: [] }), AccesoDenegado);
      assert.deepEqual((await obtenerProfesional(db, a.admin.id, a.org.id, profId)).skillIds, [skill.id], "la transacción no dejó cambios parciales");
      await assert.rejects(guardarHabilidades(db, a.recepcion.id, a.org.id, profId, { skillIds: [], servicioIds: [] }), AccesoDenegado);
    });

    await t.test("bloqueos globales del profesional", async () => {
      const inicio = new Date(Date.now() + 86_400_000), fin = new Date(Date.now() + 2 * 86_400_000);
      const bl = await crearBloqueo(db, a.admin.id, a.org.id, profId, { inicio, fin, motivo: "Vacaciones" });
      assert.equal((await obtenerProfesional(db, a.master.id, a.org.id, profId)).bloqueos.length, 1, "visible desde cualquier sede");
      await assert.rejects(crearBloqueo(db, a.admin.id, a.org.id, profId, { inicio: fin, fin: inicio }), DatosInvalidos);
      await assert.rejects(crearBloqueo(db, a.recepcion.id, a.org.id, profId, { inicio, fin }), AccesoDenegado);
      await eliminarBloqueo(db, a.franquiciado.id, a.org.id, bl.id);
      await assert.rejects(db.bloqueoAgenda.create({ data: { organizacionId: a.org.id, profesionalId: profId, inicio: fin, fin: inicio } }), "check en la base");
    });

    await t.test("horario de sede, feriados de la organización y fechas especiales", async () => {
      await guardarHorarioSede(db, a.admin.id, a.org.id, a.centro.id, semanaDesdeTextos({ 1: "09:00-20:00", 6: "09:00-14:00" }));
      await assert.rejects(guardarHorarioSede(db, a.recepcion.id, a.org.id, a.centro.id, {}), AccesoDenegado);
      await assert.rejects(crearExcepcion(db, a.admin.id, a.org.id, { sedeId: null, fecha: "2026-10-12", rango: null }), AccesoDenegado, "feriado solo master");
      const feriado = await crearExcepcion(db, a.master.id, a.org.id, { sedeId: null, fecha: "2099-10-12", rango: null, motivo: "Feriado" });
      await crearExcepcion(db, a.admin.id, a.org.id, { sedeId: a.centro.id, fecha: "2099-10-12", rango: { inicio: 600, fin: 840 }, motivo: "Abre medio día" });
      await assert.rejects(crearExcepcion(db, a.admin.id, a.org.id, { sedeId: a.centro.id, fecha: "2099-02-30", rango: null }), DatosInvalidos);
      const cal = await calendarioSede(db, a.recepcion.id, a.org.id, a.centro.id);
      assert.deepEqual([cal.editable, cal.semana[6]?.[0]?.fin, cal.excepciones.filter(e => e.fecha === "2099-10-12").length], [false, 840, 2]);
      await assert.rejects(eliminarExcepcion(db, a.admin.id, a.org.id, feriado.id), AccesoDenegado);
      await assert.rejects(db.excepcionHorario.create({ data: { organizacionId: a.org.id, fecha: new Date("2099-01-01"), cerrado: false } }), "abierto sin rango");
    });

    await t.test("recursos por sede", async () => {
      const cabina = (await crearTipoRecurso(db, a.master.id, a.org.id, "Cabina"))!;
      const r1 = await crearRecurso(db, a.admin.id, a.org.id, a.centro.id, { tipoRecursoId: cabina.id, nombre: "Cabina 1" });
      await assert.rejects(crearRecurso(db, a.admin.id, a.org.id, a.centro.id, { tipoRecursoId: cabina.id, nombre: "Cabina 1" }), DatosInvalidos);
      await crearRecurso(db, a.franquiciado.id, a.org.id, a.norte.id, { tipoRecursoId: cabina.id, nombre: "Cabina 1" });
      await assert.rejects(crearRecurso(db, a.admin.id, a.org.id, a.norte.id, { tipoRecursoId: cabina.id, nombre: "Cabina 2" }), AccesoDenegado);
      const tipoB = (await crearTipoRecurso(db, b.master.id, b.org.id, "Ajeno"))!;
      await assert.rejects(crearRecurso(db, a.admin.id, a.org.id, a.centro.id, { tipoRecursoId: tipoB.id, nombre: "X" }), AccesoDenegado);
      await cambiarEstadoRecurso(db, a.admin.id, a.org.id, r1.id, false);
      assert.equal((await calendarioSede(db, a.admin.id, a.org.id, a.centro.id)).recursos[0]?.activo, false);
    });

    await t.test("desactivar profesional", async () => {
      await actualizarProfesional(db, a.admin.id, a.org.id, profId, { nombre: "Carla", apellido: "Ruiz", activo: false });
      assert.equal((await listarProfesionales(db, a.admin.id, a.org.id)).find(p => p.id === profId)?.activo, false);
      await assert.rejects(actualizarProfesional(db, a.recepcion.id, a.org.id, profId, { nombre: "X", activo: true }), AccesoDenegado);
    });
  } finally { await db.$disconnect(); }
});
