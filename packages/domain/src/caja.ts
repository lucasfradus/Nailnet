// O02 · Caja y cierres. Reglas puras: signo de cada movimiento, efectivo esperado, diferencia del
// cierre y resumen. Importes en centavos (bigint). Ver docs/27-ventas-caja.md.
import { aCentavos } from "./catalogo.ts";
import { normalizarTexto } from "./gastos.ts";

/**
 * Movimientos de efectivo de la caja física:
 * - INGRESO_COBRO: cobro en efectivo de una venta (+).
 * - EGRESO_GASTO: gasto pagado en efectivo con la caja (−).
 * - ENTRADA / SALIDA: movimiento manual con motivo (cambio, retiro para depositar, etc.).
 * - REVERSO: contra-movimiento de otro, con motivo; se registra en la caja abierta al momento de revertir.
 * Los cobros con tarjeta, transferencia o Mercado Pago no son movimientos de caja.
 */
export const TIPOS_MOVIMIENTO_CAJA = ["INGRESO_COBRO", "EGRESO_GASTO", "ENTRADA", "SALIDA", "REVERSO"] as const;
export type TipoMovimientoCaja = (typeof TIPOS_MOVIMIENTO_CAJA)[number];

export function signoValidoCaja(tipo: TipoMovimientoCaja, monto: bigint): boolean {
  if (monto === 0n) return false;
  switch (tipo) {
    case "INGRESO_COBRO": case "ENTRADA": return monto > 0n;
    case "EGRESO_GASTO": case "SALIDA": return monto < 0n;
    case "REVERSO": return true;
    default: return false;
  }
}

/** Desde la pantalla de caja solo se revierten los movimientos manuales; cobros y gastos se anulan desde su módulo. */
export function revertibleDesdeCaja(tipo: TipoMovimientoCaja): boolean {
  return tipo === "ENTRADA" || tipo === "SALIDA";
}

/** Efectivo esperado = inicial + suma de movimientos (ingresos positivos, egresos y reversos con su signo). */
export function efectivoEsperado(inicial: bigint, movimientos: readonly { monto: bigint }[]): bigint {
  return movimientos.reduce((s, m) => s + m.monto, inicial);
}

/** Diferencia del arqueo: contado − esperado. Positiva = sobrante; negativa = faltante. */
export function diferenciaArqueo(contado: bigint, esperado: bigint): bigint {
  return contado - esperado;
}

/** ¿El movimiento deja la caja con efectivo negativo? Un retiro o un gasto no pueden sacar lo que no hay. */
export function dejaNegativo(esperado: bigint, monto: bigint): boolean {
  return esperado + monto < 0n;
}

/** Importe de apertura o de conteo: cero o positivo, hasta 2 decimales. */
export function importeNoNegativo(texto: string | null | undefined): bigint | null {
  const t = (texto ?? "").trim();
  return t ? aCentavos(t) : null;
}

export function validarManual(tipo: string, monto: string, motivo: string): { error: string } | { tipo: "ENTRADA" | "SALIDA"; monto: bigint; motivo: string } {
  if (tipo !== "ENTRADA" && tipo !== "SALIDA") return { error: "Tipo de movimiento inválido" };
  const c = aCentavos(monto ?? "");
  if (c === null || c <= 0n) return { error: "Monto inválido: mayor a cero, con hasta 2 decimales" };
  const m = normalizarTexto(motivo);
  if (m.length < 5 || m.length > 300) return { error: "Indicá el motivo (de 5 a 300 caracteres)" };
  return { tipo, monto: tipo === "SALIDA" ? -c : c, motivo: m };
}

/** Resumen de una caja por tipo de movimiento, para la pantalla y el cierre. */
export function resumirCaja(inicial: bigint, movimientos: readonly { tipo: TipoMovimientoCaja; monto: bigint }[]) {
  const porTipo = new Map<TipoMovimientoCaja, bigint>(TIPOS_MOVIMIENTO_CAJA.map(t => [t, 0n]));
  for (const m of movimientos) porTipo.set(m.tipo, porTipo.get(m.tipo)! + m.monto);
  return { inicial, porTipo, esperado: efectivoEsperado(inicial, movimientos) };
}
