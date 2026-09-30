import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { CifradoNoConfigurado, SecretoIlegible, cifrar, descifrar, llaveroDesde, pista, redactar, validarCredencial, versionDe } from "../src/secretos.ts";
import { resolverConfiguracion, validarValores } from "../src/configuracion.ts";

const k1 = randomBytes(32).toString("base64"), k2 = randomBytes(32).toString("base64");

test("cifrado autenticado ligado al contexto", () => {
  const llavero = llaveroDesde(`v1:${k1}`, "v1");
  const c = cifrar(llavero, "APP_USR-secreto", "sede-a|MERCADO_PAGO|PRUEBA");
  assert.equal(descifrar(llavero, c, "sede-a|MERCADO_PAGO|PRUEBA"), "APP_USR-secreto");
  assert.notEqual(cifrar(llavero, "APP_USR-secreto", "x"), cifrar(llavero, "APP_USR-secreto", "x"), "IV aleatorio");
  assert.throws(() => descifrar(llavero, c, "sede-b|MERCADO_PAGO|PRUEBA"), SecretoIlegible, "copiado a otra sede");
  const partes = c.split("."); partes[4] = Buffer.from("otro").toString("base64url");
  assert.throws(() => descifrar(llavero, partes.join("."), "sede-a|MERCADO_PAGO|PRUEBA"), SecretoIlegible, "alterado");
});
test("rotación: versiones viejas se leen, se escribe con la activa", () => {
  const viejo = cifrar(llaveroDesde(`v1:${k1}`, "v1"), "dato", "ctx");
  const nuevo = llaveroDesde(`v1:${k1};v2:${k2}`, "v2");
  assert.equal(descifrar(nuevo, viejo, "ctx"), "dato");
  assert.equal(versionDe(cifrar(nuevo, "dato", "ctx")), "v2");
  assert.throws(() => descifrar(llaveroDesde(`v2:${k2}`, "v2"), viejo, "ctx"), SecretoIlegible, "clave retirada");
});
test("sin configuración o claves inválidas no cifra", () => {
  assert.throws(() => llaveroDesde(undefined, "v1"), CifradoNoConfigurado);
  assert.throws(() => llaveroDesde(`v1:${k1}`, "v2"), CifradoNoConfigurado);
  assert.throws(() => llaveroDesde("v1:corta", "v1"), CifradoNoConfigurado);
});
test("redacción y pista", () => {
  assert.deepEqual(redactar({ accessToken: "x", nested: [{ password: "y", nombre: "ok" }], webhookSecret: "z", cuentaId: "1" }), { accessToken: "[redactado]", nested: [{ password: "[redactado]", nombre: "ok" }], webhookSecret: "[redactado]", cuentaId: "1" });
  assert.equal(pista("APP_USR-1234567890abcd"), "••••abcd");
  assert.equal(pista("corto"), "••••");
});
test("validación de credenciales por proveedor", () => {
  const ok = validarCredencial("MERCADO_PAGO", { cuentaId: "123456", publicKey: "TEST-abcdefgh-1234", accessToken: "TEST-" + "a".repeat(30), webhookSecret: "b".repeat(32) });
  assert.ok("secretos" in ok && ok.cuentaExterna === "123456");
  assert.ok("error" in validarCredencial("MERCADO_PAGO", { cuentaId: "abc" }));
  assert.ok("error" in validarCredencial("FACTURANTE", { companyId: "1", subsidiaryId: "2", usuario: "u", password: "123456" }));
});
test("herencia de configuración y rangos", () => {
  const r = resolverConfiguracion({ horizonteReservaDias: 14, anticipacionMinimaMinutos: null }, { horizonteReservaDias: 30 });
  assert.deepEqual(r.horizonteReservaDias, { valor: 30, origen: "SEDE" });
  assert.deepEqual(r.anticipacionMinimaMinutos, { valor: null, origen: "SIN_DEFINIR" });
  assert.deepEqual(resolverConfiguracion({ horizonteReservaDias: 14 }, null).horizonteReservaDias, { valor: 14, origen: "ORGANIZACION" });
  assert.ok("error" in validarValores({ horizonteReservaDias: 0 }));
  assert.ok("error" in validarValores({ anticipacionMinimaMinutos: 1.5 }));
  assert.deepEqual(validarValores({ horizonteReservaDias: null }), { valores: { horizonteReservaDias: null } });
});
