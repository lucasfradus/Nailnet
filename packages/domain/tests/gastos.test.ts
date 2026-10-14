import { test } from "node:test";
import assert from "node:assert/strict";
import { tienePermiso, type Asignacion } from "../src/access.ts";
import { afectaCajaEfectivo, categoriaAplicaASede, mesDe, puedeAdministrarCategoriaGasto, resumirGastos, validarGasto, validarMotivoAnulacion, validarNombreCategoria, validarPeriodo } from "../src/gastos.ts";

const hoy = "2026-10-14";
const alta = (extra = {}) => ({ fecha: "2026-10-10", monto: "15000,50", medioPago: "EFECTIVO", descripcion: "  Artículos   de limpieza ", comprobante: " FC A 0001-00001234 ", ...extra });

test("alta de gasto: normaliza y valida monto en centavos", () => {
  const r = validarGasto(alta(), hoy);
  assert.ok("gasto" in r);
  assert.deepEqual(r.gasto, { fecha: "2026-10-10", montoCentavos: 1500050n, medioPago: "EFECTIVO", descripcion: "Artículos de limpieza", comprobante: "FC A 0001-00001234" });
  const sinComprobante = validarGasto(alta({ comprobante: "   " }), hoy);
  assert.ok("gasto" in sinComprobante && sinComprobante.gasto.comprobante === null);
  for (const monto of ["0", "-10", "1.999", "abc", "", "1e3"]) assert.ok("error" in validarGasto(alta({ monto }), hoy), `monto ${monto}`);
});
test("alta de gasto: fecha, medio de pago y textos", () => {
  assert.ok("error" in validarGasto(alta({ fecha: "2026-10-15" }), hoy), "fecha futura");
  assert.ok("gasto" in validarGasto(alta({ fecha: hoy }), hoy), "hoy vale");
  assert.ok("error" in validarGasto(alta({ fecha: "2025-10-12" }), hoy), "más de un año");
  assert.ok("gasto" in validarGasto(alta({ fecha: "2025-10-13" }), hoy), "366 días justos");
  assert.ok("error" in validarGasto(alta({ fecha: "2026-02-30" }), hoy));
  assert.ok("error" in validarGasto(alta({ medioPago: "CHEQUE" }), hoy));
  assert.ok("error" in validarGasto(alta({ descripcion: " a " }), hoy));
  assert.ok("error" in validarGasto(alta({ comprobante: "x".repeat(121) }), hoy));
});
test("anulación exige motivo; nombre de categoría acotado", () => {
  assert.ok("error" in validarMotivoAnulacion("  ok "));
  assert.deepEqual(validarMotivoAnulacion(" Cargado  dos veces "), { motivo: "Cargado dos veces" });
  assert.ok("error" in validarNombreCategoria("  "));
  assert.deepEqual(validarNombreCategoria(" Servicios   públicos "), { nombre: "Servicios públicos" });
});
test("período: orden, máximo y mes calendario", () => {
  assert.equal(validarPeriodo("2026-10-01", "2026-10-31"), null);
  assert.ok(validarPeriodo("2026-10-31", "2026-10-01"));
  assert.ok(validarPeriodo("2025-01-01", "2026-01-02"), "367 días");
  assert.equal(validarPeriodo("2025-01-01", "2026-01-01"), null, "366 días");
  assert.equal(validarPeriodo("2025-01-01", "2025-12-31"), null);
  assert.deepEqual(mesDe("2026-02-14"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.deepEqual(mesDe("2028-02-03"), { desde: "2028-02-01", hasta: "2028-02-29" });
  assert.deepEqual(mesDe("2026-12-31"), { desde: "2026-12-01", hasta: "2026-12-31" });
});
test("totales: el reverso anula el gasto; efectivo separado para la caja (O02)", () => {
  const r = resumirGastos([
    { montoCentavos: 1000000n, categoriaId: "alquiler", medioPago: "TRANSFERENCIA" },
    { montoCentavos: 25050n, categoriaId: "limpieza", medioPago: "EFECTIVO" },
    { montoCentavos: 9900n, categoriaId: "limpieza", medioPago: "EFECTIVO" },
    { montoCentavos: -9900n, categoriaId: "limpieza", medioPago: "EFECTIVO" },
  ]);
  assert.equal(r.total, 1025050n);
  assert.equal(r.efectivo, 25050n);
  assert.deepEqual([...r.porCategoria], [["alquiler", 1000000n], ["limpieza", 25050n]]);
  const soloAnulado = resumirGastos([{ montoCentavos: 500n, categoriaId: "x", medioPago: "OTRO" }, { montoCentavos: -500n, categoriaId: "x", medioPago: "OTRO" }]);
  assert.deepEqual([soloAnulado.total, soloAnulado.porCategoria.size, soloAnulado.porMedio.size], [0n, 0, 0]);
  assert.equal(afectaCajaEfectivo("EFECTIVO"), true);
  assert.equal(afectaCajaEfectivo("MERCADO_PAGO"), false);
});

const sedes: Record<string, string> = { centro: "franA", norte: "franA", sur: "franB" };
const de = (id: string) => sedes[id];
const master: Asignacion = { rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION", franquiciadoId: null, sedeId: null };
const franA: Asignacion = { rol: "FRANQUICIADO", alcance: "FRANQUICIADO", franquiciadoId: "franA", sedeId: null };
const admin: Asignacion = { rol: "ADMIN_SEDE", alcance: "SEDE", franquiciadoId: null, sedeId: "centro" };
const recepcion: Asignacion = { rol: "RECEPCIONISTA", alcance: "SEDE", franquiciadoId: null, sedeId: "centro" };

test("permisos de gastos por rol; recepción y profesional sin acceso", () => {
  for (const p of ["gasto:leer", "gasto:registrar", "gasto:anular", "gasto:categorias"] as const) {
    assert.equal(tienePermiso(master, p), true);
    assert.equal(tienePermiso(franA, p), true);
    assert.equal(tienePermiso(admin, p), true);
    assert.equal(tienePermiso(recepcion, p), false);
    assert.equal(tienePermiso({ rol: "PROFESIONAL", alcance: "PROPIO", franquiciadoId: null, sedeId: null }, p), false);
  }
  assert.equal(tienePermiso({ ...admin, alcance: "ORGANIZACION", sedeId: null }, "gasto:leer"), false, "alcance inválido");
});
test("categorías: globales solo con alcance de organización, locales dentro del alcance", () => {
  assert.equal(puedeAdministrarCategoriaGasto([master], null, de), true);
  assert.equal(puedeAdministrarCategoriaGasto([franA], null, de), false);
  assert.equal(puedeAdministrarCategoriaGasto([admin], null, de), false);
  assert.equal(puedeAdministrarCategoriaGasto([franA], "norte", de), true);
  assert.equal(puedeAdministrarCategoriaGasto([franA], "sur", de), false, "sede de otro franquiciado");
  assert.equal(puedeAdministrarCategoriaGasto([admin], "centro", de), true);
  assert.equal(puedeAdministrarCategoriaGasto([admin], "norte", de), false);
  assert.equal(puedeAdministrarCategoriaGasto([recepcion], "centro", de), false);
  assert.equal(puedeAdministrarCategoriaGasto([master], "inexistente", de), false);
  assert.equal(categoriaAplicaASede({ sedeId: null }, "centro"), true);
  assert.equal(categoriaAplicaASede({ sedeId: "centro" }, "centro"), true);
  assert.equal(categoriaAplicaASede({ sedeId: "norte" }, "centro"), false);
});
