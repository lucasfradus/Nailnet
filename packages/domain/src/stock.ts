// Stock (O03). Reglas puras: cantidades exactas en milésimas de la unidad (bigint), nunca Number.
// En la base son Decimal(14,3); hacia afuera, cadenas «1.5» (sin ceros de más).

export type UnidadMedida = "UNIDAD" | "MILILITRO" | "LITRO" | "GRAMO" | "KILOGRAMO";
export const UNIDADES: readonly UnidadMedida[] = ["UNIDAD", "MILILITRO", "LITRO", "GRAMO", "KILOGRAMO"];
export const ABREVIATURAS: Record<UnidadMedida, string> = { UNIDAD: "u.", MILILITRO: "ml", LITRO: "l", GRAMO: "g", KILOGRAMO: "kg" };

export type TipoMovimiento = "COMPRA" | "CONSUMO_INTERNO" | "AJUSTE" | "VENTA" | "TRANSFERENCIA_SALIDA" | "TRANSFERENCIA_ENTRADA" | "REVERSO";

/** Tope de una cantidad cargada a mano: 999.999.999,999 de la unidad (cabe holgado en Decimal(14,3)). */
export const CANTIDAD_MAXIMA = 999_999_999_999n;
const CANTIDAD = /^\d{1,9}([.,]\d{1,3})?$/;

/** «1,5» o «1.5» → 1500n. Hasta 3 decimales; sin signo ni separador de miles. null si no es válida. */
export function aMilesimas(texto: string): bigint | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!CANTIDAD.test(t)) return null;
  const [entero, decimales = ""] = t.replace(",", ".").split(".");
  return BigInt(entero!) * 1000n + BigInt((decimales + "000").slice(0, 3));
}

/** Decimal de la base (siempre con 3 decimales vía toFixed(3), puede ser negativo) → milésimas. */
export function desdeDecimal(texto: string): bigint {
  const negativo = texto.startsWith("-");
  const [entero, decimales = ""] = (negativo ? texto.slice(1) : texto).split(".");
  if (!/^\d+$/.test(entero!) || !/^\d{0,3}$/.test(decimales)) throw new Error(`Cantidad inválida: ${texto}`);
  const valor = BigInt(entero!) * 1000n + BigInt((decimales + "000").slice(0, 3));
  return negativo ? -valor : valor;
}

/** Milésimas → «1.5», «-0.25», «3». Para escribir en la base usar decimal(). */
export function cantidadTexto(milesimas: bigint): string {
  const signo = milesimas < 0n ? "-" : "";
  const abs = milesimas < 0n ? -milesimas : milesimas;
  const fraccion = (abs % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${signo}${abs / 1000n}${fraccion ? "." + fraccion : ""}`;
}
/** Milésimas → «1.500», el formato exacto que se guarda en Decimal(14,3). */
export function decimal(milesimas: bigint): string {
  const signo = milesimas < 0n ? "-" : "";
  const abs = milesimas < 0n ? -milesimas : milesimas;
  return `${signo}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, "0")}`;
}

/** Cantidad positiva cargada en un formulario. */
export function validarCantidad(milesimas: bigint | null): string | null {
  if (milesimas === null) return "Cantidad inválida: hasta 3 decimales, sin separador de miles";
  if (milesimas <= 0n) return "La cantidad tiene que ser mayor a cero";
  if (milesimas > CANTIDAD_MAXIMA) return "Cantidad demasiado grande";
  return null;
}

/** Signo que exige cada tipo de movimiento. AJUSTE y REVERSO pueden ir en cualquier sentido. */
export function signoValido(tipo: TipoMovimiento, cantidad: bigint): boolean {
  if (cantidad === 0n) return false;
  switch (tipo) {
    case "COMPRA": case "TRANSFERENCIA_ENTRADA": return cantidad > 0n;
    case "CONSUMO_INTERNO": case "VENTA": case "TRANSFERENCIA_SALIDA": return cantidad < 0n;
    case "AJUSTE": case "REVERSO": return true;
    default: return false;
  }
}

/** Movimientos que se corrigen con un reverso. Ventas y transferencias se corrigen por su propio circuito. */
export function reversible(tipo: TipoMovimiento): boolean {
  return tipo === "COMPRA" || tipo === "CONSUMO_INTERNO" || tipo === "AJUSTE";
}

export class StockInsuficiente extends Error {
  constructor(readonly productoId: string, readonly sedeId: string, readonly disponible: bigint, readonly pedido: bigint) {
    super("No hay stock suficiente"); this.name = "StockInsuficiente";
  }
}

export type Delta = { sedeId: string; productoId: string; cantidad: bigint };
const clave = (sedeId: string, productoId: string) => `${sedeId}|${productoId}`;

/**
 * Aplica en orden los movimientos sobre los saldos actuales y devuelve el saldo resultante de cada
 * uno. Si algún saldo quedaría negativo lanza StockInsuficiente y no aplica nada: todo o nada.
 * Un mismo producto puede repetirse (p. ej. dos ítems de una venta): se acumula.
 */
export function aplicarDeltas(saldos: ReadonlyMap<string, bigint>, deltas: readonly Delta[]): { saldos: Map<string, bigint>; resultantes: bigint[] } {
  const nuevos = new Map(saldos);
  const resultantes: bigint[] = [];
  for (const d of deltas) {
    const k = clave(d.sedeId, d.productoId);
    const actual = nuevos.get(k) ?? 0n;
    const saldo = actual + d.cantidad;
    if (saldo < 0n) throw new StockInsuficiente(d.productoId, d.sedeId, actual, -d.cantidad);
    nuevos.set(k, saldo);
    resultantes.push(saldo);
  }
  return { saldos: nuevos, resultantes };
}
export { clave as claveSaldo };

/** Diferencia de un ajuste por conteo físico: lo contado menos lo registrado. */
export function deltaAjuste(registrado: bigint, contado: bigint): bigint {
  return contado - registrado;
}

/** Subtotal de un ítem de compra en centavos: cantidad (milésimas) × costo unitario, al centavo, mitad hacia arriba. */
export function subtotalCentavos(milesimas: bigint, costoUnitarioCentavos: bigint): bigint {
  return (milesimas * costoUnitarioCentavos + 500n) / 1000n;
}

export function validarMotivo(motivo: string | null | undefined, obligatorio: boolean): string | null {
  const m = motivo?.trim() ?? "";
  if (!m) return obligatorio ? "Indicá el motivo" : null;
  return m.length > 300 ? "El motivo admite hasta 300 caracteres" : null;
}
