import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorResend, ErrorResendTransitorio, enmascararEmail, remitenteValido, transporteFalso, transporteResend } from "../src/resend.ts";

type Llamada = { url: string; init: RequestInit };
function falso(status: number, cuerpo: unknown, llamadas: Llamada[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
const KEY = "re_clave_secreta_123456";
const DE = "Sicurella <turnos@example.com>";
const mensaje = { para: "lucia@example.com", asunto: "Tu turno está confirmado", html: "<p>Hola</p>", texto: "Hola", claveIdempotencia: "email.reserva_confirmada:abc", etiquetas: { tipo: "reserva_confirmada", mal: "con espacio" } };

test("envía con idempotencia, texto y etiquetas válidas", async () => {
  const llamadas: Llamada[] = [];
  const t = transporteResend({ apiKey: KEY, de: DE, fetch: falso(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }, llamadas) });
  assert.equal(t.nombre, "resend");
  assert.deepEqual(await t.enviar(mensaje), { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  const { url, init } = llamadas[0]!;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.method, "POST");
  const h = init.headers as Record<string, string>;
  assert.equal(h.Authorization, `Bearer ${KEY}`);
  assert.equal(h["Idempotency-Key"], "email.reserva_confirmada:abc");
  const cuerpo = JSON.parse(String(init.body));
  assert.deepEqual(cuerpo, { from: DE, to: ["lucia@example.com"], subject: "Tu turno está confirmado", html: "<p>Hola</p>", text: "Hola", tags: [{ name: "tipo", value: "reserva_confirmada" }] });
});

test("errores: transitorios se reintentan, permanentes van a revisión, sin la API key", async () => {
  const enviar = (status: number, cuerpo: unknown) => transporteResend({ apiKey: KEY, de: DE, fetch: falso(status, cuerpo) }).enviar(mensaje);
  for (const [status, cuerpo] of [[500, { name: "internal_server_error" }], [503, null], [429, { name: "rate_limit_exceeded", message: "Too many requests" }], [409, { name: "concurrent_idempotent_requests" }]] as const) {
    await assert.rejects(enviar(status, cuerpo), ErrorResendTransitorio, String(status));
  }
  for (const [status, nombre] of [[422, "validation_error"], [403, "validation_error"], [401, "missing_api_key"], [409, "invalid_idempotent_request"], [400, "invalid_idempotency_key"]] as const) {
    await assert.rejects(enviar(status, { name: nombre, message: `fallo con ${KEY}` }), (e: unknown) => e instanceof ErrorResend && e.status === status && e.message.includes(nombre) && !e.message.includes(KEY));
  }
  // Red caída o tiempo agotado.
  await assert.rejects(transporteResend({ apiKey: KEY, de: DE, fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch }).enviar(mensaje), ErrorResendTransitorio);
  // 200 sin id: no se sabe si salió; se reintenta con la misma clave (Resend no duplica).
  await assert.rejects(enviar(200, {}), ErrorResendTransitorio);
});

test("configuración inválida falla al arrancar", () => {
  assert.throws(() => transporteResend({ apiKey: "", de: DE }));
  assert.throws(() => transporteResend({ apiKey: KEY, de: "sin arroba" }));
  assert.ok(remitenteValido("turnos@sicurella.com.ar"));
  assert.ok(remitenteValido("Sicurella <turnos@sicurella.com.ar>"));
  assert.ok(!remitenteValido("Sicurella\r\n<turnos@sicurella.com.ar>"));
});

test("transporte falso: registra sin red y respeta la idempotencia", async () => {
  const vistos: string[] = [];
  const t = transporteFalso({ registrar: m => vistos.push(m.asunto) });
  const a = await t.enviar(mensaje);
  const b = await t.enviar(mensaje);
  assert.equal(a.id, b.id);
  assert.match(a.id, /^simulado-[0-9a-f]{24}$/);
  assert.equal(t.enviados.length, 1);
  assert.deepEqual(vistos, ["Tu turno está confirmado"]);
  assert.notEqual((await t.enviar({ ...mensaje, claveIdempotencia: "otra" })).id, a.id);
});

test("email enmascarado para logs", () => {
  assert.equal(enmascararEmail("lucia@example.com"), "l***@example.com");
  assert.equal(enmascararEmail("roto"), "***");
});
