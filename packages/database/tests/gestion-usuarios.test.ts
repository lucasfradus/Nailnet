import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { cambiarRol, crearUsuario, editarUsuario, obtenerUsuario, otorgarRol } from "../src/usuarios.ts";
import { DemasiadosIntentos, PasswordInvalida, emitirTokenAcceso, establecerPassword, iniciarSesion, validarSesion } from "../src/auth.ts";
import { PasswordActualIncorrecta, cambiarMiEmail, cambiarMiNombre, cambiarMiPassword, cerrarOtrasSesiones, datosCuenta } from "../src/cuenta.ts";
import { crearFixture } from "../prisma/fixture.ts";

const recepcion = (sedeId: string) => ({ rol: "RECEPCIONISTA" as const, alcance: "SEDE" as const, franquiciadoId: null, sedeId });
const adminDe = (sedeId: string) => ({ rol: "ADMIN_SEDE" as const, alcance: "SEDE" as const, franquiciadoId: null, sedeId });

test("gestión de usuarios: edición, cambio de rol y Mi cuenta", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const email = (n: string) => `${n}-${a.org.id}@example.invalid`;
    const nuevo = async (n: string, asignacion = recepcion(a.centro.id)) => (await crearUsuario(db, a.master.id, a.org.id, { email: email(n), nombre: n, asignacion })).usuarioId;

    await t.test("editar: nombre y email dentro del alcance; cambiar el email cierra sesiones y anula enlaces", async () => {
      const id = await nuevo("editable");
      await establecerPassword(db, id, "clave del editable");
      const { token } = await iniciarSesion(db, { email: email("editable"), password: "clave del editable" });
      await db.$transaction(tx => emitirTokenAcceso(tx, id, 60_000));

      // El franquiciado A administra a quien trabaja en sus sedes; no a quien está en Sur (franquiciado B).
      // El admin de sede ve usuarios pero no los administra.
      assert.deepEqual(await editarUsuario(db, a.franquiciado.id, a.org.id, id, { nombre: "  Editada   Bien ", email: email("editable") }), { cambiaEmail: false, cambiaNombre: true });
      assert.equal((await db.usuario.findUniqueOrThrow({ where: { id } })).nombre, "Editada Bien");
      assert.ok(await validarSesion(db, token), "cambiar solo el nombre no cierra sesiones");
      const deSur = await nuevo("de-sur", recepcion(a.sur.id));
      await assert.rejects(editarUsuario(db, a.franquiciado.id, a.org.id, deSur, { nombre: "X", email: email("x") }), AccesoDenegado);
      await assert.rejects(editarUsuario(db, a.admin.id, a.org.id, id, { nombre: "X", email: email("x") }), AccesoDenegado);

      await editarUsuario(db, a.franquiciado.id, a.org.id, id, { nombre: "Editada Bien", email: email("EDITADA-nueva") });
      assert.equal((await db.usuario.findUniqueOrThrow({ where: { id } })).email, email("editada-nueva"), "el email se normaliza");
      assert.equal(await validarSesion(db, token), null, "cambiar el email cierra la sesión");
      assert.equal(await db.tokenRecuperacion.count({ where: { usuarioId: id, usadoEn: null } }), 0, "y anula los enlaces pendientes");
      await iniciarSesion(db, { email: email("editada-nueva"), password: "clave del editable" });

      const audit = await db.auditLog.findMany({ where: { accion: "usuario.editar", entidadId: id } });
      assert.equal(audit.length, 2);
      assert.equal(JSON.stringify(audit).includes("editada-nueva"), false, "la auditoría no guarda el email");
    });

    await t.test("editar: rechaza lo propio, emails repetidos y el email de quien está en otra organización", async () => {
      const id = await nuevo("compartido");
      await assert.rejects(editarUsuario(db, a.master.id, a.org.id, a.master.id, { nombre: "Yo", email: email("master") }), DatosInvalidos);
      await assert.rejects(editarUsuario(db, a.master.id, a.org.id, id, { nombre: "compartido", email: a.admin.email }), DatosInvalidos, "email de otro usuario");
      await assert.rejects(editarUsuario(db, a.master.id, a.org.id, id, { nombre: "compartido", email: "no-es-email" }), DatosInvalidos);
      await assert.rejects(editarUsuario(db, b.master.id, b.org.id, id, { nombre: "X", email: email("x") }), AccesoDenegado, "otra organización no lo ve");

      await crearUsuario(db, b.master.id, b.org.id, { email: email("compartido"), nombre: "otro nombre", asignacion: recepcion(b.centro.id) });
      await assert.rejects(editarUsuario(db, a.master.id, a.org.id, id, { nombre: "compartido", email: email("compartido-2") }), DatosInvalidos, "también está en otra organización");
      await editarUsuario(db, a.master.id, a.org.id, id, { nombre: "Compartido Corregido", email: email("compartido") });
    });

    await t.test("cambiar rol: en un paso, conservando la asignación, y solo hacia roles que el actor puede dar", async () => {
      const id = await nuevo("rotativo");
      const asig = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: id, organizacionId: a.org.id } });
      await assert.rejects(cambiarRol(db, a.admin.id, a.org.id, asig.id, recepcion(a.norte.id)), AccesoDenegado, "admin de Centro no da roles en Norte");
      await assert.rejects(cambiarRol(db, a.admin.id, a.org.id, asig.id, adminDe(a.centro.id)), AccesoDenegado, "admin de sede no nombra admins");
      await cambiarRol(db, a.franquiciado.id, a.org.id, asig.id, adminDe(a.centro.id));
      const cambiada = await db.asignacionRol.findUniqueOrThrow({ where: { id: asig.id } });
      assert.equal(cambiada.rol, "ADMIN_SEDE");
      assert.equal(cambiada.sedeId, a.centro.id);

      await otorgarRol(db, a.master.id, a.org.id, id, recepcion(a.norte.id));
      await assert.rejects(cambiarRol(db, a.master.id, a.org.id, asig.id, recepcion(a.norte.id)), DatosInvalidos, "ya tiene ese rol");
      const propia = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: a.franquiciado.id } });
      await assert.rejects(cambiarRol(db, a.franquiciado.id, a.org.id, propia.id, adminDe(a.centro.id)), AccesoDenegado);
      await assert.rejects(cambiarRol(db, a.master.id, a.org.id, "x", adminDe(a.centro.id)), AccesoDenegado);
      assert.ok(await db.auditLog.findFirst({ where: { accion: "rol.cambiar", entidadId: asig.id } }));
    });

    await t.test("ficha: último ingreso y nada fuera del alcance", async () => {
      const id = await nuevo("con-ingreso");
      assert.equal((await obtenerUsuario(db, a.master.id, a.org.id, id))!.ultimoIngreso, null);
      await establecerPassword(db, id, "clave con ingreso");
      await iniciarSesion(db, { email: email("con-ingreso"), password: "clave con ingreso" });
      assert.ok((await obtenerUsuario(db, a.master.id, a.org.id, id))!.ultimoIngreso instanceof Date);
      assert.equal(await obtenerUsuario(db, b.master.id, b.org.id, id), null);
      await assert.rejects(obtenerUsuario(db, a.recepcion.id, a.org.id, id), AccesoDenegado);
    });

    await t.test("Mi cuenta: contraseña y email piden la actual y cierran las demás sesiones, no la propia", async () => {
      const id = await nuevo("mi-cuenta");
      await establecerPassword(db, id, "clave original larga");
      const aca = await iniciarSesion(db, { email: email("mi-cuenta"), password: "clave original larga" });
      const otra = await iniciarSesion(db, { email: email("mi-cuenta"), password: "clave original larga" });
      const sesionAca = (await validarSesion(db, aca.token))!.sesionId;
      assert.equal((await datosCuenta(db, id, sesionAca)).otrasSesiones, 1);

      await assert.rejects(cambiarMiPassword(db, id, sesionAca, { actual: "equivocada", nueva: "clave nueva bien larga" }), PasswordActualIncorrecta);
      await assert.rejects(cambiarMiPassword(db, id, sesionAca, { actual: "clave original larga", nueva: "corta" }), PasswordInvalida);
      await cambiarMiPassword(db, id, sesionAca, { actual: "clave original larga", nueva: "clave nueva bien larga" });
      assert.ok(await validarSesion(db, aca.token), "la sesión desde la que se cambió sigue abierta");
      assert.equal(await validarSesion(db, otra.token), null, "las demás se cierran");
      await iniciarSesion(db, { email: email("mi-cuenta"), password: "clave nueva bien larga" });

      await assert.rejects(cambiarMiEmail(db, id, sesionAca, { email: email("mi-cuenta-2"), password: "equivocada" }), PasswordActualIncorrecta);
      await assert.rejects(cambiarMiEmail(db, id, sesionAca, { email: a.admin.email, password: "clave nueva bien larga" }), DatosInvalidos);
      await cambiarMiEmail(db, id, sesionAca, { email: email("mi-cuenta-2"), password: "clave nueva bien larga" });
      await iniciarSesion(db, { email: email("mi-cuenta-2"), password: "clave nueva bien larga" });
      assert.ok(await validarSesion(db, aca.token));

      await cambiarMiNombre(db, id, "  Nombre   Propio ");
      assert.equal((await db.usuario.findUniqueOrThrow({ where: { id } })).nombre, "Nombre Propio");
      await assert.rejects(cambiarMiNombre(db, id, "   "), DatosInvalidos);
      assert.equal(await cerrarOtrasSesiones(db, id, sesionAca), 1, "cierra la sesión del último ingreso");
      assert.ok(await validarSesion(db, aca.token));
      assert.ok(await db.auditLog.findFirst({ where: { organizacionId: a.org.id, accion: "cuenta.password", entidadId: id } }));
    });

    await t.test("Mi cuenta: la contraseña actual tiene el mismo límite de intentos que el login", async () => {
      const id = await nuevo("adivinador");
      await establecerPassword(db, id, "clave del adivinador");
      const { token } = await iniciarSesion(db, { email: email("adivinador"), password: "clave del adivinador" });
      const sesionId = (await validarSesion(db, token))!.sesionId;
      for (let i = 0; i < 5; i++) await assert.rejects(cambiarMiPassword(db, id, sesionId, { actual: `mala ${i}`, nueva: "clave nueva bien larga" }), PasswordActualIncorrecta);
      await assert.rejects(cambiarMiPassword(db, id, sesionId, { actual: "clave del adivinador", nueva: "clave nueva bien larga" }), DemasiadosIntentos);
    });
  } finally { await db.$disconnect(); }
});
