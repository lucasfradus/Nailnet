import { test } from "node:test";
import assert from "node:assert/strict";
import { aAjuste, ajusteDecimal, ajusteEditable, nombreRepetido, precioConAjuste, redondeoDe, textoAjuste, textoRedondeo, validarMedio, validarRedondeo, REDONDEO_POR_DEFECTO } from "../src/medios-pago.ts";
import { validarCobro, validarCobros, type MedioDisponible } from "../src/ventas.ts";

const $ = (pesos: number) => BigInt(pesos) * 100n;

test("precio con ajuste: el ejemplo del doc 32", () => {
  assert.equal(precioConAjuste($(15_500), -1000n, REDONDEO_POR_DEFECTO), $(13_900), "15.500 −10% = 13.950 → 13.900");
  assert.equal(precioConAjuste($(9_000), -1000n, REDONDEO_POR_DEFECTO), $(8_100), "exacto: no se redondea más");
});

test("precio con ajuste: sin ajuste se cobra la lista tal cual, sin redondear", () => {
  assert.equal(precioConAjuste(1_234_567n, 0n, REDONDEO_POR_DEFECTO), 1_234_567n);
  assert.equal(precioConAjuste(0n, -1000n, REDONDEO_POR_DEFECTO), 0n, "cortesía");
});

test("precio con ajuste: sentidos y pasos del redondeo", () => {
  const lista = $(15_500); // −10% = 13.950
  assert.equal(precioConAjuste(lista, -1000n, { paso: 100, sentido: "CERCANO" }), $(14_000), "50 es la mitad: sube");
  assert.equal(precioConAjuste(lista, -1000n, { paso: 100, sentido: "ARRIBA" }), $(14_000));
  assert.equal(precioConAjuste(lista, -1000n, { paso: 500, sentido: "ABAJO" }), $(13_500));
  assert.equal(precioConAjuste(lista, -1000n, { paso: 1000, sentido: "CERCANO" }), $(14_000));
  assert.equal(precioConAjuste(lista, -1000n, { paso: 10, sentido: "ABAJO" }), $(13_950));
  assert.equal(precioConAjuste(1_001n, -1250n, { paso: 0, sentido: "ABAJO" }), 876n, "sin paso: al centavo, mitad hacia arriba (875,875)");
});

test("precio con ajuste: recargo", () => {
  assert.equal(precioConAjuste($(10_000), 1500n, REDONDEO_POR_DEFECTO), $(11_500));
  assert.equal(precioConAjuste($(10_050), 1000n, REDONDEO_POR_DEFECTO), $(11_000), "11.055 → 11.000 hacia abajo");
});

test("redondeo: por defecto $100 hacia abajo, y validación", () => {
  assert.deepEqual(redondeoDe(null, null), { paso: 100, sentido: "ABAJO" });
  assert.deepEqual(redondeoDe(500, "ARRIBA"), { paso: 500, sentido: "ARRIBA" });
  assert.deepEqual(redondeoDe(0, "CERCANO"), { paso: 0, sentido: "CERCANO" }, "0 es sin redondeo, no «sin definir»");
  assert.deepEqual(redondeoDe(7, "X"), { paso: 100, sentido: "ABAJO" });
  assert.deepEqual(validarRedondeo("500", "CERCANO"), { redondeo: { paso: 500, sentido: "CERCANO" } });
  assert.ok("error" in validarRedondeo("7", "ABAJO"));
  assert.ok("error" in validarRedondeo("100", "LATERAL"));
  assert.equal(textoRedondeo({ paso: 1000, sentido: "ABAJO" }), "a $1.000 hacia abajo");
  assert.match(textoRedondeo({ paso: 0, sentido: "ABAJO" }), /sin redondeo/);
});

