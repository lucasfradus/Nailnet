import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { aUtc } from "@nailnet/domain/agenda";
import { llaveroDesde } from "@nailnet/domain/secretos";
import { createDatabase } from "../src/client.ts";
import { solicitarRecuperacion } from "../src/auth.ts";
import { crearCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { TIPO_EMAIL, procesarEmail, registrarEntregaEmail, type TransporteEmail } from "../src/emails.ts";
import { ErrorPermanente } from "../src/jobs.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { cancelarReserva, registrarEvento, reprogramarReserva, tomarTurno } from "../src/reservas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");
const llavero = llaveroDesde(`v1:${randomBytes(32).toString("base64")}`, "v1");

type Enviado = Parameters<TransporteEmail["enviar"]>[0];
/** Transporte de prueba con nombre «resend»: registra lo enviado y puede fallar a pedido. */
function transportePrueba() {
  const enviados: Enviado[] = [];
  let falla: Error | null = null;
  const t: TransporteEmail & { enviados: Enviado[]; fallar(e: Error | null): void } = {
    nombre: "resend", enviados,
    fallar(e) { falla = e; },
    async enviar(m) {
      if (falla) throw falla;
      enviados.push(m);
      return { id: `re_${crypto.randomUUID()}` };
    },
  };
  return t;
}

test("emails transaccionales (P03)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id, R = a.recepcion.id;
    await db.organizacion.update({ where: { id: O }, data: { nombre: "Sicurella" } });
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const semi = (await guardarServicio(db, M, O, { categoriaId: cat.id, nombre: "Semipermanente", duracionMinutos: 60, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, sena: null, activo: true, consentimientos: [], skillIds: [], recursos: [] }))!.id;
    await guardarServicioSede(db, M, O, a.centro.id, semi, { habilitado: true, precio: "20000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "09:00-20:00" }));
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana", apellido: "Pérez" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [], servicioIds: [semi] });
    await guardarHorarioProfesional(db, M, O, ana, a.centro.id, semanaDesdeTextos({ 2: "09:00-18:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 60 });
    const email = `lucia-${O}@example.invalid`;
    const conEmail = (await crearCliente(db, M, O, a.centro.id, { nombre: "Lucía <b>", email, telefono: "1155551234" }))!.id;
    const sinEmail = (await crearCliente(db, M, O, a.centro.id, { nombre: "Sol", telefono: "1166667777" }))!.id;
    const tomar = (hhmm: string, clienteId = conEmail) => tomarTurno(db, R, O, { sedeId: a.centro.id, fecha: FECHA, canal: "RECEPCION", clienteId, items: [{ servicioId: semi, profesionalId: ana }], inicio: en(hhmm) }, ahora);
    const job = (clave: string) => db.job.findUnique({ where: { clave } });
    /** Ejecuta el trabajo como lo haría el worker (intento n). */
    const procesar = async (clave: string, transporte: TransporteEmail, intentos = 1, cuando = ahora) => {
      const j = (await job(clave))!;
      return procesarEmail(db, transporte, { ...j, intentos }, { ahora: cuando, llavero: () => llavero });
    };
    const envio = (clave: string) => db.envioEmail.findUniqueOrThrow({ where: { clave } });

    await t.test("confirmación encolada en la transacción, con referencias y sin datos personales", async () => {
      const r = await tomar("09:00");
      const j = await job(`${TIPO_EMAIL.confirmada}:${r.reservaId}`);
      assert.ok(j, "trabajo encolado");
      assert.deepEqual(j.payload, { reservaId: r.reservaId });
      assert.equal(j.organizacionId, O);
      // Cliente sin email: no hay nada que enviar.
      const s = await tomar("10:00", sinEmail);
      assert.equal(await db.job.count({ where: { clave: { endsWith: s.reservaId } } }), 0);
    });

    await t.test("outbox: si la transacción se revierte, no queda el trabajo", async () => {
      const r = await tomar("11:00");
      await db.job.delete({ where: { clave: `${TIPO_EMAIL.confirmada}:${r.reservaId}` } });
      await assert.rejects(db.$transaction(async tx => {
        await registrarEvento(tx, O, r.reservaId, "CANCELADA", "CONFIRMADA", "CANCELADA", R);
        throw new Error("rollback");
      }), /rollback/);
      assert.equal(await job(`${TIPO_EMAIL.cancelada}:${r.reservaId}`), null);
      // Dos eventos de confirmación (creada confirmada y confirmación posterior) son un solo email.
      await db.$transaction(tx => registrarEvento(tx, O, r.reservaId, "CONFIRMADA", "PENDIENTE_PAGO", "CONFIRMADA", null));
      await db.$transaction(tx => registrarEvento(tx, O, r.reservaId, "CONFIRMADA", "PENDIENTE_PAGO", "CONFIRMADA", null));
      assert.equal(await db.job.count({ where: { clave: `${TIPO_EMAIL.confirmada}:${r.reservaId}` } }), 1);
    });

    await t.test("envío con idempotencia, marca, escape y evidencia", async () => {
      const r = await tomar("12:00");
      const clave = `${TIPO_EMAIL.confirmada}:${r.reservaId}`;
      const tr = transportePrueba();
      const res = await procesar(clave, tr);
      assert.equal(res.estado, "ENVIADO");
      assert.equal(tr.enviados.length, 1);
      const m = tr.enviados[0]!;
      assert.equal(m.para, email);
      assert.equal(m.claveIdempotencia, clave, "Idempotency-Key = clave del trabajo");
      assert.deepEqual(m.etiquetas, { tipo: "reserva_confirmada" });
      assert.equal(m.asunto, "Tu turno en Sicurella Centro está confirmado: martes, 13 de octubre, 12:00 h");
      assert.ok(m.html.includes("Hola, Lucía &lt;b&gt;.") && !m.html.includes("Lucía <b>"));
      assert.ok(m.texto.includes("Servicio: Semipermanente") && m.texto.includes("Con: Ana"));
      const e = await envio(clave);
      assert.deepEqual([e.estado, e.proveedor, e.proveedorId, e.destinatario, e.intentos, e.reservaId, e.organizacionId], ["ENVIADO", "resend", res.proveedorId, email, 1, r.reservaId, O]);
      assert.ok(e.enviadoEn);
      // El trabajo se repite (lease vencido tras enviar): no sale otro email.
      const otra = await procesar(clave, tr, 2);
      assert.deepEqual([otra.repetido, otra.envioId, tr.enviados.length], [true, e.id, 1]);
    });

    await t.test("errores: transitorio se reintenta, permanente queda fallido", async () => {
      const r = await tomar("13:00");
      const clave = `${TIPO_EMAIL.confirmada}:${r.reservaId}`;
      const tr = transportePrueba();
      tr.fallar(new Error("Resend respondió 503"));
      await assert.rejects(procesar(clave, tr, 1), /503/);
      let e = await envio(clave);
      assert.deepEqual([e.estado, e.intentos, e.proveedorId], ["PENDIENTE", 1, null]);
      assert.match(e.ultimoError!, /503/);
      tr.fallar(null);
      await procesar(clave, tr, 2);
      e = await envio(clave);
      assert.deepEqual([e.estado, e.intentos, e.ultimoError], ["ENVIADO", 2, null]);

      // Permanente (4xx de validación): FALLIDO y se relanza como ErrorPermanente para que la cola no reintente.
      const p = await tomar("14:00");
      const claveP = `${TIPO_EMAIL.confirmada}:${p.reservaId}`;
      tr.fallar(new ErrorPermanente("Resend respondió 422 validation_error"));
      await assert.rejects(procesar(claveP, tr), ErrorPermanente);
      assert.equal((await envio(claveP)).estado, "FALLIDO");
      // Transitorio en el último intento: también queda FALLIDO.
      const u = await tomar("15:00");
      const claveU = `${TIPO_EMAIL.confirmada}:${u.reservaId}`;
      tr.fallar(new Error("red"));
      await assert.rejects(procesar(claveU, tr, 8));
      assert.equal((await envio(claveU)).estado, "FALLIDO");
    });

    await t.test("cancelación: avisa y la confirmación pendiente se omite", async () => {
      const r = await tomar("16:00");
      await cancelarReserva(db, R, O, r.reservaId, "La clienta avisó por teléfono");
      const tr = transportePrueba();
      const conf = await procesar(`${TIPO_EMAIL.confirmada}:${r.reservaId}`, tr);
      assert.equal(conf.estado, "OMITIDO");
      assert.match((await envio(`${TIPO_EMAIL.confirmada}:${r.reservaId}`)).motivo!, /ya no está confirmada/);
      const canc = await procesar(`${TIPO_EMAIL.cancelada}:${r.reservaId}`, tr);
      assert.equal(canc.estado, "ENVIADO");
      assert.equal(tr.enviados.length, 1);
      assert.match(tr.enviados[0]!.asunto, /fue cancelado$/);
      // El motivo interno no viaja al cliente.
      assert.ok(!tr.enviados[0]!.texto.includes("teléfono"));
    });

    await t.test("reprogramación: un email con el horario nuevo, sin otra confirmación", async () => {
      const r = await tomar("17:00");
      const nueva = await reprogramarReserva(db, R, O, r.reservaId, { fecha: FECHA, inicio: en("16:00") }, ahora);
      assert.equal(await job(`${TIPO_EMAIL.confirmada}:${nueva.reservaId}`), null);
      const clave = `${TIPO_EMAIL.reprogramada}:${r.reservaId}`;
      assert.deepEqual((await job(clave))!.payload, { reservaId: nueva.reservaId, anteriorId: r.reservaId });
      const tr = transportePrueba();
      await procesar(clave, tr);
      const m = tr.enviados[0]!;
      assert.equal(m.asunto, "Cambiamos tu turno en Sicurella Centro: ahora es el martes, 13 de octubre, 16:00 h");
      assert.ok(m.texto.includes("Tu turno del martes, 13 de octubre a las 17:00 h quedó reprogramado"));
      // La confirmación original, si todavía no salió, se omite: la reserva quedó cancelada por la reprogramación.
      assert.equal((await procesar(`${TIPO_EMAIL.confirmada}:${r.reservaId}`, tr)).estado, "OMITIDO");
      assert.equal(tr.enviados.length, 1);
    });

    await t.test("turno que ya empezó: se omite", async () => {
      const r = await tomar("17:00");
      const res = await procesar(`${TIPO_EMAIL.confirmada}:${r.reservaId}`, transportePrueba(), 1, new Date("2099-10-14T00:00:00Z"));
      assert.equal(res.estado, "OMITIDO");
    });

    await t.test("recuperación de contraseña: enlace cifrado en la cola, enviado al usuario", async () => {
      const base = "https://backoffice.example";
      const s = await solicitarRecuperacion(db, { email: a.admin.email, envio: { enlace: tok => `${base}/restablecer#${tok}`, llavero } });
      assert.ok(s);
      const token = await db.tokenRecuperacion.findFirstOrThrow({ where: { usuarioId: a.admin.id, usadoEn: null } });
      const clave = `${TIPO_EMAIL.recuperacion}:${token.id}`;
      const j = (await job(clave))!;
      assert.equal(j.maxIntentos, 5);
      assert.ok(!JSON.stringify(j.payload).includes(s.token), "el token no queda en claro en la cola");
      const tr = transportePrueba();
      const ahoraReal = new Date();
      await procesarEmail(db, tr, j, { ahora: ahoraReal, llavero: () => llavero });
      const m = tr.enviados[0]!;
      assert.equal(m.para, a.admin.email);
      assert.ok(m.html.includes(`href="${base}/restablecer#${s.token}"`));
      assert.match(m.texto, /vence en (29|30) minutos/);
      const e = await envio(clave);
      assert.deepEqual([e.estado, e.usuarioId, e.organizacionId, e.reservaId], ["ENVIADO", a.admin.id, O, null]);

      // Un pedido nuevo reemplaza al anterior: si el primer email todavía no salió, se omite.
      const s1 = await solicitarRecuperacion(db, { email: a.recepcion.email, envio: { enlace: tok => `${base}/restablecer#${tok}`, llavero } });
      const t1 = await db.tokenRecuperacion.findFirstOrThrow({ where: { usuarioId: a.recepcion.id, usadoEn: null } });
      await solicitarRecuperacion(db, { email: a.recepcion.email, envio: { enlace: tok => `${base}/restablecer#${tok}`, llavero } });
      assert.ok(s1);
      const res = await procesar(`${TIPO_EMAIL.recuperacion}:${t1.id}`, tr, 1, ahoraReal);
      assert.equal(res.estado, "OMITIDO");
      // Sin `envio` (desarrollo sin llavero) no se encola nada.
      await solicitarRecuperacion(db, { email: a.franquiciado.email });
      const t2 = await db.tokenRecuperacion.findFirstOrThrow({ where: { usuarioId: a.franquiciado.id, usadoEn: null } });
      assert.equal(await job(`${TIPO_EMAIL.recuperacion}:${t2.id}`), null);
    });

    await t.test("eventos de entrega: solo avanzan", async () => {
      const fila = await db.envioEmail.findFirstOrThrow({ where: { organizacionId: O, estado: "ENVIADO", tipo: TIPO_EMAIL.cancelada } });
      const id = fila.proveedorId!;
      const fecha = new Date();
      assert.equal(await registrarEntregaEmail(db, { proveedorId: id, estado: "ENTREGADO", fecha }), "ACTUALIZADO");
      assert.equal(await registrarEntregaEmail(db, { proveedorId: id, estado: "DEMORADO", fecha }), "SIN_CAMBIO", "un demorado tardío no pisa la entrega");
      assert.equal(await registrarEntregaEmail(db, { proveedorId: id, estado: "ENTREGADO", fecha }), "SIN_CAMBIO", "repetido");
      assert.equal(await registrarEntregaEmail(db, { proveedorId: id, estado: "QUEJA", fecha, motivo: "Marcado como spam\r\n" }), "ACTUALIZADO");
      const e = await db.envioEmail.findUniqueOrThrow({ where: { id: fila.id } });
      assert.deepEqual([e.estado, e.motivo], ["QUEJA", "Marcado como spam "]);
      assert.equal(await registrarEntregaEmail(db, { proveedorId: "re_desconocido", estado: "ENTREGADO", fecha }), "DESCONOCIDO");
      // La base rechaza un envío aceptado sin id del proveedor.
      await assert.rejects(db.envioEmail.create({ data: { clave: `email.prueba:${O}`, tipo: "email.prueba", estado: "ENVIADO" } }));
    });
  } finally {
    await db.$disconnect();
  }
});
