import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorProveedor, ErrorTransitorio, crearPreferencia, obtenerPago } from "../src/mercadopago.ts";

type Llamada = { url: string; init: RequestInit };
function falso(status: number, cuerpo: unknown, llamadas: Llamada[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
const ahora = new Date("2099-10-01T12:00:00Z");
const preferencia = {
  claveIdempotencia: "checkout-1", titulo: "Seña · Semi", monto: "9000.00", referenciaExterna: "00000000-0000-4000-8000-000000000001",
  urlNotificacion: "https://api.example/api/webhooks/mercadopago/sede", urlRetorno: "https://portal.example/?pago=retorno",
  expiraEn: new Date("2099-10-01T12:15:00Z"), ahora,
};

test("crear preferencia de Checkout Pro", async () => {
  const llamadas: Llamada[] = [];
  const r = await crearPreferencia("TEST-token", preferencia, "PRUEBA", falso(201, { id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1", sandbox_init_point: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" }, llamadas));
  assert.deepEqual(r, { id: "pref-1", url: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" });
  const { url, init } = llamadas[0]!;
  assert.equal(url, "https://api.mercadopago.com/checkout/preferences");
  const h = init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer TEST-token");
  assert.equal(h["X-Idempotency-Key"], "checkout-1");
  const cuerpo = JSON.parse(String(init.body));
  assert.equal(cuerpo.external_reference, preferencia.referenciaExterna);
  assert.equal(cuerpo.items[0].unit_price, 9000);
  assert.equal(cuerpo.items[0].currency_id, "ARS");
  assert.equal(cuerpo.binary_mode, true);
  assert.equal(cuerpo.expires, true);
  assert.equal(cuerpo.expiration_date_to, "2099-10-01T12:15:00.000Z");
  assert.deepEqual(cuerpo.payment_methods.excluded_payment_types, [{ id: "ticket" }, { id: "atm" }]);

  // En producción, el checkout real; sin URL de notificación (p. ej. local) no se envía el campo.
  const prod: Llamada[] = [];
  const p = await crearPreferencia("APP_USR-token", { ...preferencia, urlNotificacion: null }, "PRODUCCION", falso(201, { id: "pref-2", init_point: "https://www.mercadopago.com.ar/x", sandbox_init_point: "https://sandbox.mercadopago.com.ar/x" }, prod));
  assert.equal(p.url, "https://www.mercadopago.com.ar/x");
  assert.equal("notification_url" in JSON.parse(String(prod[0]!.init.body)), false);
});

test("errores clasificados y sin el token", async () => {
  await assert.rejects(crearPreferencia("TEST-secreto", preferencia, "PRUEBA", falso(401, { message: "invalid access token" })), (e: unknown) => e instanceof ErrorProveedor && e.status === 401 && !e.message.includes("TEST-secreto"));
  await assert.rejects(crearPreferencia("TEST-t", preferencia, "PRUEBA", falso(503, {})), ErrorTransitorio);
  await assert.rejects(crearPreferencia("TEST-t", preferencia, "PRUEBA", falso(429, {})), ErrorTransitorio);
  await assert.rejects(crearPreferencia("TEST-t", preferencia, "PRUEBA", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch), ErrorTransitorio);
  // Respuesta exitosa sin los campos esperados.
  await assert.rejects(crearPreferencia("TEST-t", preferencia, "PRUEBA", falso(201, { id: "x", init_point: "http://inseguro" })), ErrorTransitorio);
});

test("consultar pago", async () => {
  const llamadas: Llamada[] = [];
  const pago = await obtenerPago("TEST-t", "123456", falso(200, {
    id: 123456, status: "approved", status_detail: "accredited", transaction_amount: 9000, currency_id: "ARS",
    external_reference: "ref-1", collector_id: 998877, date_approved: "2099-10-01T12:05:00.000-03:00",
  }, llamadas));
  assert.equal(llamadas[0]!.url, "https://api.mercadopago.com/v1/payments/123456");
  assert.deepEqual(pago, { id: "123456", status: "approved", statusDetail: "accredited", monto: "9000.00", moneda: "ARS", referenciaExterna: "ref-1", cobradorId: "998877", aprobadoEn: new Date("2099-10-01T15:05:00Z") });

  // Un id que no es numérico no llega a la API.
  await assert.rejects(obtenerPago("TEST-t", "../users/me", falso(200, {})), ErrorProveedor);
  await assert.rejects(obtenerPago("TEST-t", "1", falso(404, { message: "Payment not found" })), ErrorProveedor);
  await assert.rejects(obtenerPago("TEST-t", "1", falso(200, { id: 1 })), ErrorTransitorio);
});
