import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { emailRecuperacion, emailReservaCancelada, emailReservaConfirmada, emailReservaReprogramada, enlaceSeguro, escaparHtml, fechaHora, limpiarLinea } from "../src/emails.ts";
import { RANGO_ENVIO, estadoEntregaResend, verificarFirmaResend } from "../src/resend.ts";

const TZ = "America/Argentina/Buenos_Aires";
// 13/10/2099 15:30 en Buenos Aires (UTC−3).
const inicio = new Date("2099-10-13T18:30:00Z");
const base = { marca: "Sicurella", sede: "Centro", timezone: TZ, cliente: "Lucía", items: [{ servicio: "Semipermanente", profesional: "Ana", inicio }] };

test("escape y limpieza", () => {
  assert.equal(escaparHtml(`<script>alert("x")</script> & 'y'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
  assert.equal(limpiarLinea("Hola\r\nBcc: otro@example.com\t fin"), "Hola Bcc: otro@example.com fin");
  assert.equal(limpiarLinea("x".repeat(300)).length, 200);
  assert.equal(enlaceSeguro("https://backoffice.example/restablecer#abc"), "https://backoffice.example/restablecer#abc");
  assert.equal(enlaceSeguro("http://localhost:3000/restablecer#abc"), "http://localhost:3000/restablecer#abc");
  assert.equal(enlaceSeguro("http://backoffice.example/restablecer"), null);
  assert.equal(enlaceSeguro("javascript:alert(1)"), null);
  assert.equal(enlaceSeguro("no es url"), null);
});

test("fecha y hora en la zona de la sede", () => {
  assert.deepEqual(fechaHora(inicio, TZ), { fecha: "martes, 13 de octubre", hora: "15:30" });
  assert.equal(fechaHora(inicio, "UTC").hora, "18:30");
});

test("confirmación con datos del turno, marca y texto alternativo", () => {
  const m = emailReservaConfirmada({ ...base, items: [...base.items, { servicio: "Kapping", profesional: "Ana", inicio: new Date(inicio.getTime() + 3_600_000) }] });
  assert.equal(m.asunto, "Tu turno en Sicurella Centro está confirmado: martes, 13 de octubre, 15:30 h");
  for (const parte of ["Sicurella", "Hola, Lucía.", "15:30 h", "Semipermanente + Kapping", "Servicios", "Ana", "Centro"]) {
    assert.ok(m.html.includes(parte), parte);
    assert.ok(m.texto.includes(parte), parte);
  }
  assert.ok(m.html.startsWith("<!doctype html>") && m.html.includes('lang="es"'));
  assert.ok(!m.texto.includes("<"), "el texto no lleva HTML");
  assert.ok(m.html.includes("#008094"), "teal de marca");
});

test("los datos del cliente se escapan y no rompen el asunto", () => {
  const m = emailReservaConfirmada({ ...base, cliente: `<img src=x onerror="alert(1)">`, sede: "Centro\r\nBcc: x@example.com", items: [{ servicio: "<b>Semi</b>", profesional: "Ana & Co", inicio }] });
  assert.ok(!m.html.includes("<img"), "sin HTML inyectado");
  assert.ok(m.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(m.html.includes("&lt;b&gt;Semi&lt;/b&gt;") && m.html.includes("Ana &amp; Co"));
  assert.ok(!/[\r\n]/.test(m.asunto));
  // El texto plano no se escapa: va tal cual, sin saltos inyectados en los campos.
  assert.ok(m.texto.includes("Servicio: <b>Semi</b>"));
  assert.ok(m.texto.includes("Sede: Centro Bcc: x@example.com"));
});

test("cancelación y reprogramación", () => {
  const c = emailReservaCancelada(base);
  assert.match(c.asunto, /^Tu turno del martes, 13 de octubre, 15:30 h en Sicurella Centro fue cancelado$/);
  assert.ok(c.texto.includes("seña"));
  const r = emailReservaReprogramada({ ...base, items: [{ ...base.items[0]!, inicio: new Date("2099-10-14T13:00:00Z") }], anterior: inicio });
  assert.equal(r.asunto, "Cambiamos tu turno en Sicurella Centro: ahora es el miércoles, 14 de octubre, 10:00 h");
  assert.ok(r.texto.includes("Tu turno del martes, 13 de octubre a las 15:30 h quedó reprogramado"));
  assert.ok(r.texto.includes("Hora: 10:00 h"));
});

test("recuperación de contraseña", () => {
  const m = emailRecuperacion({ marca: "Sicurella", nombre: "Admin", enlace: "https://backoffice.example/restablecer#tok_en-123", minutos: 30 });
  assert.ok(m.html.includes('href="https://backoffice.example/restablecer#tok_en-123"'));
  assert.ok(m.texto.includes("https://backoffice.example/restablecer#tok_en-123"));
  assert.ok(m.texto.includes("vence en 30 minutos"));
  assert.throws(() => emailRecuperacion({ marca: "S", nombre: "A", enlace: "javascript:alert(1)", minutos: 30 }));
  // Sin nombre: saludo genérico.
  assert.ok(emailRecuperacion({ marca: "S", nombre: " ", enlace: "https://x.example/r", minutos: 30 }).texto.includes("Hola.\n"));
});

test("firma de webhooks de Resend (Svix)", () => {
  // Vector de ejemplo de la documentación de Svix.
  const ejemplo = { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", cuerpo: '{"test": 2432232314}', secreto: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", ahora: new Date(1614265330_000) };
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" }), true);

  const clave = Buffer.from("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "base64");
  const firmar = (id: string, ts: string, cuerpo: string) => createHmac("sha256", clave).update(`${id}.${ts}.${cuerpo}`).digest("base64");
  const v = firmar(ejemplo.id, ejemplo.timestamp, ejemplo.cuerpo);
  // Varias firmas (rotación): alcanza con una válida.
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,AAAA v1,${v}` }), true);
  // Datos alterados.
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, cuerpo: '{"test": 1}' }), false);
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, id: "msg_otro" }), false);
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, secreto: "whsec_b3RyYQ==" }), false);
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v2,${v}` }), false);
  // Fuera de la ventana de 5 minutos.
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, ahora: new Date(1614265330_000 + 6 * 60_000) }), false);
  // Faltantes o secreto sin prefijo.
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: null }), false);
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, id: null }), false);
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, timestamp: "abc" }), false);
  assert.equal(verificarFirmaResend({ ...ejemplo, firma: `v1,${v}`, secreto: "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" }), false);
});

test("estados de entrega", () => {
  assert.equal(estadoEntregaResend("email.delivered"), "ENTREGADO");
  assert.equal(estadoEntregaResend("email.bounced"), "REBOTADO");
  assert.equal(estadoEntregaResend("email.complained"), "QUEJA");
  assert.equal(estadoEntregaResend("email.delivery_delayed"), "DEMORADO");
  assert.equal(estadoEntregaResend("email.opened"), null);
  assert.ok(RANGO_ENVIO.ENTREGADO! > RANGO_ENVIO.DEMORADO! && RANGO_ENVIO.QUEJA! > RANGO_ENVIO.ENTREGADO!);
});
