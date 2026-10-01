import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos, actualizarSede, cambiarEstadoSede, crearFranquiciado, crearSede, listarFranquiciados, listarSedes } from "../src/access.ts";
import { cambiarEstadoUsuario, crearUsuario, emitirInvitacion, listarUsuarios, opcionesDeRol, otorgarRol, revocarRol } from "../src/usuarios.ts";
import { establecerPassword, iniciarSesion, restablecerPassword } from "../src/auth.ts";
import { crearFixture } from "../prisma/fixture.ts";

const recepcion = (sedeId: string) => ({ rol: "RECEPCIONISTA" as const, alcance: "SEDE" as const, franquiciadoId: null, sedeId });
const adminDe = (sedeId: string) => ({ rol: "ADMIN_SEDE" as const, alcance: "SEDE" as const, franquiciadoId: null, sedeId });

test("administración de sedes y usuarios con alcance", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const emailNuevo = (n: string) => `${n}-${a.org.id}@example.invalid`;

    await t.test("sedes: franquiciado crea solo en su franquiciado; admin edita pero no crea", async () => {
      const nueva = await crearSede(db, a.franquiciado.id, a.org.id, { franquiciadoId: a.franA.id, nombre: "  Oeste   Nueva " });
      assert.equal((await db.sede.findUniqueOrThrow({ where: { id: nueva.id } })).nombre, "Oeste Nueva");
      await assert.rejects(crearSede(db, a.franquiciado.id, a.org.id, { franquiciadoId: a.franB.id, nombre: "Ajena" }), AccesoDenegado);
      await assert.rejects(crearSede(db, a.admin.id, a.org.id, { franquiciadoId: a.franA.id, nombre: "No" }), AccesoDenegado);
      await assert.rejects(crearSede(db, a.master.id, a.org.id, { franquiciadoId: b.franA.id, nombre: "Otra org" }), AccesoDenegado);
      await assert.rejects(crearSede(db, a.master.id, a.org.id, { franquiciadoId: a.franA.id, nombre: "X", timezone: "Marte/Olympus" }), DatosInvalidos);
      await actualizarSede(db, a.admin.id, a.org.id, a.centro.id, { timezone: "America/Argentina/Cordoba" });
      await assert.rejects(actualizarSede(db, a.admin.id, a.org.id, a.norte.id, { nombre: "No" }), AccesoDenegado);
      await assert.rejects(actualizarSede(db, a.admin.id, a.org.id, a.centro.id, { nombre: "   " }), DatosInvalidos);
    });

    await t.test("sedes inactivas: fuera de la operación, visibles solo para quien puede reactivarlas", async () => {
      await assert.rejects(cambiarEstadoSede(db, a.admin.id, a.org.id, a.centro.id, false), AccesoDenegado);
      await cambiarEstadoSede(db, a.franquiciado.id, a.org.id, a.norte.id, false);
      assert.ok(!(await listarSedes(db, a.recepcion.id, a.org.id)).some(s => s.id === a.norte.id));
      const conInactivas = await listarSedes(db, a.franquiciado.id, a.org.id, { incluirInactivas: true });
      assert.equal(conInactivas.find(s => s.id === a.norte.id)?.activo, false);
      assert.ok(!(await listarSedes(db, a.recepcion.id, a.org.id, { incluirInactivas: true })).some(s => s.id === a.norte.id));
      await cambiarEstadoSede(db, a.franquiciado.id, a.org.id, a.norte.id, true);
    });

    await t.test("franquiciados: solo el master los crea; cada franquiciado ve el suyo", async () => {
      await crearFranquiciado(db, a.master.id, a.org.id, "Franquiciado C");
      await assert.rejects(crearFranquiciado(db, a.franquiciado.id, a.org.id, "No"), AccesoDenegado);
      assert.equal((await listarFranquiciados(db, a.master.id, a.org.id)).length, 3);
      assert.deepEqual((await listarFranquiciados(db, a.franquiciado.id, a.org.id)).map(f => f.id), [a.franA.id]);
      await assert.rejects(listarFranquiciados(db, a.admin.id, a.org.id), AccesoDenegado);
    });

    await t.test("alta de usuario con rol inicial dentro del alcance", async () => {
      const r = await crearUsuario(db, a.franquiciado.id, a.org.id, { email: ` ${emailNuevo("recep2").toUpperCase()}`, nombre: "Recepción Dos", asignacion: recepcion(a.centro.id) });
      assert.equal(r.nuevo, true);
      await assert.rejects(crearUsuario(db, a.franquiciado.id, a.org.id, { email: emailNuevo("x"), nombre: "X", asignacion: recepcion(a.sur.id) }), AccesoDenegado);
      await assert.rejects(crearUsuario(db, a.admin.id, a.org.id, { email: emailNuevo("y"), nombre: "Y", asignacion: recepcion(a.centro.id) }), AccesoDenegado);
      await assert.rejects(crearUsuario(db, a.franquiciado.id, a.org.id, { email: emailNuevo("recep2"), nombre: "Dup", asignacion: recepcion(a.norte.id) }), DatosInvalidos);
      await assert.rejects(crearUsuario(db, a.master.id, a.org.id, { email: "no-es-email", nombre: "Z", asignacion: recepcion(a.centro.id) }), DatosInvalidos);
      await assert.rejects(crearUsuario(db, a.master.id, a.org.id, { email: emailNuevo("z"), nombre: "Z", asignacion: { ...recepcion(a.centro.id), franquiciadoId: a.franA.id } }), DatosInvalidos);
      // Un email de otra organización se incorpora sin duplicar identidad ni tocar su contraseña.
      const existente = await crearUsuario(db, a.master.id, a.org.id, { email: b.admin.email, nombre: "Otro nombre", asignacion: recepcion(a.sur.id) });
      assert.equal(existente.nuevo, false);
      assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: b.admin.id } })).nombre, "admin");
    });

    await t.test("listado respeta alcance y oculta asignaciones de otras sedes", async () => {
      const deAdmin = await listarUsuarios(db, a.admin.id, a.org.id);
      const recep = deAdmin.find(u => u.id === a.recepcion.id);
      assert.ok(recep);
      assert.deepEqual(recep.asignaciones.map(x => x.sedeId), [a.centro.id], "no ve que también trabaja en Norte");
      assert.equal(recep.administrable, false);
      assert.ok(!deAdmin.some(u => u.id === a.master.id));
      const deFran = await listarUsuarios(db, a.franquiciado.id, a.org.id);
      assert.ok(!deFran.some(u => u.id === b.admin.id), "usuario solo de sede Sur no es visible para franA");
      assert.equal(deFran.find(u => u.id === a.recepcion.id)?.administrable, true);
      assert.ok((await listarUsuarios(db, a.master.id, a.org.id)).some(u => u.id === a.sinRol.id));
      await assert.rejects(listarUsuarios(db, a.recepcion.id, a.org.id), AccesoDenegado);
      await assert.rejects(listarUsuarios(db, a.franquiciado.id, a.org.id, { sedeId: a.sur.id }), AccesoDenegado);
      assert.ok((await listarUsuarios(db, a.franquiciado.id, a.org.id, { sedeId: a.norte.id })).every(u => u.asignaciones.some(x => x.sedeId === a.norte.id)));
      const opciones = await opcionesDeRol(db, a.franquiciado.id, a.org.id);
      assert.ok(opciones.every(o => o.asignacion.rol === "ADMIN_SEDE" || o.asignacion.rol === "RECEPCIONISTA"));
      assert.ok(!opciones.some(o => o.asignacion.sedeId === a.sur.id));
    });

    await t.test("otorgar y revocar dentro del alcance", async () => {
      await otorgarRol(db, a.franquiciado.id, a.org.id, a.recepcion.id, adminDe(a.norte.id));
      await assert.rejects(otorgarRol(db, a.franquiciado.id, a.org.id, a.recepcion.id, adminDe(a.norte.id)), DatosInvalidos);
      await assert.rejects(otorgarRol(db, a.franquiciado.id, a.org.id, a.recepcion.id, adminDe(a.sur.id)), AccesoDenegado);
      await assert.rejects(otorgarRol(db, a.franquiciado.id, a.org.id, b.master.id, adminDe(a.norte.id)), AccesoDenegado, "no es miembro");
      const asig = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: a.recepcion.id, rol: "ADMIN_SEDE" } });
      await assert.rejects(revocarRol(db, a.admin.id, a.org.id, asig.id), AccesoDenegado);
      const deMaster = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: a.master.id } });
      await assert.rejects(revocarRol(db, a.franquiciado.id, a.org.id, deMaster.id), AccesoDenegado);
      const deOtraOrg = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: b.recepcion.id } });
      await assert.rejects(revocarRol(db, a.master.id, a.org.id, deOtraOrg.id), AccesoDenegado);
      await revocarRol(db, a.franquiciado.id, a.org.id, asig.id);
      assert.equal(await db.auditLog.count({ where: { organizacionId: a.org.id, accion: { in: ["rol.otorgar", "rol.revocar"] } } }), 2);
    });

    await t.test("siempre queda un master activo", async () => {
      const unico = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: a.master.id, rol: "MASTER_FRANQUICIADOR" } });
      await assert.rejects(revocarRol(db, a.master.id, a.org.id, unico.id), DatosInvalidos);
      await assert.rejects(cambiarEstadoUsuario(db, a.master.id, a.org.id, a.master.id, false), DatosInvalidos);
      await otorgarRol(db, a.master.id, a.org.id, a.sinRol.id, { rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION", franquiciadoId: null, sedeId: null });
      await cambiarEstadoUsuario(db, a.sinRol.id, a.org.id, a.master.id, false);
      await assert.rejects(cambiarEstadoUsuario(db, a.master.id, a.org.id, a.sinRol.id, false), AccesoDenegado, "master desactivado ya no opera");
      await assert.rejects(cambiarEstadoUsuario(db, a.sinRol.id, a.org.id, a.sinRol.id, false), DatosInvalidos);
      await cambiarEstadoUsuario(db, a.sinRol.id, a.org.id, a.master.id, true);
    });

    await t.test("desactivar corta el acceso a la organización en la siguiente operación", async () => {
      await establecerPassword(db, a.recepcion.id, "clave de prueba bien larga");
      await assert.rejects(cambiarEstadoUsuario(db, a.admin.id, a.org.id, a.recepcion.id, false), AccesoDenegado);
      await cambiarEstadoUsuario(db, a.franquiciado.id, a.org.id, a.recepcion.id, false);
      await assert.rejects(listarSedes(db, a.recepcion.id, a.org.id), AccesoDenegado);
      await assert.rejects(iniciarSesion(db, { email: a.recepcion.email, password: "clave de prueba bien larga" }));
      await cambiarEstadoUsuario(db, a.franquiciado.id, a.org.id, a.recepcion.id, true);
    });

    await t.test("invitación: solo usuarios sin contraseña y dentro del alcance", async () => {
      const recep2 = await db.usuario.findUniqueOrThrow({ where: { email: emailNuevo("recep2") } });
      await assert.rejects(emitirInvitacion(db, a.admin.id, a.org.id, recep2.id), AccesoDenegado);
      const { token } = await emitirInvitacion(db, a.franquiciado.id, a.org.id, recep2.id);
      await assert.rejects(emitirInvitacion(db, a.franquiciado.id, a.org.id, a.recepcion.id), DatosInvalidos, "ya tiene contraseña");
      await restablecerPassword(db, token, "mi clave de activación");
      await iniciarSesion(db, { email: recep2.email, password: "mi clave de activación" });
      const audit = await db.auditLog.findFirstOrThrow({ where: { accion: "usuario.invitar", entidadId: recep2.id } });
      assert.equal(JSON.stringify(audit).includes(token), false, "la auditoría no guarda el token");
    });

    await t.test("IDs mal formados se rechazan como acceso denegado, sin llegar a la base", async () => {
      await assert.rejects(crearSede(db, a.master.id, a.org.id, { franquiciadoId: "", nombre: "X" }), AccesoDenegado);
      await assert.rejects(actualizarSede(db, a.master.id, a.org.id, "no-uuid", { nombre: "X" }), AccesoDenegado);
      await assert.rejects(listarSedes(db, a.master.id, a.org.id, { sedeId: "'; drop" }), AccesoDenegado);
      await assert.rejects(revocarRol(db, a.master.id, a.org.id, ""), AccesoDenegado);
      await assert.rejects(otorgarRol(db, a.master.id, a.org.id, a.admin.id, recepcion("x")), AccesoDenegado);
      await assert.rejects(listarUsuarios(db, a.master.id, a.org.id, { sedeId: "x" }), AccesoDenegado);
      await assert.rejects(emitirInvitacion(db, a.master.id, a.org.id, "x"), AccesoDenegado);
    });

    await t.test("la auditoría es inmutable", async () => {
      const fila = await db.auditLog.findFirstOrThrow({ where: { organizacionId: a.org.id } });
      await assert.rejects(db.auditLog.update({ where: { id: fila.id }, data: { accion: "x" } }));
      await assert.rejects(db.auditLog.delete({ where: { id: fila.id } }));
    });

    await t.test("revocación concurrente: una operación no se cuela con permisos viejos", async () => {
      const asig = await db.asignacionRol.findFirstOrThrow({ where: { usuarioId: a.franquiciado.id, rol: "FRANQUICIADO" } });
      const resultados = await Promise.allSettled([
        revocarRol(db, a.master.id, a.org.id, asig.id),
        crearUsuario(db, a.franquiciado.id, a.org.id, { email: emailNuevo("carrera"), nombre: "Carrera", asignacion: recepcion(a.centro.id) }),
      ]);
      assert.equal(resultados[0].status, "fulfilled");
      const creado = await db.usuario.findUnique({ where: { email: emailNuevo("carrera") } });
      // Serializadas: o se creó antes de revocar (válido) o se rechazó después. Nunca después de revocar.
      if (creado) {
        const alta = await db.auditLog.findFirstOrThrow({ where: { accion: "usuario.crear", entidadId: creado.id } });
        const baja = await db.auditLog.findFirstOrThrow({ where: { accion: "rol.revocar", entidadId: asig.id } });
        assert.ok(alta.createdAt <= baja.createdAt);
      } else assert.equal(resultados[1].status, "rejected");
      await assert.rejects(crearUsuario(db, a.franquiciado.id, a.org.id, { email: emailNuevo("tarde"), nombre: "Tarde", asignacion: recepcion(a.centro.id) }), AccesoDenegado);
    });
  } finally { await db.$disconnect(); }
});
