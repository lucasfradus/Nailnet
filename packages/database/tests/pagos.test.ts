import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { llaveroDesde } from "@nailnet/domain/secretos";
import type { ReservaPublicaRespuesta } from "@nailnet/contracts/publico";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, crearSkill, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { publicarConsentimiento } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion, vincularMercadoPago } from "../src/configuracion.ts";
import { ErrorPermanente } from "../src/jobs.ts";
import { aplicarPago, encolarConsultaPago, iniciarPagoPublico, procesarPagoMercadoPago, verificarPagoPublico, type PagoExterno, type PasarelaMercadoPago } from "../src/pagos.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { LimiteExcedido, consultarReservaPublica, crearReservaPublica } from "../src/publico.ts";
import { cancelarReserva } from "../src/reservas.ts";
import { crearFixture } from "../prisma/fixture.ts";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");
const mas = (min: number) => new Date(ahora.getTime() + min * 60_000);
const llavero = llaveroDesde(`v1:${randomBytes(32).toString("base64")}`, "v1");
const CUENTA = "123456789";
const ACCESS = `TEST-${"a".repeat(30)}`;
let siguienteId = 9_000_000;

test("seña con Mercado Pago (R04)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id;
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const skill = (await crearSkill(db, M, O, "Semi"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, activo: true, consentimientos: [], recursos: [] };
    const semi = (await guardarServicio(db, M, O, { ...base, nombre: "Semi", duracionMinutos: 50, sena: { tipo: "PORCENTAJE", valor: "30" }, skillIds: [skill.id] }))!.id;
    await guardarServicioSede(db, M, O, a.centro.id, semi, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "09:00-20:00" }));
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana", apellido: "Pérez" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [skill.id], servicioIds: [semi] });
    await guardarHorarioProfesional(db, M, O, ana, a.centro.id, semanaDesdeTextos({ 2: "09:00-18:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 60, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    await publicarConsentimiento(db, M, O, { tipo: "TERMINOS", clave: "terminos", titulo: "Términos", texto: "Acepto los términos y condiciones del servicio de turnos." });

    let n = 0;
    const reservar = async (hhmm: string, cuando = ahora) => {
      const r = await crearReservaPublica(db, { solicitud: { sedeId: a.centro.id, fecha: FECHA, inicio: en(hhmm).toISOString(), items: [{ servicioId: semi }], cliente: { nombre: "Lucía", email: `cliente-${++n}-${O}@example.invalid`, telefono: "1155551234" }, aceptaTerminos: true }, claveIdempotencia: `k${crypto.randomUUID().replace(/-/g, "")}`, ip: null }, cuando);
      assert.equal(r.codigo, 201, JSON.stringify(r.cuerpo));
      return r.cuerpo as ReservaPublicaRespuesta;
    };

    // Pasarela falsa: registra preferencias y devuelve los pagos que el test define.
    const preferencias: Parameters<PasarelaMercadoPago["crearPreferencia"]>[1][] = [];
    const pagos = new Map<string, PagoExterno>();
    const pasarela: PasarelaMercadoPago = {
      crearPreferencia: async (token, p) => { assert.equal(token, ACCESS); preferencias.push(p); return { id: `pref-${preferencias.length}`, url: `https://sandbox.mercadopago.com.ar/checkout?pref=${preferencias.length}` }; },
      obtenerPago: async (token, id) => { assert.equal(token, ACCESS); const p = pagos.get(id); if (!p) throw new Error("pago inexistente"); return p; },
    };
    const urls = { urlApi: "https://api.example", urlPortal: "https://portal.example" };
    const checkoutDe = async (reservaId: string) => (await db.checkoutPago.findFirstOrThrow({ where: { reservaId }, orderBy: { createdAt: "desc" } })).id;
    /** Simula un pago en Mercado Pago y lo procesa como lo haría el worker. */
    const pagar = async (reservaId: string, extra: Partial<PagoExterno> = {}, cuando = mas(1)) => {
      const id = String(++siguienteId);
      pagos.set(id, { id, status: "approved", statusDetail: "accredited", monto: "9000.00", moneda: "ARS", referenciaExterna: await checkoutDe(reservaId), cobradorId: CUENTA, aprobadoEn: cuando, ...extra });
      return { id, r: await procesarPagoMercadoPago(db, pasarela, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: id }, cuando, llavero) };
    };
    const estado = async (reservaId: string) => (await db.reserva.findUniqueOrThrow({ where: { id: reservaId } })).estado;

    await t.test("sin credenciales de la sede no hay link de pago", async () => {
      const r = await reservar("09:00");
      await assert.rejects(iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(1), llavero), (e: unknown) => e instanceof DatosInvalidos && /no está habilitado/.test(e.message));
    });

    await vincularMercadoPago(db, M, O, a.centro.id, "PRUEBA", { cuentaId: CUENTA, publicKey: "TEST-public-key-123", accessToken: ACCESS, refreshToken: "TG-refresh-inicial", expiraEn: new Date(ahora.getTime() + 180 * 86_400_000) }, llavero);

    await t.test("link de pago: una preferencia por retención, con monto, vencimiento y notificación", async () => {
      const r = await reservar("10:00");
      const uno = await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(1), llavero);
      const dos = await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(2), llavero);
      assert.equal(uno.url, dos.url, "el segundo clic reutiliza la preferencia");
      assert.equal(preferencias.length, 1);
      const p = preferencias[0]!;
      assert.equal(p.monto, "9000.00");
      assert.equal(p.expiraEn.toISOString(), r.expiraEn);
      assert.equal(p.urlNotificacion, `https://api.example/api/webhooks/mercadopago/${a.centro.id}`);
      assert.equal(p.urlRetorno, "https://portal.example/?pago=retorno");
      assert.equal(p.referenciaExterna, await checkoutDe(r.reservaId));
      assert.equal(p.claveIdempotencia, p.referenciaExterna);
      assert.match(p.titulo, /Semi · Centro/);

      // Sin HTTPS (local) no se pide notificación.
      const local = await reservar("11:00");
      await iniciarPagoPublico(db, pasarela, { token: local.token, urlApi: "http://localhost:3000", urlPortal: "http://localhost:5173" }, mas(1), llavero);
      assert.equal(preferencias.at(-1)!.urlNotificacion, null);

      await assert.rejects(iniciarPagoPublico(db, pasarela, { token: "x".repeat(43), ...urls }, mas(1), llavero), AccesoDenegado);
      await assert.rejects(iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(16), llavero), DatosInvalidos, "retención vencida");
    });

    await t.test("pago rechazado: queda registrado y la reserva sigue esperando la seña", async () => {
      const r = await reservar("12:00");
      await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(1), llavero);
      const { r: res } = await pagar(r.reservaId, { status: "rejected", statusDetail: "cc_rejected_insufficient_amount", aprobadoEn: null });
      assert.equal(res.resultado, "RECHAZADO");
      assert.equal(await estado(r.reservaId), "PENDIENTE_PAGO");
      assert.equal((await consultarReservaPublica(db, r.token, mas(2))).pago, "RECHAZADO");

      // Reintento aprobado dentro de la retención: confirma.
      const ok = await pagar(r.reservaId);
      assert.deepEqual(ok.r, { resultado: "APROBADO", reservaConfirmada: "EN_TERMINO" });
      assert.equal(await estado(r.reservaId), "CONFIRMADA");
      const consulta = await consultarReservaPublica(db, r.token, mas(2));
      assert.deepEqual([consulta.estado, consulta.pago], ["CONFIRMADA", "APROBADO"]);
    });

    await t.test("pago aprobado en término: confirma una sola vez, con evento e idempotente", async () => {
      const r = await reservar("13:00");
      await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(1), llavero);
      const { id, r: res } = await pagar(r.reservaId);
      assert.deepEqual(res, { resultado: "APROBADO", reservaConfirmada: "EN_TERMINO" });
      const reserva = await db.reserva.findUniqueOrThrow({ where: { id: r.reservaId }, include: { eventos: { orderBy: { orden: "asc" } } } });
      assert.deepEqual([reserva.estado, reserva.expiraEn], ["CONFIRMADA", null]);
      const evento = reserva.eventos.at(-1)!;
      const detalle = evento.detalle as { origen: string; tardio: boolean };
      assert.deepEqual([evento.tipo, evento.estadoAnterior, detalle.origen, detalle.tardio], ["CONFIRMADA", "PENDIENTE_PAGO", "mercadopago", false]);

      // La misma notificación otra vez (o el retorno del portal) no cambia nada.
      const otra = await procesarPagoMercadoPago(db, pasarela, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: id }, mas(3), llavero);
      assert.equal(otra.resultado, "SIN_CAMBIOS");
      assert.equal(await db.reservaEvento.count({ where: { reservaId: r.reservaId, tipo: "CONFIRMADA" } }), 1);

      // Un segundo pago aprobado para la misma reserva no se aplica: se devuelve.
      const doble = await pagar(r.reservaId, {}, mas(4));
      assert.deepEqual([doble.r.resultado, doble.r.motivo], ["A_DEVOLVER", "la reserva ya tenía un pago aprobado"]);

      // La devolución posterior en Mercado Pago no toca el turno (M01 la concilia).
      pagos.set(id, { ...pagos.get(id)!, status: "refunded" });
      assert.equal((await procesarPagoMercadoPago(db, pasarela, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: id }, mas(5), llavero)).resultado, "REEMBOLSADO");
      assert.equal(await estado(r.reservaId), "CONFIRMADA");
      const pago = await db.pago.findFirstOrThrow({ where: { externoId: id } });
      assert.deepEqual([pago.estado, pago.aprobadoEn?.toISOString()], ["REEMBOLSADO", mas(1).toISOString()], "conserva cuándo se aprobó");
    });

    await t.test("monto, moneda o cuenta que no cierran: no confirma y queda a devolver", async () => {
      for (const [hhmm, extra, motivo] of [
        ["14:00", { monto: "1.00" }, /monto 1.00, se esperaba 9000.00/],
        ["15:00", { moneda: "USD" }, /moneda USD/],
        ["16:00", { cobradorId: "999" }, /cuenta receptora/],
      ] as const) {
        const r = await reservar(hhmm);
        await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(1), llavero);
        const { r: res } = await pagar(r.reservaId, extra);
        assert.equal(res.resultado, "A_DEVOLVER");
        assert.match(res.motivo!, motivo);
        assert.equal(await estado(r.reservaId), "PENDIENTE_PAGO");
      }
    });

    await t.test("pago tardío: confirma si el horario sigue libre, si no queda a devolver", async () => {
      const libre = await reservar("09:00", mas(30));
      const ocupado = await reservar("10:00", mas(30));
      for (const r of [libre, ocupado]) await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(31), llavero);
      // Vence la retención: la de las 9 la marca el worker (EXPIRADA); la de las 10 sigue PENDIENTE_PAGO
      // vencida, que el motor ya ignora. Otra persona toma el horario de las 10.
      // Solo esta reserva: expirarRetenciones es global y los archivos de prueba corren en paralelo.
      await db.reserva.update({ where: { id: libre.reservaId }, data: { estado: "EXPIRADA" } });
      const otra = await reservar("10:00", mas(51));
      assert.equal(otra.estado, "PENDIENTE_PAGO");

      const a1 = await pagar(libre.reservaId, {}, mas(52));
      assert.deepEqual(a1.r, { resultado: "APROBADO", reservaConfirmada: "TARDIO" });
      assert.equal(await estado(libre.reservaId), "CONFIRMADA");
      const ev = await db.reservaEvento.findFirstOrThrow({ where: { reservaId: libre.reservaId, tipo: "CONFIRMADA" } });
      assert.deepEqual([ev.estadoAnterior, (ev.detalle as { tardio: boolean }).tardio], ["EXPIRADA", true]);

      const a2 = await pagar(ocupado.reservaId, {}, mas(52));
      assert.equal(a2.r.resultado, "A_DEVOLVER");
      assert.match(a2.r.motivo!, /horario ya no está disponible/);
      assert.equal(await estado(ocupado.reservaId), "EXPIRADA");
      assert.equal((await consultarReservaPublica(db, ocupado.token, mas(53))).pago, "A_DEVOLVER");
    });

    await t.test("reserva cancelada antes del pago: no se reactiva", async () => {
      const r = await reservar("11:00", mas(60));
      await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(61), llavero);
      await cancelarReserva(db, M, O, r.reservaId, "Llamó para cancelar", mas(62));
      const { r: res } = await pagar(r.reservaId, {}, mas(63));
      assert.deepEqual([res.resultado, res.motivo], ["A_DEVOLVER", "la reserva estaba cancelada"]);
      assert.equal(await estado(r.reservaId), "CANCELADA");
    });

    await t.test("notificaciones concurrentes del mismo pago: un solo efecto", async () => {
      const r = await reservar("14:00", mas(70));
      await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(71), llavero);
      const id = String(++siguienteId);
      pagos.set(id, { id, status: "approved", statusDetail: "accredited", monto: "9000.00", moneda: "ARS", referenciaExterna: await checkoutDe(r.reservaId), cobradorId: CUENTA, aprobadoEn: mas(72) });
      const resultados = await Promise.all(Array.from({ length: 4 }, () => procesarPagoMercadoPago(db, pasarela, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: id }, mas(72), llavero)));
      assert.deepEqual(resultados.map(x => x.resultado).sort(), ["APROBADO", "SIN_CAMBIOS", "SIN_CAMBIOS", "SIN_CAMBIOS"]);
      assert.equal(await db.pago.count({ where: { reservaId: r.reservaId } }), 1);
      assert.equal(await db.reservaEvento.count({ where: { reservaId: r.reservaId, tipo: "CONFIRMADA" } }), 1);
    });

    await t.test("pagos ajenos, payload inválido y sedes sin credenciales", async () => {
      assert.equal((await aplicarPago(db, { sedeId: a.centro.id, ambiente: "PRUEBA", cuentaId: CUENTA }, { id: "1", status: "approved", statusDetail: null, monto: "10.00", moneda: "ARS", referenciaExterna: "venta-de-mostrador", cobradorId: CUENTA, aprobadoEn: ahora }, ahora)).resultado, "AJENO");
      // Un checkout de otra sede no se aplica con la cuenta de esta.
      const r = await reservar("15:00", mas(80));
      await iniciarPagoPublico(db, pasarela, { token: r.token, ...urls }, mas(81), llavero);
      assert.equal((await aplicarPago(db, { sedeId: a.norte.id, ambiente: "PRUEBA", cuentaId: CUENTA }, { id: "2", status: "approved", statusDetail: null, monto: "9000.00", moneda: "ARS", referenciaExterna: await checkoutDe(r.reservaId), cobradorId: CUENTA, aprobadoEn: ahora }, mas(82))).resultado, "AJENO");
      assert.equal(await estado(r.reservaId), "PENDIENTE_PAGO");

      await assert.rejects(procesarPagoMercadoPago(db, pasarela, { sedeId: "x" }, ahora, llavero), ErrorPermanente);
      await assert.rejects(procesarPagoMercadoPago(db, pasarela, { sedeId: a.norte.id, ambiente: "PRUEBA", pagoId: "1" }, ahora, llavero), ErrorPermanente);
    });

    await t.test("token por vencer: se renueva antes de consultar el pago", async () => {
      const nuevo = `APP_USR-${"n".repeat(30)}`, cuando = new Date(ahora.getTime() + 170 * 86_400_000);
      let pedidos = 0;
      const conRenovacion: PasarelaMercadoPago = {
        ...pasarela,
        obtenerPago: async (token, id) => { assert.equal(token, nuevo, "consulta con el token renovado"); return { id, status: "rejected", statusDetail: null, monto: "1.00", moneda: "ARS", referenciaExterna: null, cobradorId: CUENTA, aprobadoEn: null }; },
        renovarTokens: async refreshToken => { pedidos++; assert.equal(refreshToken, "TG-refresh-inicial"); return { cuentaId: CUENTA, publicKey: null, accessToken: nuevo, refreshToken: "TG-refresh-2", expiraEn: new Date(cuando.getTime() + 180 * 86_400_000) }; },
      };
      assert.equal((await procesarPagoMercadoPago(db, conRenovacion, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "424242" }, cuando, llavero)).resultado, "AJENO");
      await procesarPagoMercadoPago(db, conRenovacion, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "424243" }, cuando, llavero);
      assert.equal(pedidos, 1, "la segunda consulta ya usa el token renovado");
    });

    await t.test("notificación y retorno encolan una consulta deduplicada", async () => {
      const uno = await encolarConsultaPago(db, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "555", origen: "req-1" });
      const dos = await encolarConsultaPago(db, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "555", origen: "req-1" });
      assert.deepEqual([uno.creado, dos.creado, uno.id], [true, false, dos.id]);
      const job = await db.job.findUniqueOrThrow({ where: { id: uno.id } });
      assert.deepEqual([job.tipo, job.payload, job.organizacionId], ["pagos.mercadopago", { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "555" }, O]);
      await assert.rejects(encolarConsultaPago(db, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "../x", origen: "r" }), DatosInvalidos);

      // Una consulta que falló (p. ej. credenciales mal cargadas) se rearma con el reenvío de la notificación.
      await db.job.update({ where: { id: uno.id }, data: { estado: "FALLIDO", intentos: 8, ultimoError: "401" } });
      await encolarConsultaPago(db, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "555", origen: "req-1" });
      const rearmado = await db.job.findUniqueOrThrow({ where: { id: uno.id } });
      assert.deepEqual([rearmado.estado, rearmado.intentos, rearmado.ultimoError], ["PENDIENTE", 0, null]);
      // Un trabajo completado no se repite.
      await db.job.update({ where: { id: uno.id }, data: { estado: "COMPLETADO" } });
      await encolarConsultaPago(db, { sedeId: a.centro.id, ambiente: "PRUEBA", pagoId: "555", origen: "req-1" });
      assert.equal((await db.job.findUniqueOrThrow({ where: { id: uno.id } })).estado, "COMPLETADO");

      const r = await reservar("16:00", mas(90));
      await verificarPagoPublico(db, r.token, "777", mas(91));
      assert.equal(await db.job.count({ where: { clave: `mp:PRUEBA:777:retorno:${r.reservaId}` } }), 1);
      await assert.rejects(verificarPagoPublico(db, "x".repeat(43), "777", mas(91)), AccesoDenegado);

      // Tope de ids distintos por reserva; repetir uno ya pedido sigue permitido.
      for (const id of ["778", "779", "780", "781"]) await verificarPagoPublico(db, r.token, id, mas(91));
      await assert.rejects(verificarPagoPublico(db, r.token, "782", mas(91)), LimiteExcedido);
      await verificarPagoPublico(db, r.token, "777", mas(92));
    });
  } finally {
    await db.$disconnect();
  }
});
