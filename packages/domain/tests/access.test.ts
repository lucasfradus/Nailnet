import { test } from "node:test";
import assert from "node:assert/strict";
import { tienePermiso } from "../src/access.ts";
test("un rol con alcance inválido no concede privilegios", () => {
  assert.equal(tienePermiso({ rol: "ADMIN_SEDE", alcance: "ORGANIZACION", sedeId: null, franquiciadoId: null }, "sede:administrar"), false);
  assert.equal(tienePermiso({ rol: "MASTER_FRANQUICIADOR", alcance: "SEDE", sedeId: "sede", franquiciadoId: null }, "sede:leer"), false);
});
test("recepción no administra y profesional no accede al catálogo administrativo", () => {
  assert.equal(tienePermiso({ rol: "RECEPCIONISTA", alcance: "SEDE", sedeId: "sede", franquiciadoId: null }, "sede:administrar"), false);
  assert.equal(tienePermiso({ rol: "PROFESIONAL", alcance: "PROPIO", sedeId: null, franquiciadoId: null }, "sede:leer"), false);
});
