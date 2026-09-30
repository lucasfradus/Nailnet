import { test } from "node:test";
import assert from "node:assert/strict";
import { administraUsuario, puedeCrearSede, puedeOtorgar, tienePermiso, veUsuario, type Asignacion } from "../src/access.ts";
test("un rol con alcance inválido no concede privilegios", () => {
  assert.equal(tienePermiso({ rol: "ADMIN_SEDE", alcance: "ORGANIZACION", sedeId: null, franquiciadoId: null }, "sede:administrar"), false);
  assert.equal(tienePermiso({ rol: "MASTER_FRANQUICIADOR", alcance: "SEDE", sedeId: "sede", franquiciadoId: null }, "sede:leer"), false);
});
test("recepción no administra y profesional no accede al catálogo administrativo", () => {
  assert.equal(tienePermiso({ rol: "RECEPCIONISTA", alcance: "SEDE", sedeId: "sede", franquiciadoId: null }, "sede:administrar"), false);
  assert.equal(tienePermiso({ rol: "PROFESIONAL", alcance: "PROPIO", sedeId: null, franquiciadoId: null }, "sede:leer"), false);
});

const sedes: Record<string, string> = { centro: "franA", norte: "franA", sur: "franB" };
const de = (id: string) => sedes[id];
const master: Asignacion = { rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION", franquiciadoId: null, sedeId: null };
const franA: Asignacion = { rol: "FRANQUICIADO", alcance: "FRANQUICIADO", franquiciadoId: "franA", sedeId: null };
const admin = (sedeId: string): Asignacion => ({ rol: "ADMIN_SEDE", alcance: "SEDE", franquiciadoId: null, sedeId });
const recepcion = (sedeId: string): Asignacion => ({ rol: "RECEPCIONISTA", alcance: "SEDE", franquiciadoId: null, sedeId });
const profesional: Asignacion = { rol: "PROFESIONAL", alcance: "PROPIO", franquiciadoId: null, sedeId: null };

test("delegación: nadie concede más de lo que alcanza", () => {
  assert.equal(puedeOtorgar([master], franA, de), true);
  assert.equal(puedeOtorgar([franA], recepcion("norte"), de), true);
  assert.equal(puedeOtorgar([franA], recepcion("sur"), de), false, "sede de otro franquiciado");
  assert.equal(puedeOtorgar([franA], franA, de), false, "franquiciado no crea franquiciados");
  assert.equal(puedeOtorgar([franA], master, de), false);
  assert.equal(puedeOtorgar([franA], profesional, de), false, "profesional sin sede: solo master hasta C03");
  assert.equal(puedeOtorgar([admin("centro")], recepcion("centro"), de), false, "admin de sede no concede roles");
  assert.equal(puedeOtorgar([master], recepcion("inexistente"), de), false);
  assert.equal(puedeOtorgar([master], { ...recepcion("centro"), franquiciadoId: "franA" }, de), false, "forma inválida");
});
test("administrar un usuario exige cubrir todas sus asignaciones", () => {
  assert.equal(administraUsuario([franA], [recepcion("centro"), recepcion("norte")], de), true);
  assert.equal(administraUsuario([franA], [recepcion("centro"), recepcion("sur")], de), false);
  assert.equal(administraUsuario([franA], [], de), false);
  assert.equal(administraUsuario([master], [], de), true);
});
test("visibilidad de usuarios por alcance", () => {
  assert.equal(veUsuario([admin("centro")], [recepcion("centro"), recepcion("sur")], de), true);
  assert.equal(veUsuario([admin("centro")], [recepcion("norte")], de), false);
  assert.equal(veUsuario([franA], [recepcion("sur")], de), false);
  assert.equal(veUsuario([recepcion("centro")], [recepcion("centro")], de), false, "recepción no lista usuarios");
  assert.equal(veUsuario([master], [], de), true);
});
test("crear sedes solo en franquiciados propios", () => {
  assert.equal(puedeCrearSede([franA], "franA"), true);
  assert.equal(puedeCrearSede([franA], "franB"), false);
  assert.equal(puedeCrearSede([admin("centro")], "franA"), false);
  assert.equal(puedeCrearSede([master], "franB"), true);
});