test("porcentaje: lectura, escritura y texto", () => {
  assert.equal(aAjuste("-10"), -1000n);
  assert.equal(aAjuste("−10 %"), -1000n, "signo menos tipográfico");
  assert.equal(aAjuste("+15,5"), 1550n);
  assert.equal(aAjuste("2.25"), 225n);
  assert.equal(aAjuste(""), 0n);
  assert.equal(aAjuste("10,123"), null);
  assert.equal(aAjuste("1e2"), null);
  assert.equal(aAjuste("--5"), null);
  assert.equal(ajusteDecimal(-1050n), "-10.50");
  assert.equal(ajusteDecimal(5n), "0.05");
  assert.equal(textoAjuste(-1000n), "−10 %");
  assert.equal(textoAjuste(1550n), "+15,5 %");
  assert.equal(textoAjuste(0n), "lista");
  assert.equal(ajusteEditable(-1000n), "-10");
  assert.equal(ajusteEditable(1505n), "15,05");
});

test("medio: nombre, tipo solo al alta y rango del ajuste", () => {
  assert.deepEqual(validarMedio({ nombre: "  Cuenta  DNI ", tipo: "TRANSFERENCIA", ajuste: "-10", habilitado: true }, true),
    { medio: { nombre: "Cuenta DNI", tipo: "TRANSFERENCIA", ajuste: -1000n, habilitado: true } });
  assert.ok("error" in validarMedio({ nombre: "X", tipo: "CHEQUE", ajuste: "0", habilitado: true }, true));
  assert.equal((validarMedio({ nombre: "X", tipo: "CHEQUE", ajuste: "0", habilitado: true }, false) as { medio: { tipo?: string } }).medio.tipo, undefined, "en una edición el tipo no se toca");
  assert.ok("error" in validarMedio({ nombre: "", ajuste: "0", habilitado: true }, false));
  assert.ok("error" in validarMedio({ nombre: "X", ajuste: "-91", habilitado: true }, false));
  assert.ok("error" in validarMedio({ nombre: "X", ajuste: "100,01", habilitado: true }, false));
  assert.ok("medio" in validarMedio({ nombre: "X", ajuste: "100", habilitado: false }, false));
  assert.equal(nombreRepetido(["Efectivo", "Débito", "efectivo"]), "efectivo");
  assert.equal(nombreRepetido(["Efectivo", "Débito"]), null);
});

test("cobro con los medios de la sede: por id, por tipo (compatibilidad) y deshabilitados", () => {
  const medios: MedioDisponible[] = [
    { id: "m-ef", tipo: "EFECTIVO", nombre: "Efectivo" },
    { id: "m-dni", tipo: "TRANSFERENCIA", nombre: "Cuenta DNI" },
    { id: "m-tr", tipo: "TRANSFERENCIA", nombre: "Transferencia" },
  ];
  assert.deepEqual(validarCobro({ medio: "m-tr", monto: "100" }, medios),
    { cobro: { medio: "TRANSFERENCIA", medioPagoId: "m-tr", medioNombre: "Transferencia", monto: 10_000n, referencia: null } });
  assert.equal((validarCobro({ medio: "TRANSFERENCIA", monto: "100" }, medios) as { cobro: { medioPagoId: string } }).cobro.medioPagoId, "m-dni", "por tipo: el primero en orden");
  assert.ok("error" in validarCobro({ medio: "TARJETA_DEBITO", monto: "100" }, medios), "tipo sin medio habilitado");
  assert.ok("error" in validarCobro({ medio: "otro-id", monto: "100" }, medios));
  assert.deepEqual(validarCobro({ medio: "EFECTIVO", monto: "1" }), { cobro: { medio: "EFECTIVO", medioPagoId: null, medioNombre: null, monto: 100n, referencia: null } }, "sin medios: solo el tipo");
  const v = validarCobros([{ medio: "m-ef", monto: "50" }, { medio: "m-dni", monto: "50" }], 10_000n, medios);
  assert.ok("cobros" in v && v.cobros.map(c => c.medioPagoId).join() === "m-ef,m-dni");
});
