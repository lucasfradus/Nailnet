import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { SecretoIlegible, llaveroDesde } from "@nailnet/domain/secretos";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { actualizarConfiguracionOrganizacion, actualizarConfiguracionSede, configuracionEfectiva, eliminarCredencial, guardarCredencial, leerCredencial, listarCredenciales, obtenerConfiguracion, recifrarCredenciales, renovarTokensPorVencer, tieneCuentaMercadoPago, tokenMercadoPago, vincularMercadoPago, type RenovadorTokens, type TokensOAuth } from "../src/configuracion.ts";
import { crearFixture } from "../prisma/fixture.ts";

const k1 = randomBytes(32).toString("base64"), k2 = randomBytes(32).toString("base64");
const v1 = llaveroDesde(`v1:${k1}`, "v1");
const v2 = llaveroDesde(`v1:${k1};v2:${k2}`, "v2");
const cuenta = () => String(Date.now()) + String(Math.floor(Math.random() * 1e6));
const tokens = (cuentaId: string, accessToken = "APP_USR-" + "a1".repeat(20), dias = 180, desde = new Date()): TokensOAuth =>
  ({ accessToken, refreshToken: "TG-" + randomBytes(12).toString("hex"), publicKey: "APP_USR-pk-1234abcd", cuentaId, expiraEn: new Date(desde.getTime() + dias * 86_400_000) });
