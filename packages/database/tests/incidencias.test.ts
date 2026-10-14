import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { contarIncidenciasAbiertas, detalleIncidencia, listarIncidencias, registrarAccionIncidencia } from "../src/incidencias.ts";
import { crearFixture } from "../prisma/fixture.ts";

test("bandeja de incidencias (M04)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const b = await crearFixture(db);
    const O = a.org.id;
    const viejo = new Date(Date.now() - 2 * 3_600_000);

    // ─── Fuentes sintéticas ─────────────────────────────────────────────────
    const reserva = (sedeId: string, estado: "CONFIRMADA" | "CANCELADA", org = O) => db.reserva.create({ data: { organizacionId: org, sedeId, canal: "ONLINE", estado }, select: { id: true } }).then(r => r.id);
    const rCentro = await reserva(a.centro.id, "CANCELADA");
    const rNorte = await reserva(a.norte.id, "CONFIRMADA");
    const rSur = await reserva(a.sur.id, "CONFIRMADA");
    let externo = 7_000_000;
    const pago = async (reservaId: string, sedeId: string, estado: "A_DEVOLVER" | "APROBADO" | "EN_PROCESO" | "REEMBOLSADO", extra: { motivo?: string; updatedAt?: Date } = {}) => {
      const checkout = await db.checkoutPago.create({ data: { organizacionId: O, sedeId, reservaId, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA", monto: "9000", expiraEn: new Date() } });
      return (await db.pago.create({ data: {
        organizacionId: O, sedeId, reservaId, checkoutId: checkout.id, proveedor: "MERCADO_PAGO", ambiente: "PRUEBA", externoId: String(++externo), monto: "9000", moneda: "ARS",
        estado, estadoExterno: estado === "EN_PROCESO" ? "in_process" : "approved", aprobadoEn: estado === "EN_PROCESO" ? null : new Date(), motivo: extra.motivo ?? null, ...(extra.updatedAt ? { updatedAt: extra.updatedAt } : {}),
      } })).id;
    };
    const pDevolver = await pago(rCentro, a.centro.id, "A_DEVOLVER", { motivo: "la reserva estaba cancelada" });
    const pSinImputar = await pago(rCentro, a.centro.id, "APROBADO");
    const pAmbiguo = await pago(rNorte, a.norte.id, "EN_PROCESO", { updatedAt: viejo });
    const pReciente = await pago(rNorte, a.norte.id, "EN_PROCESO");
    const pReembolsoEsperado = await pago(rNorte, a.norte.id, "REEMBOLSADO", { motivo: "pago duplicado" });
    const pSur = await pago(rSur, a.sur.id, "A_DEVOLVER", { motivo: "monto distinto" });

    const job = (datos: { tipo: string; payload: object; organizacionId: string | null; estado?: "FALLIDO" | "PENDIENTE"; proximoIntento?: Date }) => db.job.create({ data: {
      tipo: datos.tipo, clave: `${datos.tipo}:${randomUUID()}`, payload: datos.payload, organizacionId: datos.organizacionId, estado: datos.estado ?? "FALLIDO",
      intentos: datos.estado === "PENDIENTE" ? 1 : 8, ultimoError: datos.estado === "PENDIENTE" ? null : "ErrorPermanente: Resend 422 validation_error", proximoIntento: datos.proximoIntento ?? new Date(),
    }, select: { id: true, clave: true } });
    const jEmailCentro = await job({ tipo: "email.reserva_confirmada", payload: { reservaId: rCentro }, organizacionId: O });
    const jPagoSur = await job({ tipo: "pagos.mercadopago", payload: { sedeId: a.sur.id, ambiente: "PRUEBA", pagoId: "123" }, organizacionId: O });
    const jSistema = await job({ tipo: "mantenimiento.limpieza", payload: {}, organizacionId: null });
    const jOrgSinSede = await job({ tipo: "otro.desconocido", payload: {}, organizacionId: O });
    const jAtrasado = await job({ tipo: "email.reserva_cancelada", payload: { reservaId: rNorte }, organizacionId: O, estado: "PENDIENTE", proximoIntento: new Date(Date.now() - 10 * 60_000) });
    const jAjeno = await job({ tipo: "pagos.mercadopago", payload: { sedeId: b.centro.id, ambiente: "PRUEBA", pagoId: "9" }, organizacionId: b.org.id });
    // Un payload que apunta a una sede de otra organización no la vuelve visible para esa sede.
    const jPayloadAjeno = await job({ tipo: "pagos.mercadopago", payload: { sedeId: b.centro.id }, organizacionId: O });

    const envio = (datos: { estado: "FALLIDO" | "REBOTADO" | "QUEJA"; reservaId?: string; clave?: string; tipo?: string }) => db.envioEmail.create({ data: {
      organizacionId: O, clave: datos.clave ?? `email.prueba:${randomUUID()}`, tipo: datos.tipo ?? "email.reserva_confirmada", reservaId: datos.reservaId ?? null,
      destinatario: "cliente@example.invalid", asunto: "Tu turno", estado: datos.estado, intentos: 1,
      ...(datos.estado !== "FALLIDO" ? { proveedor: "resend", proveedorId: randomUUID(), enviadoEn: new Date(), motivo: "Mailbox does not exist" } : { ultimoError: "Resend 422" }),
    }, select: { id: true } }).then(e => e.id);
    const eRebote = await envio({ estado: "REBOTADO", reservaId: rCentro });
    const eDuplicado = await envio({ estado: "FALLIDO", reservaId: rCentro, clave: jEmailCentro.clave });
    const eQuejaSur = await envio({ estado: "QUEJA", reservaId: rSur });
    const eRecuperacion = await envio({ estado: "FALLIDO", tipo: "email.recuperacion" });

    const ids = async (actorId: string, filtros: Parameters<typeof listarIncidencias>[3] = {}, org = O) => new Set((await listarIncidencias(db, actorId, org, filtros)).incidencias.map(i => i.id));
    const nota = "Revisado con la sede";

    await t.test("alcance de la bandeja: master todo, franquiciado y admin solo sus sedes", async () => {
      const master = await ids(a.master.id);
      for (const id of [pDevolver, pSinImputar, pAmbiguo, pSur, jEmailCentro.id, jPagoSur.id, jSistema.id, jOrgSinSede.id, jAtrasado.id, jPayloadAjeno.id, eRebote, eQuejaSur, eRecuperacion]) assert.ok(master.has(id), id);
      for (const id of [pReciente, pReembolsoEsperado, jAjeno.id, eDuplicado]) assert.ok(!master.has(id), id);

      const fran = await ids(a.franquiciado.id);
      assert.deepEqual([...fran].sort(), [pDevolver, pSinImputar, pAmbiguo, jEmailCentro.id, jAtrasado.id, eRebote].sort());
      const admin = await ids(a.admin.id);
      assert.deepEqual([...admin].sort(), [pDevolver, pSinImputar, jEmailCentro.id, eRebote].sort());
      // El otro master no ve nada de esta organización.
      for (const id of await ids(b.master.id, {}, b.org.id)) assert.ok(![pDevolver, jEmailCentro.id, eRebote].includes(id));
      assert.ok((await ids(b.master.id, {}, b.org.id)).has(jAjeno.id));

      for (const u of [a.recepcion, a.profesional, a.sinRol]) {
        await assert.rejects(listarIncidencias(db, u.id, O), AccesoDenegado, u.nombre);
        assert.equal(await contarIncidenciasAbiertas(db, u.id, O), null);
      }
      await assert.rejects(listarIncidencias(db, b.master.id, O), AccesoDenegado, "master de otra organización");
    });

    await t.test("clasificación y datos de cada fuente", async () => {
      const lista = (await listarIncidencias(db, a.franquiciado.id, O)).incidencias;
      const de = (id: string) => lista.find(i => i.id === id)!;
      assert.deepEqual([de(pDevolver).tipo, de(pSinImputar).tipo, de(pAmbiguo).tipo, de(jEmailCentro.id).tipo, de(jAtrasado.id).tipo, de(eRebote).tipo],
        ["PAGO_A_DEVOLVER", "PAGO_SIN_IMPUTAR", "PAGO_AMBIGUO", "TRABAJO_FALLIDO", "TRABAJO_ATRASADO", "EMAIL_REBOTADO"]);
      assert.deepEqual([de(jEmailCentro.id).sede, de(jAtrasado.id).sede, de(pAmbiguo).sede], ["Centro", "Norte", "Norte"]);
      assert.deepEqual(de(jEmailCentro.id).acciones, ["REVISADA", "RESUELTA", "REINTENTADA"]);
      assert.deepEqual(de(pDevolver).acciones, ["REVISADA", "RESUELTA", "DEVOLUCION_GESTIONADA"]);
      assert.equal(de(pDevolver).pago!.monto, "9000.00");
      assert.ok(lista.every(i => i.estado === "ABIERTA"));
      assert.equal(await contarIncidenciasAbiertas(db, a.franquiciado.id, O), 6);
      assert.equal(await contarIncidenciasAbiertas(db, a.admin.id, O), 4);
    });

    await t.test("filtros por tipo y sede; una sede ajena se rechaza, no se amplía", async () => {
      assert.deepEqual([...await ids(a.franquiciado.id, { fuente: "PAGO" })].sort(), [pDevolver, pSinImputar, pAmbiguo].sort());
      assert.deepEqual([...await ids(a.franquiciado.id, { sedeId: a.norte.id })].sort(), [pAmbiguo, jAtrasado.id].sort());
      assert.deepEqual([...await ids(a.master.id, { fuente: "EMAIL", sedeId: a.sur.id })], [eQuejaSur]);
      const sinSede = await ids(a.master.id, { sedeId: "sin-sede" });
      for (const id of [jSistema.id, jOrgSinSede.id, eRecuperacion, jPayloadAjeno.id]) assert.ok(sinSede.has(id));
      assert.ok(!sinSede.has(pDevolver));
      await assert.rejects(listarIncidencias(db, a.admin.id, O, { sedeId: a.norte.id }), AccesoDenegado);
      await assert.rejects(listarIncidencias(db, a.franquiciado.id, O, { sedeId: a.sur.id }), AccesoDenegado);
      await assert.rejects(listarIncidencias(db, a.franquiciado.id, O, { sedeId: "sin-sede" }), AccesoDenegado);
      await assert.rejects(listarIncidencias(db, a.master.id, O, { sedeId: b.centro.id }), AccesoDenegado, "sede de otra organización");
      await assert.rejects(listarIncidencias(db, a.master.id, O, { sedeId: "no-es-un-id" }), AccesoDenegado);
      await assert.rejects(listarIncidencias(db, a.master.id, O, { fuente: "COMPROBANTE" as never }), DatosInvalidos);
    });

    await t.test("acceso cruzado por ID en lectura y escritura", async () => {
      const casos: [actor: string, fuente: string, id: string, org?: string][] = [
        [a.admin.id, "TRABAJO", jPagoSur.id], [a.admin.id, "PAGO", pAmbiguo], [a.franquiciado.id, "PAGO", pSur], [a.franquiciado.id, "EMAIL", eQuejaSur],
        [a.franquiciado.id, "TRABAJO", jSistema.id], [a.franquiciado.id, "TRABAJO", jOrgSinSede.id], [a.franquiciado.id, "EMAIL", eRecuperacion],
        [a.recepcion.id, "PAGO", pDevolver], [a.profesional.id, "TRABAJO", jEmailCentro.id],
        [b.master.id, "PAGO", pDevolver, b.org.id], [b.master.id, "TRABAJO", jEmailCentro.id, b.org.id], [a.master.id, "TRABAJO", jAjeno.id],
        // El id existe, pero la fuente indicada es otra.
        [a.master.id, "PAGO", jEmailCentro.id], [a.master.id, "COMPROBANTE", pDevolver], [a.master.id, "PAGO", "no-es-un-id"],
      ];
      for (const [actor, fuente, id, org = O] of casos) {
        await assert.rejects(detalleIncidencia(db, actor, org, fuente, id), AccesoDenegado, `leer ${fuente} ${id}`);
        await assert.rejects(registrarAccionIncidencia(db, actor, org, { fuente, id, accion: "REVISADA", nota }), AccesoDenegado, `escribir ${fuente} ${id}`);
      }
      assert.equal(await db.accionIncidencia.count({ where: { organizacionId: { in: [O, b.org.id] } } }), 0, "nada quedó registrado");
      // El master sí ve los trabajos del sistema y los de la organización sin sede.
      assert.equal((await detalleIncidencia(db, a.master.id, O, "TRABAJO", jSistema.id)).incidencia.tipo, "TRABAJO_FALLIDO");
    });

    await t.test("revisar, gestionar la devolución y resolver: con nota, sin tocar el pago", async () => {
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "REVISADA", nota: "  " }), DatosInvalidos);
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "BORRAR", nota }), DatosInvalidos);
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "REINTENTADA", nota }), DatosInvalidos, "un pago no se reintenta");
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "EMAIL", id: eRebote, accion: "DEVOLUCION_GESTIONADA", nota }), DatosInvalidos);

      await registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "REVISADA", nota: "Llamé a la clienta;   pide devolución" });
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "REVISADA", nota }), DatosInvalidos, "ya revisada");
      await registrarAccionIncidencia(db, a.franquiciado.id, O, { fuente: "PAGO", id: pDevolver, accion: "DEVOLUCION_GESTIONADA", nota: "Devolución pedida desde el panel de Mercado Pago" });
      let d = await detalleIncidencia(db, a.admin.id, O, "PAGO", pDevolver);
      assert.equal(d.incidencia.estado, "EN_SEGUIMIENTO", "gestionar la devolución no la da por completa");
      assert.equal((await db.pago.findUniqueOrThrow({ where: { id: pDevolver } })).estado, "A_DEVOLVER", "el pago no cambia");
      assert.equal(await contarIncidenciasAbiertas(db, a.admin.id, O), 3);

      await registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "RESUELTA", nota: "Mercado Pago confirmó la devolución" });
      assert.ok(!(await ids(a.admin.id)).has(pDevolver), "sale de pendientes");
      assert.ok((await ids(a.admin.id, { estado: "resueltas" })).has(pDevolver));
      d = await detalleIncidencia(db, a.admin.id, O, "PAGO", pDevolver);
      assert.deepEqual(d.historial.map(h => [h.accion, h.actor, h.estadoFuente]), [["REVISADA", "admin", "A_DEVOLVER"], ["DEVOLUCION_GESTIONADA", "franquiciado", "A_DEVOLVER"], ["RESUELTA", "admin", "A_DEVOLVER"]]);
      assert.equal(d.historial[0]!.nota, "Llamé a la clienta; pide devolución", "nota normalizada");
      assert.deepEqual(d.incidencia.acciones, ["REABIERTA"]);
      await registrarAccionIncidencia(db, a.master.id, O, { fuente: "PAGO", id: pDevolver, accion: "REABIERTA", nota: "La clienta dice que no le llegó" });
      assert.equal((await detalleIncidencia(db, a.admin.id, O, "PAGO", pDevolver)).incidencia.estado, "ABIERTA");

      // Si Mercado Pago informa el reembolso, la incidencia desaparece sola; el historial queda.
      await db.pago.update({ where: { id: pDevolver }, data: { estado: "REEMBOLSADO" } });
      assert.ok(!(await ids(a.admin.id, { estado: "todas" })).has(pDevolver));
      d = await detalleIncidencia(db, a.admin.id, O, "PAGO", pDevolver);
      assert.deepEqual([d.incidencia.tipo, d.incidencia.acciones, d.historial.length], [null, [], 4]);
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "PAGO", id: pDevolver, accion: "RESUELTA", nota }), (e: unknown) => e instanceof DatosInvalidos && /ya se normalizó/.test(e.message));

      const audit = await db.auditLog.findMany({ where: { organizacionId: O, entidad: "Pago", entidadId: pDevolver }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(audit.map(x => x.accion), ["incidencia.revisada", "incidencia.devolucion_gestionada", "incidencia.resuelta", "incidencia.reabierta"]);
    });

    await t.test("reintentar un trabajo fallido: mismo trabajo, una sola vez, y reaparece si vuelve a fallar", async () => {
      await assert.rejects(registrarAccionIncidencia(db, a.master.id, O, { fuente: "TRABAJO", id: jOrgSinSede.id, accion: "REINTENTADA", nota }), DatosInvalidos, "tipo sin reintento habilitado");
      await assert.rejects(registrarAccionIncidencia(db, a.admin.id, O, { fuente: "TRABAJO", id: jAtrasado.id, accion: "REINTENTADA", nota }), AccesoDenegado, "Norte no es del admin");
      await assert.rejects(registrarAccionIncidencia(db, a.franquiciado.id, O, { fuente: "TRABAJO", id: jAtrasado.id, accion: "REINTENTADA", nota }), DatosInvalidos, "un atrasado no se rearma: la cola lo retoma sola");

      const ficha = await detalleIncidencia(db, a.admin.id, O, "TRABAJO", jEmailCentro.id);
      assert.deepEqual([ficha.envio?.id, ficha.envio?.estado], [eDuplicado, "FALLIDO"], "la evidencia del email en la ficha del trabajo");

      // Dos personas reintentan a la vez: el lock de la fila deja pasar una sola.
      const r = await Promise.allSettled([a.admin.id, a.franquiciado.id].map(actor => registrarAccionIncidencia(db, actor, O, { fuente: "TRABAJO", id: jEmailCentro.id, accion: "REINTENTADA", nota: "Dominio verificado en Resend" })));
      assert.deepEqual(r.map(x => x.status).sort(), ["fulfilled", "rejected"]);
      assert.ok(r.some(x => x.status === "rejected" && x.reason instanceof DatosInvalidos));
      const rearmado = await db.job.findUniqueOrThrow({ where: { id: jEmailCentro.id } });
      assert.deepEqual([rearmado.estado, rearmado.intentos, rearmado.clave], ["PENDIENTE", 0, jEmailCentro.clave]);
      assert.equal(await db.job.count({ where: { clave: jEmailCentro.clave } }), 1, "no se crea otro trabajo");
      const despues = await ids(a.admin.id, { estado: "todas" });
      assert.ok(!despues.has(jEmailCentro.id), "rearmado ya no es incidencia");
      assert.ok(!despues.has(eDuplicado), "su envío fallido tampoco: se está reintentando");

      // Vuelve a fallar: ocurrencia nueva, ABIERTA, con el reintento anterior en el historial.
      await db.job.update({ where: { id: jEmailCentro.id }, data: { estado: "FALLIDO", intentos: 8, ultimoError: "ErrorPermanente: otra vez" } });
      const otra = await detalleIncidencia(db, a.admin.id, O, "TRABAJO", jEmailCentro.id);
      assert.deepEqual([otra.incidencia.estado, otra.historial.map(h => [h.accion, h.anterior])], ["ABIERTA", [["REINTENTADA", true]]]);

      // Trabajo del sistema: solo el master, y queda auditado en su organización.
      await registrarAccionIncidencia(db, a.master.id, O, { fuente: "TRABAJO", id: jSistema.id, accion: "REINTENTADA", nota: "Reintento tras el corte de la base" });
      assert.equal((await db.job.findUniqueOrThrow({ where: { id: jSistema.id } })).estado, "PENDIENTE");
      assert.equal(await db.auditLog.count({ where: { organizacionId: O, entidad: "Job", entidadId: jSistema.id, accion: "incidencia.reintentada" } }), 1);
    });

    await t.test("las acciones son inmutables y la nota se exige también en la base", async () => {
      const accion = await db.accionIncidencia.findFirstOrThrow({ where: { organizacionId: O } });
      await assert.rejects(db.accionIncidencia.update({ where: { id: accion.id }, data: { nota: "editada por alguien" } }), /solo inserción/);
      await assert.rejects(db.accionIncidencia.delete({ where: { id: accion.id } }), /solo inserción/);
      const base = { organizacionId: O, fuente: "PAGO" as const, entidadId: pSinImputar, incidencia: "PAGO_SIN_IMPUTAR", accion: "REVISADA" as const, estadoFuente: "APROBADO", marcaFuente: new Date(), actorId: a.master.id };
      await assert.rejects(db.accionIncidencia.create({ data: { ...base, nota: "  ok  " } }), "nota corta");
      await assert.rejects(db.accionIncidencia.create({ data: { ...base, fuente: "EMAIL", accion: "DEVOLUCION_GESTIONADA", nota } }), "devolución solo en pagos");
      await assert.rejects(db.accionIncidencia.create({ data: { ...base, accion: "REINTENTADA", nota } }), "reintento solo en trabajos");
    });
  } finally {
    await db.$disconnect();
  }
});
