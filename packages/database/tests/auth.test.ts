import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/client.ts";
import { CredencialesInvalidas, DemasiadosIntentos, PasswordInvalida, POLITICA_ACCESO, TokenInvalido, cerrarSesion, establecerPassword, iniciarSesion, restablecerPassword, solicitarRecuperacion, validarSesion } from "../src/auth.ts";
import { crearFixture } from "../prisma/fixture.ts";
import { hashToken } from "@nailnet/domain/credenciales";

const CLAVE = "clave de prueba suficientemente larga";

test("autenticación PostgreSQL: sesiones, límites y recuperación", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    for (const u of [a.master, a.admin, a.recepcion, a.sinRol, a.franquiciado]) await establecerPassword(db, u.id, CLAVE);

    await t.test("login correcto crea una sesión que solo guarda el hash del token", async () => {
      const { token, expiraEn } = await iniciarSesion(db, { email: `  ${a.master.email.toUpperCase()} `, password: CLAVE });
      assert.ok(expiraEn.getTime() > Date.now());
      const sesion = await validarSesion(db, token);
      assert.equal(sesion?.usuario.id, a.master.id);
      assert.equal(await db.sesion.count({ where: { tokenHash: token } }), 0);
      await cerrarSesion(db, token);
      assert.equal(await validarSesion(db, token), null);
    });

    await t.test("errores indistinguibles para email inexistente, clave incorrecta o usuario sin contraseña", async () => {
      await assert.rejects(iniciarSesion(db, { email: "nadie@example.invalid", password: CLAVE }), CredencialesInvalidas);
      await assert.rejects(iniciarSesion(db, { email: a.admin.email, password: "otra clave cualquiera" }), CredencialesInvalidas);
      await assert.rejects(iniciarSesion(db, { email: a.profesional.email, password: CLAVE }), CredencialesInvalidas);
    });

    await t.test("usuario sin membresía activa no obtiene sesión", async () => {
      await db.membresiaOrganizacion.update({ where: { organizacionId_usuarioId: { organizacionId: a.org.id, usuarioId: a.sinRol.id } }, data: { activo: false } });
      await assert.rejects(iniciarSesion(db, { email: a.sinRol.email, password: CLAVE }), CredencialesInvalidas);
    });

    await t.test("bloqueo durable tras fallos consecutivos, también en paralelo", async () => {
      const email = a.recepcion.email;
      const intentos = Array.from({ length: POLITICA_ACCESO.maxFallosPorEmail + 3 }, () => iniciarSesion(db, { email, password: "clave equivocada 123" }).catch(e => e));
      const errores = await Promise.all(intentos);
      assert.equal(errores.filter(e => e instanceof CredencialesInvalidas).length, POLITICA_ACCESO.maxFallosPorEmail);
      assert.equal(errores.filter(e => e instanceof DemasiadosIntentos).length, 3);
      // Incluso con la clave correcta, el bloqueo sigue vigente dentro de la ventana.
      await assert.rejects(iniciarSesion(db, { email, password: CLAVE }), DemasiadosIntentos);
      await db.intentoAcceso.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - POLITICA_ACCESO.ventanaIntentosMs - 1000) } });
      await validarSesion(db, (await iniciarSesion(db, { email, password: CLAVE })).token);
    });

    await t.test("límite por IP ante muchos emails distintos", async () => {
      const ip = "203.0.113.7";
      for (let i = 0; i < POLITICA_ACCESO.maxFallosPorIp; i++) await assert.rejects(iniciarSesion(db, { email: `x${i}@example.invalid`, password: "clave equivocada 123", ip }), CredencialesInvalidas);
      await assert.rejects(iniciarSesion(db, { email: a.admin.email, password: CLAVE, ip }), DemasiadosIntentos);
      await iniciarSesion(db, { email: a.admin.email, password: CLAVE, ip: "198.51.100.1" });
    });

    await t.test("desactivar usuario invalida sesiones abiertas", async () => {
      const { token } = await iniciarSesion(db, { email: a.franquiciado.email, password: CLAVE });
      assert.ok(await validarSesion(db, token));
      await db.usuario.update({ where: { id: a.franquiciado.id }, data: { activo: false } });
      assert.equal(await validarSesion(db, token), null);
      await db.usuario.update({ where: { id: a.franquiciado.id }, data: { activo: true } });
      assert.equal(await validarSesion(db, token), null, "reactivar no revive la sesión revocada");
    });

    await t.test("vencimiento absoluto e inactividad", async () => {
      const s1 = await iniciarSesion(db, { email: a.master.email, password: CLAVE });
      const s2 = await iniciarSesion(db, { email: a.master.email, password: CLAVE });
      await db.sesion.update({ where: { tokenHash: hashToken(s1.token) }, data: { createdAt: new Date(Date.now() - 13 * 3600_000), expiraEn: new Date(Date.now() - 1000) } });
      await db.sesion.update({ where: { tokenHash: hashToken(s2.token) }, data: { ultimoUso: new Date(Date.now() - POLITICA_ACCESO.sesionInactividadMs - 1000) } });
      assert.equal(await validarSesion(db, s1.token), null);
      assert.equal(await validarSesion(db, s2.token), null);
    });

    await t.test("tokens mal formados no consultan ni validan", async () => {
      assert.equal(await validarSesion(db, "x"), null);
      assert.equal(await validarSesion(db, undefined), null);
      await assert.rejects(restablecerPassword(db, "no-es-un-token", CLAVE), TokenInvalido);
    });

    await t.test("recuperación: un uso, último enlace vigente y cierre de sesiones", async () => {
      const abierta = await iniciarSesion(db, { email: a.admin.email, password: CLAVE });
      assert.equal(await solicitarRecuperacion(db, { email: "nadie@example.invalid" }), null);
      const primero = await solicitarRecuperacion(db, { email: a.admin.email });
      const segundo = await solicitarRecuperacion(db, { email: a.admin.email });
      assert.ok(primero && segundo);
      await assert.rejects(restablecerPassword(db, segundo.token, "corta"), PasswordInvalida);
      await assert.rejects(restablecerPassword(db, primero.token, "nueva clave bien larga"), TokenInvalido);
      const nueva = "nueva clave bien larga";
      const carrera = await Promise.allSettled([restablecerPassword(db, segundo.token, nueva), restablecerPassword(db, segundo.token, nueva)]);
      assert.equal(carrera.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(await validarSesion(db, abierta.token), null);
      await assert.rejects(iniciarSesion(db, { email: a.admin.email, password: CLAVE }), CredencialesInvalidas);
      await iniciarSesion(db, { email: a.admin.email, password: nueva });
      // Límite de solicitudes: ya se usaron 2 de 3 en la ventana.
      assert.ok(await solicitarRecuperacion(db, { email: a.admin.email }));
      assert.equal(await solicitarRecuperacion(db, { email: a.admin.email }), null);
    });

    await t.test("enlace vencido o de usuario inactivo no sirve", async () => {
      const r = await solicitarRecuperacion(db, { email: a.master.email });
      assert.ok(r);
      await db.tokenRecuperacion.updateMany({ where: { usuarioId: a.master.id, usadoEn: null }, data: { createdAt: new Date(Date.now() - 3600_000), expiraEn: new Date(Date.now() - 1000) } });
      await assert.rejects(restablecerPassword(db, r.token, "otra clave bien larga"), TokenInvalido);
      const r2 = await solicitarRecuperacion(db, { email: a.recepcion.email });
      assert.ok(r2);
      await db.usuario.update({ where: { id: a.recepcion.id }, data: { activo: false } });
      await assert.rejects(restablecerPassword(db, r2.token, "otra clave bien larga"), TokenInvalido);
    });

    await t.test("constraints rechazan hashes y vigencias inválidas", async () => {
      await assert.rejects(db.usuario.update({ where: { id: a.master.id }, data: { passwordHash: "texto-plano" } }));
      await assert.rejects(db.sesion.create({ data: { usuarioId: a.master.id, tokenHash: "0".repeat(64), createdAt: new Date(), expiraEn: new Date(Date.now() - 1000) } }));
      await assert.rejects(db.sesion.create({ data: { usuarioId: a.master.id, tokenHash: "no-hex", expiraEn: new Date(Date.now() + 1000) } }));
    });
  } finally { await db.$disconnect(); }
});
