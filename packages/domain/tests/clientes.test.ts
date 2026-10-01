import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoConsentimiento, normalizarTelefono, validarClaveConsentimiento, validarCliente } from "../src/clientes.ts";

test("ficha de cliente: contacto obligatorio, normalización y documento", () => {
  const ok = validarCliente({ nombre: "  Ana   María ", email: " ANA@Ejemplo.com ", telefono: "011 15-3328-7024", tipoDocumento: "DNI", documento: "30.123.456" });
  assert.ok("datos" in ok);
  assert.equal(ok.datos.nombre, "Ana María");
  assert.equal(ok.datos.email, "ana@ejemplo.com");
  assert.equal(ok.datos.telefono, "0111533287024");
  assert.equal(ok.datos.documento, "30123456");
  assert.ok("error" in validarCliente({ nombre: "Sin contacto" }));
  assert.ok("error" in validarCliente({ nombre: "", email: "a@b.co" }));
  assert.ok("error" in validarCliente({ nombre: "X", email: "no-email" }));
  assert.ok("error" in validarCliente({ nombre: "X", telefono: "123" }));
  assert.ok("error" in validarCliente({ nombre: "X", email: "a@b.co", documento: "30123456" }), "documento sin tipo");
  assert.ok("error" in validarCliente({ nombre: "X", email: "a@b.co", tipoDocumento: "CUIT", documento: "123" }));
  assert.equal(normalizarTelefono("+54 9 11 3328-7024"), "+5491133287024");
});
test("consentimiento: una versión nueva exige volver a aceptar; revocar gana", () => {
  const t = (m: number) => new Date(2026, 9, 1, 10, m);
  const r = [{ clave: "laser", version: 1, accion: "ACEPTA" as const, registradoEn: t(0) }];
  assert.equal(estadoConsentimiento(r, "laser", 1), "VIGENTE");
  assert.equal(estadoConsentimiento(r, "laser", 2), "DESACTUALIZADO");
  assert.equal(estadoConsentimiento([...r, { clave: "laser", version: 1, accion: "REVOCA", registradoEn: t(5) }], "laser", 1), "REVOCADO");
  assert.equal(estadoConsentimiento([...r, { clave: "laser", version: 1, accion: "REVOCA", registradoEn: t(5) }, { clave: "laser", version: 1, accion: "ACEPTA", registradoEn: t(9) }], "laser", 1), "VIGENTE");
  assert.equal(estadoConsentimiento(r, "otra", 1), "NUNCA");
  assert.equal(validarClaveConsentimiento("depilacion-laser"), true);
  assert.equal(validarClaveConsentimiento("Con Espacios"), false);
});
