// L03 · Reportes. Funciones puras: prorrateo de descuentos, tasas y CSV. Ver docs/29-reportes.md.
import { importe } from "./catalogo.ts";

/**
 * Reparte el descuento de una venta entre sus líneas en proporción a su subtotal. La suma da exacta:
 * los centavos que sobran del redondeo van a las líneas con mayor resto (a igual resto, la primera).
 */
export function prorratearDescuento(subtotales: readonly bigint[], descuento: bigint): bigint[] {
  const total = subtotales.reduce((a, b) => a + b, 0n);
  if (total <= 0n || descuento === 0n) return subtotales.map(() => 0n);
  const partes = subtotales.map(s => (s * descuento) / total);
  let resto = descuento - partes.reduce((a, b) => a + b, 0n);
  const orden = subtotales.map((s, i) => ({ i, r: (s * descuento) % total })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of orden) {
    if (resto === 0n) break;
    partes[i]! += 1n;
    resto -= 1n;
  }
  return partes;
}

/** Porcentaje con un decimal; null si no hay denominador (se muestra «—», no 0 %). */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((1000 * parte) / total) / 10 : null;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────
// Pensado para abrirse con doble clic en Excel con configuración regional argentina: separador «;»,
// coma decimal y BOM UTF-8 para que respete los acentos.

export type Celda = string | number | bigint | null;

// Un texto que empieza así puede ejecutarse como fórmula al abrir el archivo (inyección CSV).
const FORMULA = /^[=+\-@\t\r]/;

/** Dinero en centavos → «1234,50». */
export const pesosCsv = (centavos: bigint) => importe(centavos).replace(".", ",");

export function celdaCsv(valor: Celda): string {
  let t = valor === null ? "" : typeof valor === "bigint" ? pesosCsv(valor) : typeof valor === "number" ? String(valor).replace(".", ",") : valor;
  if (typeof valor === "string" && FORMULA.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function aCsv(encabezados: readonly string[], filas: readonly (readonly Celda[])[]): string {
  return "﻿" + [encabezados, ...filas].map(f => f.map(celdaCsv).join(";")).join("\r\n") + "\r\n";
}
