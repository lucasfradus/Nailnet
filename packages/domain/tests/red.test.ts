import { test } from "node:test";
import assert from "node:assert/strict";
import { ipCliente, origen } from "../src/red.ts";

const cab = (h: Record<string, string>) => new Headers(h);

test("IP del cliente: sin proxy declarado no se confía en ninguna cabecera", () => {
  assert.equal(ipCliente(cab({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }), { confiarEnProxy: false }), null);
});

test("IP del cliente detrás de Railway: x-real-ip, no lo que el cliente pone en x-forwarded-for", () => {
  // El cliente manda un X-Forwarded-For inventado; el edge lo conserva y fija X-Real-IP.
  const h = cab({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-real-ip": "203.0.113.9" });
  assert.equal(ipCliente(h, { confiarEnProxy: true, cabecera: "x-real-ip" }), "203.0.113.9");
  assert.equal(ipCliente(h, { confiarEnProxy: true, cabecera: "X-Real-IP" }), "203.0.113.9", "sin distinguir mayúsculas");
  assert.equal(ipCliente(cab({}), { confiarEnProxy: true, cabecera: "x-real-ip" }), null);
});

test("IP del cliente con x-forwarded-for (proxy propio que la reescribe): primer valor", () => {
  assert.equal(ipCliente(cab({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" }), { confiarEnProxy: true }), "198.51.100.7");
  assert.equal(ipCliente(cab({ "x-forwarded-for": "2001:db8::1" }), { confiarEnProxy: true, cabecera: "" }), "2001:db8::1");
});

test("IP del cliente: valores que no son IP se descartan", () => {
  for (const malo of ["<script>", "1.2.3.4; DROP", "x".repeat(60), "unknown"]) {
    assert.equal(ipCliente(cab({ "x-real-ip": malo }), { confiarEnProxy: true, cabecera: "x-real-ip" }), null, malo);
  }
});

test("origen: dominio pelado, origen completo, barra final y vacío", () => {
  assert.equal(origen("booking-production.up.railway.app"), "https://booking-production.up.railway.app");
  assert.equal(origen("https://reservas.sicurella.com.ar/"), "https://reservas.sicurella.com.ar");
  assert.equal(origen("http://localhost:5173"), "http://localhost:5173");
  assert.equal(origen("  "), null);
  assert.equal(origen(undefined), null);
});
