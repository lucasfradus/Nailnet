import { test } from "node:test";
import assert from "node:assert/strict";
import { generarToken, hashPassword, hashToken, normalizarEmail, requiereRehash, validarPassword, verificarPassword } from "../src/credenciales.ts";

test("hash de contraseña verifica la correcta y rechaza otras", async () => {
  const hash = await hashPassword("una frase larga y propia");
  assert.match(hash, /^scrypt\$v1\$32768\$8\$3\$/);
  assert.equal(await verificarPassword("una frase larga y propia", hash), true);
  assert.equal(await verificarPassword("una frase larga y propiA", hash), false);
  assert.notEqual(await hashPassword("una frase larga y propia"), hash, "cada hash usa sal propia");
  assert.equal(requiereRehash(hash), false);
});
test("hashes con formato desconocido o parámetros abusivos no validan", async () => {
  assert.equal(await verificarPassword("x".repeat(12), "plano"), false);
  assert.equal(await verificarPassword("x".repeat(12), "scrypt$v1$4194304$8$1$AAAA$AAAA"), false);
  assert.equal(requiereRehash("scrypt$v1$16384$8$1$a$b"), true);
});
test("política de longitud", async () => {
  assert.ok(validarPassword("corta"));
  assert.ok(validarPassword("x".repeat(129)));
  assert.equal(validarPassword("doce letras!"), null);
  await assert.rejects(hashPassword("corta"));
});
test("tokens opacos: solo se persiste el hash", () => {
  const { token, hash } = generarToken();
  assert.equal(hashToken(token), hash);
  assert.ok(token.length >= 43);
  assert.notEqual(generarToken().token, token);
});
test("normalización de email", () => {
  assert.equal(normalizarEmail("  Ana@Ejemplo.COM "), "ana@ejemplo.com");
});