let cuentaNorte = "";

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
      await assert.rejects(vincularMercadoPago(db, a.admin.id, a.org.id, a.centro.id, "PRUEBA", tokens(id), v1), AccesoDenegado);
      await assert.rejects(vincularMercadoPago(db, a.franquiciado.id, a.org.id, a.sur.id, "PRUEBA", tokens(id), v1), AccesoDenegado);
      await assert.rejects(vincularMercadoPago(db, a.franquiciado.id, a.org.id, a.centro.id, "PRUEBA", tokens("abc"), v1), DatosInvalidos);
      await assert.rejects(vincularMercadoPago(db, a.franquiciado.id, a.org.id, a.centro.id, "OTRO", tokens(id), v1), DatosInvalidos);
      // Mercado Pago solo por OAuth: pegar los tokens a mano se rechaza aunque tengan buen formato.
      await assert.rejects(guardarCredencial(db, a.franquiciado.id, a.org.id, a.centro.id, "MERCADO_PAGO", "PRUEBA", { cuentaId: id, publicKey: "TEST-pk-1234abcd", accessToken: "TEST-" + "a1".repeat(20), refreshToken: "TG-" + "b".repeat(20) }, v1), DatosInvalidos);
      await assert.rejects(guardarCredencial(db, a.franquiciado.id, a.org.id, a.centro.id, "OTRO", "PRUEBA", {}, v1), DatosInvalidos);
      const t1 = tokens(id, "APP_USR-" + "z9".repeat(20));
      await vincularMercadoPago(db, a.franquiciado.id, a.org.id, a.centro.id, "PRUEBA", t1, v1);
      const fila = await db.credencialProveedor.findFirstOrThrow({ where: { sedeId: a.centro.id } });
      for (const s of [t1.accessToken, t1.refreshToken]) assert.equal(JSON.stringify(fila).includes(s), false, "sin texto plano en la base");
      assert.equal(fila.tokenVenceEn?.getTime(), t1.expiraEn.getTime());
      const lista = await listarCredenciales(db, a.franquiciado.id, a.org.id, a.centro.id, v1);
      assert.equal(JSON.stringify(lista).includes(t1.accessToken) || JSON.stringify(lista).includes(t1.refreshToken), false, "sin secretos en la respuesta");
      assert.equal(lista[0]?.pista, "••••z9z9");
      assert.equal(lista[0]?.publicos.cuentaId, id);
      await assert.rejects(listarCredenciales(db, a.admin.id, a.org.id, a.centro.id, v1), AccesoDenegado);
      assert.equal((await leerCredencial(db, a.centro.id, "MERCADO_PAGO", "PRUEBA", v1))?.secretos.accessToken, t1.accessToken);
      assert.equal(await tieneCuentaMercadoPago(db, a.centro.id, "PRUEBA"), true);
      assert.equal(await tieneCuentaMercadoPago(db, a.centro.id, "PRODUCCION"), false);
      const audit = await db.auditLog.findMany({ where: { organizacionId: a.org.id, accion: "credencial.vincular" } });
      assert.equal(audit.length, 1);
      assert.equal(JSON.stringify(audit).includes(t1.accessToken) || JSON.stringify(audit).includes(t1.refreshToken), false, "sin secretos en auditoría");
    });

    await t.test("una cuenta receptora no se comparte entre sedes; ambientes separados", async () => {
      cuentaNorte = cuenta();
      await vincularMercadoPago(db, a.master.id, a.org.id, a.norte.id, "PRUEBA", tokens(cuentaNorte), v1);
      await assert.rejects(vincularMercadoPago(db, b.master.id, b.org.id, b.centro.id, "PRUEBA", tokens(cuentaNorte), v1), (e: unknown) => e instanceof DatosInvalidos && /otra sede/.test(e.message));
      // Volver a conectar la misma cuenta en la misma sede reemplaza los tokens.
      await vincularMercadoPago(db, a.master.id, a.org.id, a.norte.id, "PRUEBA", tokens(cuentaNorte), v1);
      await vincularMercadoPago(db, a.master.id, a.org.id, a.norte.id, "PRODUCCION", tokens(cuenta()), v1);
      await guardarCredencial(db, a.master.id, a.org.id, a.norte.id, "FACTURANTE", "PRUEBA", { companyId: "12", subsidiaryId: "3", usuario: "api-user", password: "secreto-facturante" }, v1);
      assert.equal((await listarCredenciales(db, a.master.id, a.org.id, a.norte.id, v1)).length, 3);
    });

    await t.test("un secreto copiado a otra sede no descifra", async () => {
      const origen = await db.credencialProveedor.findFirstOrThrow({ where: { sedeId: a.centro.id, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA" } });
      await vincularMercadoPago(db, a.master.id, a.org.id, a.sur.id, "PRUEBA", tokens(cuenta()), v1);
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

    await t.test("token de Mercado Pago: se renueva antes de vencer, una sola vez aunque se pida a la vez", async () => {
      const ahora = new Date(), dia = 86_400_000;
      let llamadas = 0;
      const nuevos = tokens(cuentaNorte, "APP_USR-" + "r3".repeat(20), 180, new Date(ahora.getTime() + 160 * dia));
      const renovar: RenovadorTokens = async () => { llamadas++; await new Promise(r => setTimeout(r, 50)); return nuevos; };

      const inicial = await tokenMercadoPago(db, a.norte.id, "PRUEBA", renovar, ahora, v2);
      assert.equal(llamadas, 0, "lejos del vencimiento no renueva");
      assert.equal(inicial?.cuentaId, cuentaNorte);

      const tarde = new Date(ahora.getTime() + 160 * dia);
      const r = await Promise.all([1, 2, 3].map(() => tokenMercadoPago(db, a.norte.id, "PRUEBA", renovar, tarde, v2)));
      assert.equal(llamadas, 1, "el refresh token es de un solo uso: una sola renovación");
      assert.ok(r.every(x => x?.accessToken === nuevos.accessToken));
      const fila = await db.credencialProveedor.findFirstOrThrow({ where: { sedeId: a.norte.id, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA" } });
      assert.equal(fila.tokenVenceEn?.getTime(), nuevos.expiraEn.getTime());
      assert.equal((await leerCredencial(db, a.norte.id, "MERCADO_PAGO", "PRUEBA", v2))?.secretos.refreshToken, nuevos.refreshToken);

      // Renovación que falla: mientras el token no venció se sigue usando; vencido, el error sube.
      const falla: RenovadorTokens = async () => { throw new Error("invalid_grant"); };
      const casi = new Date(nuevos.expiraEn.getTime() - dia);
      assert.equal((await tokenMercadoPago(db, a.norte.id, "PRUEBA", falla, casi, v2))?.accessToken, nuevos.accessToken);
      await assert.rejects(tokenMercadoPago(db, a.norte.id, "PRUEBA", falla, new Date(nuevos.expiraEn.getTime() + dia), v2), /invalid_grant/);
      // Nunca reemplaza la cuenta receptora en silencio.
      const otraCuenta: RenovadorTokens = async () => tokens(cuenta());
      assert.equal((await tokenMercadoPago(db, a.norte.id, "PRUEBA", otraCuenta, casi, v2))?.cuentaId, cuentaNorte);
      assert.equal((await db.credencialProveedor.findFirstOrThrow({ where: { sedeId: a.norte.id, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA" } })).cuentaExterna, cuentaNorte);

      // Tarea del worker: renueva todo lo que entra en el margen; una cuenta que falla no frena a las demás.
      const lejos = new Date(ahora.getTime() + 400 * dia);
      const cuentas = new Map<string, string>();
      for (const [sede, amb] of [[a.centro.id, "PRUEBA"], [a.norte.id, "PRUEBA"], [a.norte.id, "PRODUCCION"]] as const) {
        const c = (await leerCredencial(db, sede, "MERCADO_PAGO", amb, v2))!;
        cuentas.set(c.secretos.refreshToken!, c.publicos.cuentaId!);
      }
      let tarea = 0;
      const resultado = await renovarTokensPorVencer(db, async rt => { if (++tarea === 1) throw new Error("falla una"); return tokens(cuentas.get(rt)!, undefined, 180, lejos); }, lejos, v2);
      assert.deepEqual(resultado, { renovadas: cuentas.size - 1, fallidas: 1 });
      assert.equal(await tokenMercadoPago(db, a.norte.id, "PRUEBA", null, lejos, v2).then(x => x?.cuentaId), cuentaNorte, "sin renovador devuelve el guardado");
    });
  } finally { await db.$disconnect(); }
});
