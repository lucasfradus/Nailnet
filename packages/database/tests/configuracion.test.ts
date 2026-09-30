import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { SecretoIlegible, llaveroDesde } from "@nailnet/domain/secretos";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { actualizarConfiguracionOrganizacion, actualizarConfiguracionSede, configuracionEfectiva, eliminarCredencial, guardarCredencial, leerCredencial, listarCredenciales, obtenerConfiguracion, recifrarCredenciales } from "../src/configuracion.ts";
import { crearFixture } from "../prisma/fixture.ts";

const k1 = randomBytes(32).toString("base64"), k2 = randomBytes(32).toString("base64");
const v1 = llaveroDesde(`v1:${k1}`, "v1");
const v2 = llaveroDesde(`v1:${k1};v2:${k2}`, "v2");
const cuenta = () => String(Date.now()) + String(Math.floor(Math.random() * 1e6));
const mp = (cuentaId: string, token = "TEST-" + "a1".repeat(20)) => ({ cuentaId, publicKey: "TEST-pk-1234abcd", accessToken: token, webhookSecret: "s".repeat(32) });

test("configuración y secretos por sede", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);

    await t.test("herencia: sin valores queda SIN_DEFINIR; la sede pisa a la organización", async () => {
      let c = await obtenerConfiguracion(db, a.recepcion.id, a.org.id, a.centro.id);
      assert.equal(c.efectiva.horizonteReservaDias.origen, "SIN_DEFINIR");
      assert.equal(c.puedeEditarSede, false);
      await actualizarConfiguracionOrganizacion(db, a.master.id, a.org.id, { horizonteReservaDias: 14, anticipacionMinimaMinutos: 60 });
      await actualizarConfiguracionSede(db, a.admin.id, a.org.id, a.centro.id, { horizonteReservaDias: 30 });
      c = await obtenerConfiguracion(db, a.admin.id, a.org.id, a.centro.id);
      assert.deepEqual(c.efectiva.horizonteReservaDias, { valor: 30, origen: "SEDE" });
      assert.deepEqual(c.efectiva.anticipacionMinimaMinutos, { valor: 60, origen: "ORGANIZACION" });
      assert.equal((await configuracionEfectiva(db, a.org.id, a.norte.id)).horizonteReservaDias.valor, 14);
      await actualizarConfiguracionSede(db, a.admin.id, a.org.id, a.centro.id, { horizonteReservaDias: null });
      assert.equal((await configuracionEfectiva(db, a.org.id, a.centro.id)).horizonteReservaDias.origen, "ORGANIZACION");
      assert.equal((await configuracionEfectiva(db, b.org.id, b.centro.id)).horizonteReservaDias.origen, "SIN_DEFINIR", "no se filtra entre organizaciones");
    });

    await t.test("permisos y rangos de configuración", async () => {
      await assert.rejects(actualizarConfiguracionSede(db, a.admin.id, a.org.id, a.norte.id, { horizonteReservaDias: 7 }), AccesoDenegado);
      await assert.rejects(actualizarConfiguracionSede(db, a.recepcion.id, a.org.id, a.centro.id, { horizonteReservaDias: 7 }), AccesoDenegado);
      await assert.rejects(actualizarConfiguracionOrganizacion(db, a.franquiciado.id, a.org.id, { horizonteReservaDias: 7 }), AccesoDenegado);
      await assert.rejects(actualizarConfiguracionSede(db, a.master.id, a.org.id, a.centro.id, { horizonteReservaDias: 400 }), DatosInvalidos);
      await assert.rejects(obtenerConfiguracion(db, a.recepcion.id, a.org.id, a.sur.id), AccesoDenegado);
      await assert.rejects(db.configuracionSede.update({ where: { sedeId: a.centro.id }, data: { anticipacionMinimaMinutos: -1 } }), "check en la base");
    });

    await t.test("credenciales: solo dueño comercial o master; cifradas y nunca expuestas", async () => {
      const id = cuenta();
      await assert.rejects(guardarCredencial(db, a.admin.id, a.org.id, a.centro.id, "MERCADO_PAGO", "PRUEBA", mp(id), v1), AccesoDenegado);
      await assert.rejects(guardarCredencial(db, a.franquiciado.id, a.org.id, a.sur.id, "MERCADO_PAGO", "PRUEBA", mp(id), v1), AccesoDenegado);
      await assert.rejects(guardarCredencial(db, a.franquiciado.id, a.org.id, a.centro.id, "MERCADO_PAGO", "PRUEBA", { ...mp(id), accessToken: "x" }, v1), DatosInvalidos);
      await assert.rejects(guardarCredencial(db, a.franquiciado.id, a.org.id, a.centro.id, "OTRO", "PRUEBA", mp(id), v1), DatosInvalidos);
      const token = "TEST-" + "z9".repeat(20);
      await guardarCredencial(db, a.franquiciado.id, a.org.id, a.centro.id, "MERCADO_PAGO", "PRUEBA", mp(id, token), v1);
      const fila = await db.credencialProveedor.findFirstOrThrow({ where: { sedeId: a.centro.id } });
      assert.equal(JSON.stringify(fila).includes(token), false, "sin texto plano en la base");
      const lista = await listarCredenciales(db, a.franquiciado.id, a.org.id, a.centro.id, v1);
      assert.equal(JSON.stringify(lista).includes(token), false, "sin secretos en la respuesta");
      assert.equal(lista[0]?.pista, "••••z9z9");
      await assert.rejects(listarCredenciales(db, a.admin.id, a.org.id, a.centro.id, v1), AccesoDenegado);
      assert.equal((await leerCredencial(db, a.centro.id, "MERCADO_PAGO", "PRUEBA", v1))?.secretos.accessToken, token);
      const audit = await db.auditLog.findMany({ where: { organizacionId: a.org.id, accion: "credencial.guardar" } });
      assert.equal(JSON.stringify(audit).includes(token), false, "sin secretos en auditoría");
    });

    await t.test("una cuenta receptora no se comparte entre sedes; ambientes separados", async () => {
      const id = cuenta();
      await guardarCredencial(db, a.master.id, a.org.id, a.norte.id, "MERCADO_PAGO", "PRUEBA", mp(id), v1);
      await assert.rejects(guardarCredencial(db, b.master.id, b.org.id, b.centro.id, "MERCADO_PAGO", "PRUEBA", mp(id), v1), DatosInvalidos);
      await guardarCredencial(db, a.master.id, a.org.id, a.norte.id, "MERCADO_PAGO", "PRODUCCION", mp(cuenta()), v1);
      await guardarCredencial(db, a.master.id, a.org.id, a.norte.id, "FACTURANTE", "PRUEBA", { companyId: "12", subsidiaryId: "3", usuario: "api-user", password: "secreto-facturante" }, v1);
      assert.equal((await listarCredenciales(db, a.master.id, a.org.id, a.norte.id, v1)).length, 3);
    });

    await t.test("un secreto copiado a otra sede no descifra", async () => {
      const origen = await db.credencialProveedor.findFirstOrThrow({ where: { sedeId: a.centro.id, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA" } });
      await guardarCredencial(db, a.master.id, a.org.id, a.sur.id, "MERCADO_PAGO", "PRUEBA", mp(cuenta()), v1);
      await db.credencialProveedor.updateMany({ where: { sedeId: a.sur.id, proveedor: "MERCADO_PAGO" }, data: { secretoCifrado: origen.secretoCifrado } });
      await assert.rejects(leerCredencial(db, a.sur.id, "MERCADO_PAGO", "PRUEBA", v1), SecretoIlegible);
      await assert.rejects(db.credencialProveedor.updateMany({ where: { sedeId: a.sur.id }, data: { secretoCifrado: "texto plano" } }), "check de formato");
      await eliminarCredencial(db, a.master.id, a.org.id, a.sur.id, "MERCADO_PAGO", "PRUEBA");
      assert.equal(await db.credencialProveedor.count({ where: { sedeId: a.sur.id } }), 0);
    });

    await t.test("rotación de clave: recifra y sigue legible", async () => {
      assert.ok((await listarCredenciales(db, a.master.id, a.org.id, a.norte.id, v2)).every(c => c.requiereRecifrado));
      assert.ok(await recifrarCredenciales(db, v2) >= 4);
      assert.equal(await recifrarCredenciales(db, v2), 0, "idempotente");
      assert.equal((await leerCredencial(db, a.norte.id, "FACTURANTE", "PRUEBA", llaveroDesde(`v2:${k2}`, "v2")))?.secretos.password, "secreto-facturante");
    });
  } finally { await db.$disconnect(); }
});
