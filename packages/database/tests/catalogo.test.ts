import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { catalogoSede, crearCategoria, crearSkill, crearTipoRecurso, guardarServicio, guardarServicioSede, listarCatalogo, type DatosServicio } from "../src/catalogo.ts";
import { publicarConsentimiento } from "../src/clientes.ts";
import { crearFixture } from "../prisma/fixture.ts";

test("catálogo global y condiciones por sede", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const nails = (await crearCategoria(db, a.master.id, a.org.id, "Nails"))!;
    const semi = (await crearSkill(db, a.master.id, a.org.id, "Semipermanente"))!;
    const cabina = (await crearTipoRecurso(db, a.master.id, a.org.id, "Cabina"))!;
    await publicarConsentimiento(db, a.master.id, a.org.id, { tipo: "PRACTICA", clave: "esmaltado", titulo: "Esmaltado", texto: "Declaro conocer los cuidados del esmaltado semipermanente." });
    const datos = (extra: Partial<DatosServicio> = {}): DatosServicio => ({
      categoriaId: nails.id, nombre: "Esmaltado semipermanente", duracionMinutos: 50, bufferAntesMinutos: 0, bufferDespuesMinutos: 10,
      sena: null, activo: true, skillIds: [semi.id], recursos: [{ tipoRecursoId: cabina.id, cantidad: 1 }], consentimientos: ["esmaltado"], ...extra,
    });
    let servicioId = "";

    await t.test("solo el master define el catálogo global", async () => {
      await assert.rejects(crearCategoria(db, a.franquiciado.id, a.org.id, "X"), AccesoDenegado);
      await assert.rejects(guardarServicio(db, a.admin.id, a.org.id, datos()), AccesoDenegado);
      servicioId = (await guardarServicio(db, a.master.id, a.org.id, datos()))!.id;
      await assert.rejects(guardarServicio(db, a.master.id, a.org.id, datos()), DatosInvalidos, "nombre repetido");
      await assert.rejects(crearCategoria(db, a.master.id, a.org.id, "nails".replace("n", "N")), DatosInvalidos);
      const cat = await listarCatalogo(db, a.recepcion.id, a.org.id);
      const s = cat.categorias[0]!.servicios[0]!;
      assert.deepEqual([s.skills.length, s.recursos[0]!.cantidad, s.consentimientos[0]!.clave, s.sena], [1, 1, "esmaltado", null]);
    });

    await t.test("validaciones y aislamiento entre organizaciones", async () => {
      await assert.rejects(guardarServicio(db, a.master.id, a.org.id, datos({ nombre: "X", duracionMinutos: 52 })), DatosInvalidos);
      await assert.rejects(guardarServicio(db, a.master.id, a.org.id, datos({ nombre: "X", sena: { tipo: "PORCENTAJE", valor: "150" } })), DatosInvalidos);
      await assert.rejects(guardarServicio(db, a.master.id, a.org.id, datos({ nombre: "X", consentimientos: ["inexistente"] })), DatosInvalidos);
      const catB = (await crearCategoria(db, b.master.id, b.org.id, "Faciales"))!;
      await assert.rejects(guardarServicio(db, a.master.id, a.org.id, datos({ nombre: "X", categoriaId: catB.id })), AccesoDenegado, "categoría de otra organización");
      await assert.rejects(guardarServicio(db, b.master.id, b.org.id, datos({ categoriaId: catB.id, skillIds: [semi.id], consentimientos: [] })), AccesoDenegado, "skill de otra organización");
      await assert.rejects(guardarServicio(db, b.master.id, b.org.id, datos({ categoriaId: catB.id, skillIds: [], consentimientos: [] }), servicioId), AccesoDenegado, "editar servicio ajeno");
      await assert.rejects(db.servicio.update({ where: { id: servicioId }, data: { senaTipo: "FIJA" } }), "check de seña en la base");
    });

    await t.test("precio por sede; sin seña definida no se ofrece online (D3)", async () => {
      let cat = await catalogoSede(db, a.recepcion.id, a.org.id, a.centro.id);
      assert.equal(cat.puedeEditar, false);
      assert.equal(cat.servicios[0]!.efectivo.habilitado, false);
      await assert.rejects(guardarServicioSede(db, a.recepcion.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true }), AccesoDenegado);
      await assert.rejects(guardarServicioSede(db, a.admin.id, a.org.id, a.norte.id, servicioId, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true }), AccesoDenegado);
      await assert.rejects(guardarServicioSede(db, a.admin.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: null, duracionMinutos: null, sena: null, reservableOnline: true }), DatosInvalidos);
      await guardarServicioSede(db, a.admin.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
      cat = await catalogoSede(db, a.recepcion.id, a.org.id, a.centro.id);
      const e = cat.servicios[0]!.efectivo;
      assert.deepEqual([e.habilitado, e.precio, e.duracionMinutos, e.sena, e.reservableOnline], [true, "30000.00", 50, null, false]);
      assert.ok(e.motivosSinOnline.some(m => m.includes("D3")));
      assert.equal((await catalogoSede(db, a.recepcion.id, a.org.id, a.norte.id)).servicios[0]!.efectivo.habilitado, false, "otra sede no hereda el precio");
      await assert.rejects(catalogoSede(db, a.recepcion.id, a.org.id, a.sur.id), AccesoDenegado);
    });

    await t.test("seña del servicio heredada y excepción por sede; ejemplo $30.000 / $9.000", async () => {
      await guardarServicio(db, a.master.id, a.org.id, datos({ sena: { tipo: "PORCENTAJE", valor: "30" } }), servicioId);
      let e = (await catalogoSede(db, a.recepcion.id, a.org.id, a.centro.id)).servicios[0]!.efectivo;
      assert.deepEqual([e.sena, e.origenSena, e.reservableOnline], ["9000.00", "SERVICIO", true]);
      await guardarServicioSede(db, a.franquiciado.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: "30000", duracionMinutos: 60, sena: { tipo: "FIJA", valor: "12000" }, reservableOnline: true });
      e = (await catalogoSede(db, a.recepcion.id, a.org.id, a.centro.id)).servicios[0]!.efectivo;
      assert.deepEqual([e.sena, e.origenSena, e.duracionMinutos], ["12000.00", "SEDE", 60]);
      await assert.rejects(guardarServicioSede(db, a.admin.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: "10000", duracionMinutos: null, sena: { tipo: "FIJA", valor: "12000" }, reservableOnline: true }), DatosInvalidos, "seña mayor al precio");
      await guardarServicio(db, a.master.id, a.org.id, datos({ sena: { tipo: "FIJA", valor: "20000" } }), servicioId);
      await assert.rejects(guardarServicioSede(db, a.admin.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: "15000", duracionMinutos: null, sena: null, reservableOnline: true }), DatosInvalidos, "seña heredada mayor al precio");
      await guardarServicioSede(db, a.admin.id, a.org.id, a.centro.id, servicioId, { habilitado: true, precio: "15000", duracionMinutos: null, sena: { tipo: "NINGUNA", valor: null }, reservableOnline: false });
      e = (await catalogoSede(db, a.recepcion.id, a.org.id, a.centro.id)).servicios[0]!.efectivo;
      assert.deepEqual([e.sena, e.reservableOnline], ["0.00", false], "solo recepción");
    });

    await t.test("servicio inactivo deja de estar habilitado en todas las sedes", async () => {
      await guardarServicio(db, a.master.id, a.org.id, datos({ activo: false }), servicioId);
      assert.equal((await catalogoSede(db, a.admin.id, a.org.id, a.centro.id)).servicios[0]!.efectivo.habilitado, false);
    });
  } finally { await db.$disconnect(); }
});
