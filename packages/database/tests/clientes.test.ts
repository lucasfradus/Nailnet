import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { actualizarCliente, actualizarObservaciones, buscarParaVincular, crearCliente, listarClientes, obtenerCliente, publicarConsentimiento, registrarConsentimiento, textoConsentimiento, vincularCliente } from "../src/clientes.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TEXTO = "Declaro haber sido informada sobre la práctica, sus cuidados previos y posteriores.";

test("clientes compartidos y consentimientos", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    // Recepción de Sur (franquiciado B) para probar la separación entre franquiciados.
    const recepSur = await db.usuario.create({ data: { email: `recep-sur-${a.org.id}@example.invalid`, nombre: "Recep Sur", membresias: { create: { organizacionId: a.org.id } } } });
    await db.asignacionRol.create({ data: { organizacionId: a.org.id, usuarioId: recepSur.id, rol: "RECEPCIONISTA", alcance: "SEDE", sedeId: a.sur.id } });
    const email = `ana-${a.org.id}@example.invalid`;
    let anaId = "";

    await t.test("alta en una sede del alcance; contacto obligatorio; duplicado por email rechazado", async () => {
      anaId = (await crearCliente(db, a.recepcion.id, a.org.id, a.centro.id, { nombre: "Ana", apellido: "Pérez", email: email.toUpperCase(), telefono: "11 3328 7024" })).id;
      await assert.rejects(crearCliente(db, a.recepcion.id, a.org.id, a.sur.id, { nombre: "X", email: "x@example.invalid" }), AccesoDenegado);
      await assert.rejects(crearCliente(db, a.recepcion.id, a.org.id, a.centro.id, { nombre: "Sin contacto" }), DatosInvalidos);
      await assert.rejects(crearCliente(db, recepSur.id, a.org.id, a.sur.id, { nombre: "Ana bis", email }), DatosInvalidos);
      await assert.rejects(crearCliente(db, a.profesional.id, a.org.id, a.centro.id, { nombre: "X", email: "p@example.invalid" }), AccesoDenegado);
      await assert.rejects(db.cliente.create({ data: { organizacionId: a.org.id, nombre: "Sin contacto" } }), "check en la base");
      // Otra organización puede tener el mismo email: no se comparten clientes entre organizaciones.
      await crearCliente(db, b.recepcion.id, b.org.id, b.centro.id, { nombre: "Ana en B", email });
    });

    await t.test("listado por alcance: otro franquiciado no la ve por nombre", async () => {
      assert.ok((await listarClientes(db, a.recepcion.id, a.org.id, { texto: "pér" })).some(c => c.id === anaId));
      assert.ok((await listarClientes(db, a.recepcion.id, a.org.id, { texto: "7024" })).some(c => c.id === anaId));
      assert.equal((await listarClientes(db, recepSur.id, a.org.id, { texto: "Ana" })).length, 0);
      assert.equal((await listarClientes(db, a.master.id, a.org.id)).filter(c => c.id === anaId).length, 1);
      await assert.rejects(listarClientes(db, recepSur.id, a.org.id, { sedeId: a.centro.id }), AccesoDenegado);
      await assert.rejects(listarClientes(db, a.profesional.id, a.org.id), AccesoDenegado);
      await assert.rejects(obtenerCliente(db, recepSur.id, a.org.id, anaId), AccesoDenegado);
      await assert.rejects(obtenerCliente(db, b.master.id, b.org.id, anaId), AccesoDenegado, "otra organización");
    });

    await t.test("vincular por email o teléfono exacto (D13) sin duplicar la identidad", async () => {
      await assert.rejects(buscarParaVincular(db, recepSur.id, a.org.id, "Ana"), DatosInvalidos, "por nombre no busca");
      const [encontrada] = await buscarParaVincular(db, recepSur.id, a.org.id, ` ${email} `);
      assert.equal(encontrada?.id, anaId);
      assert.deepEqual(encontrada?.sedes, []);
      assert.equal((await buscarParaVincular(db, recepSur.id, a.org.id, "+11 3328-7024")).length, 0, "normaliza distinto con prefijo: sin coincidencia parcial");
      assert.equal((await buscarParaVincular(db, recepSur.id, a.org.id, "11 3328 7024"))[0]?.id, anaId);
      await vincularCliente(db, recepSur.id, a.org.id, anaId, a.sur.id);
      await vincularCliente(db, recepSur.id, a.org.id, anaId, a.sur.id);
      assert.equal(await db.cliente.count({ where: { organizacionId: a.org.id, email } }), 1);
      await assert.rejects(vincularCliente(db, recepSur.id, a.org.id, anaId, a.centro.id), AccesoDenegado);
    });

    await t.test("observaciones locales: cada sede ve y edita solo las suyas", async () => {
      await actualizarObservaciones(db, a.recepcion.id, a.org.id, anaId, a.centro.id, "Piel sensible al gel");
      await actualizarObservaciones(db, recepSur.id, a.org.id, anaId, a.sur.id, "Prefiere turnos de mañana");
      const vistaSur = await obtenerCliente(db, recepSur.id, a.org.id, anaId);
      assert.deepEqual(vistaSur.sedes.map(s => s.observaciones), ["Prefiere turnos de mañana"]);
      assert.equal(JSON.stringify(vistaSur).includes("gel"), false);
      const vistaMaster = await obtenerCliente(db, a.master.id, a.org.id, anaId);
      assert.equal(vistaMaster.sedes.length, 2);
      await assert.rejects(actualizarObservaciones(db, recepSur.id, a.org.id, anaId, a.centro.id, "x"), AccesoDenegado);
      await assert.rejects(actualizarObservaciones(db, a.recepcion.id, a.org.id, anaId, a.norte.id, "x"), AccesoDenegado, "sin vínculo en Norte");
      const audit = await db.auditLog.findMany({ where: { organizacionId: a.org.id, entidadId: anaId } });
      assert.equal(JSON.stringify(audit).includes("gel") || JSON.stringify(audit).includes(email), false, "sin datos personales en auditoría");
    });

    await t.test("editar identidad desde cualquier sede vinculada; conflicto de email", async () => {
      await actualizarCliente(db, recepSur.id, a.org.id, anaId, { nombre: "Ana", apellido: "Pérez Gómez", email, telefono: "1133287024", tipoDocumento: "DNI", documento: "30.123.456" });
      assert.equal((await obtenerCliente(db, a.recepcion.id, a.org.id, anaId)).apellido, "Pérez Gómez");
      const otra = await crearCliente(db, a.recepcion.id, a.org.id, a.centro.id, { nombre: "Otra", telefono: "1144445555" });
      await assert.rejects(actualizarCliente(db, a.recepcion.id, a.org.id, otra.id, { nombre: "Otra", email }), DatosInvalidos);
      await assert.rejects(actualizarCliente(db, a.recepcion.id, a.org.id, otra.id, { nombre: "Otra", telefono: "1144445555", tipoDocumento: "DNI", documento: "30123456" }), DatosInvalidos, "documento repetido");
    });

    let v1 = "", v2 = "";
    await t.test("consentimientos: solo el master publica; versiones inmutables", async () => {
      await assert.rejects(publicarConsentimiento(db, a.franquiciado.id, a.org.id, { tipo: "PRACTICA", clave: "depilacion-laser", titulo: "Depilación láser", texto: TEXTO }), AccesoDenegado);
      v1 = (await publicarConsentimiento(db, a.master.id, a.org.id, { tipo: "PRACTICA", clave: "depilacion-laser", titulo: "Depilación láser", texto: TEXTO })).id;
      await assert.rejects(publicarConsentimiento(db, a.master.id, a.org.id, { tipo: "MARKETING", clave: "depilacion-laser", titulo: "X", texto: TEXTO }), DatosInvalidos);
      await assert.rejects(publicarConsentimiento(db, a.master.id, a.org.id, { tipo: "PRACTICA", clave: "Con Espacio", titulo: "X", texto: TEXTO }), DatosInvalidos);
      await assert.rejects(db.consentimientoVersion.update({ where: { id: v1 }, data: { texto: "otro" } }));
      assert.equal((await textoConsentimiento(db, a.recepcion.id, a.org.id, v1)).texto, TEXTO);
      await assert.rejects(textoConsentimiento(db, b.master.id, b.org.id, v1), AccesoDenegado);
    });

    await t.test("aceptar la versión vigente; nueva versión exige volver a aceptar; revocar", async () => {
      await registrarConsentimiento(db, a.recepcion.id, a.org.id, { clienteId: anaId, versionId: v1, sedeId: a.centro.id, accion: "ACEPTA" });
      let estado = (await obtenerCliente(db, a.recepcion.id, a.org.id, anaId)).consentimientos.find(c => c.clave === "depilacion-laser");
      assert.equal(estado?.estado, "VIGENTE");
      v2 = (await publicarConsentimiento(db, a.master.id, a.org.id, { tipo: "PRACTICA", clave: "depilacion-laser", titulo: "Depilación láser", texto: TEXTO + " Versión 2." })).id;
      estado = (await obtenerCliente(db, recepSur.id, a.org.id, anaId)).consentimientos.find(c => c.clave === "depilacion-laser");
      assert.equal(estado?.estado, "DESACTUALIZADO");
      assert.equal(estado?.version, 2);
      await assert.rejects(registrarConsentimiento(db, a.recepcion.id, a.org.id, { clienteId: anaId, versionId: v1, sedeId: a.centro.id, accion: "ACEPTA" }), DatosInvalidos, "versión vieja");
      await registrarConsentimiento(db, recepSur.id, a.org.id, { clienteId: anaId, versionId: v2, sedeId: a.sur.id, accion: "ACEPTA" });
      await registrarConsentimiento(db, recepSur.id, a.org.id, { clienteId: anaId, versionId: v2, sedeId: a.sur.id, accion: "REVOCA" });
      estado = (await obtenerCliente(db, a.recepcion.id, a.org.id, anaId)).consentimientos.find(c => c.clave === "depilacion-laser");
      assert.equal(estado?.estado, "REVOCADO", "el consentimiento es de la persona, se ve desde cualquier sede");
      await assert.rejects(registrarConsentimiento(db, a.recepcion.id, a.org.id, { clienteId: anaId, versionId: v2, sedeId: a.norte.id, accion: "ACEPTA" }), AccesoDenegado, "cliente no vinculado a Norte");
      const fila = await db.clienteConsentimiento.findFirstOrThrow({ where: { clienteId: anaId } });
      await assert.rejects(db.clienteConsentimiento.delete({ where: { id: fila.id } }), "registro inmutable");
    });
  } finally { await db.$disconnect(); }
});
