import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/client.ts";
import { listarSedes, renombrarSede } from "../src/access.ts";
import { crearFixture } from "../prisma/fixture.ts";
import { AccesoDenegado } from "@nailnet/domain";

test("fundación PostgreSQL: integridad y autorización por ID", async (t) => {
  // Base explícita; las fixtures tienen IDs aleatorios y no borran datos existentes.
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    await t.test("master ve solo su organización; franquiciado y recepción solo sus sedes", async () => {
      assert.equal((await listarSedes(db, a.master.id, a.org.id)).length, 3);
      for (const actor of [a.franquiciado, a.recepcion]) {
        const ids = (await listarSedes(db, actor.id, a.org.id)).map(s => s.id).sort();
        assert.deepEqual(ids, [a.centro.id, a.norte.id].sort());
        await assert.rejects(listarSedes(db, actor.id, a.org.id, a.sur.id), AccesoDenegado);
      }
      await assert.rejects(listarSedes(db, a.master.id, a.org.id, b.centro.id), AccesoDenegado);
      await assert.rejects(listarSedes(db, a.master.id, b.org.id), AccesoDenegado);
      await assert.rejects(listarSedes(db, a.sinRol.id, a.org.id), AccesoDenegado);
      await assert.rejects(listarSedes(db, a.profesional.id, a.org.id), AccesoDenegado);
    });
    await t.test("escritura por ID respeta permiso y alcance", async () => {
      await assert.rejects(renombrarSede(db, a.recepcion.id, a.org.id, a.centro.id, "No"), AccesoDenegado);
      await assert.rejects(renombrarSede(db, a.admin.id, a.org.id, a.norte.id, "No"), AccesoDenegado);
      await assert.rejects(renombrarSede(db, a.master.id, a.org.id, b.centro.id, "No"), AccesoDenegado);
      await renombrarSede(db, a.admin.id, a.org.id, a.centro.id, "Centro actualizado");
      assert.equal((await db.sede.findUniqueOrThrow({ where: { id: a.centro.id } })).nombre, "Centro actualizado");
      assert.equal((await db.sede.findUniqueOrThrow({ where: { id: b.centro.id } })).nombre, "Centro");
    });
    await t.test("revocación y usuario inactivo se releen", async () => {
      await db.usuario.update({ where: { id: a.admin.id }, data: { activo: false } });
      await assert.rejects(listarSedes(db, a.admin.id, a.org.id), AccesoDenegado);
      await db.asignacionRol.deleteMany({ where: { usuarioId: a.recepcion.id } });
      await assert.rejects(listarSedes(db, a.recepcion.id, a.org.id), AccesoDenegado);
      await db.membresiaOrganizacion.update({ where: { organizacionId_usuarioId: { organizacionId: a.org.id, usuarioId: a.franquiciado.id } }, data: { activo: false } });
      await assert.rejects(listarSedes(db, a.franquiciado.id, a.org.id), AccesoDenegado);
    });
    await t.test("FK compuestas rechazan vínculos entre organizaciones", async () => {
      await assert.rejects(db.sede.create({ data: { organizacionId: a.org.id, franquiciadoId: b.franA.id, nombre: "Inválida" } }));
      await assert.rejects(db.asignacionRol.create({ data: { organizacionId: a.org.id, usuarioId: a.master.id, rol: "ADMIN_SEDE", alcance: "SEDE", sedeId: b.centro.id } }));
      await assert.rejects(db.configuracionFiscalSede.create({ data: { organizacionId: a.org.id, sedeId: a.sur.id, emisorFiscalId: b.emisor.id, ambiente: "PRUEBA", puntoVenta: 3 } }));
    });
    await t.test("checks impiden roles ambiguos y asignaciones duplicadas", async () => {
      await assert.rejects(db.asignacionRol.create({ data: { organizacionId: a.org.id, usuarioId: a.sinRol.id, rol: "MASTER_FRANQUICIADOR", alcance: "SEDE", sedeId: a.centro.id } }));
      await assert.rejects(db.asignacionRol.create({ data: { organizacionId: a.org.id, usuarioId: a.master.id, rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION" } }));
    });
    await t.test("CUIT compartido admite puntos distintos, rechaza duplicados y punto cero", async () => {
      assert.equal(await db.configuracionFiscalSede.count({ where: { emisorFiscalId: a.emisor.id } }), 2);
      await assert.rejects(db.configuracionFiscalSede.create({ data: { organizacionId: a.org.id, sedeId: a.sur.id, emisorFiscalId: a.emisor.id, ambiente: "PRUEBA", puntoVenta: 1 } }));
      await assert.rejects(db.configuracionFiscalSede.create({ data: { organizacionId: a.org.id, sedeId: a.sur.id, emisorFiscalId: a.emisor.id, ambiente: "PRUEBA", puntoVenta: 0 } }));
    });
  } finally { await db.$disconnect(); }
});
