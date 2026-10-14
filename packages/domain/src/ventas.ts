// O01 · Cobros manuales y ventas mixtas. Reglas puras: totales de la venta con descuento y anticipo,
// saldo, validación de cobros y estado. Importes en centavos (bigint), nunca Number. Ver docs/27-ventas-caja.md.
import { aCentavos } from "./catalogo.ts";
import { normalizarTexto } from "./gastos.ts";
import { subtotalCentavos } from "./stock.ts";

/** Medios de cobro en recepción. Mismos valores que los medios de pago de gastos. */
export const MEDIOS_COBRO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADO_PAGO", "OTRO"] as const;
export type MedioCobro = (typeof MEDIOS_COBRO)[number];

/** Solo el efectivo entra y sale de la caja física. Tarjetas, transferencias y MP se informan aparte. */
export function esEfectivo(medio: MedioCobro): boolean {
  return medio === "EFECTIVO";
}

export const MAX_ITEMS_VENTA = 50;
export const MAX_COBROS_POR_ALTA = 5;

export type EstadoVenta = "PENDIENTE" | "COMPLETADA" | "ANULADA";

/** Línea de la venta: cantidad en milésimas (1 servicio = 1000) y precio unitario en centavos. */
export type LineaVenta = { cantidad: bigint; precioUnitario: bigint };

export type TotalesVenta = { subtotal: bigint; descuento: bigint; total: bigint; anticipo: bigint; aCobrar: bigint };

/**
 * Totales de una venta nueva. El subtotal de cada línea es cantidad × precio, al centavo (mitad hacia
 * arriba, igual que las compras). El descuento es un importe sobre el subtotal. El anticipo (seña ya
 * cobrada por Mercado Pago) se descuenta de lo que falta cobrar, nunca del total: la venta vale su total
 * y la seña es uno de sus cobros. Ejemplo M03: 30.000 − 0 de descuento, anticipo 9.000 → a cobrar 21.000.
 */
export function calcularVenta(lineas: readonly LineaVenta[], descuento: bigint, anticipo: bigint): { error: string } | TotalesVenta {
  if (!lineas.length) return { error: "La venta no tiene ítems" };
  if (lineas.length > MAX_ITEMS_VENTA) return { error: `Hasta ${MAX_ITEMS_VENTA} ítems por venta` };
  if (lineas.some(l => l.cantidad <= 0n || l.precioUnitario < 0n)) return { error: "Ítem inválido" };
  const subtotal = lineas.reduce((s, l) => s + subtotalCentavos(l.cantidad, l.precioUnitario), 0n);
  if (descuento < 0n) return { error: "Descuento inválido" };
  if (descuento > subtotal) return { error: "El descuento no puede superar el subtotal" };
  const total = subtotal - descuento;
  if (anticipo < 0n) return { error: "Anticipo inválido" };
  if (anticipo > total) return { error: "La seña cobrada supera el total de la venta: revisá el descuento" };
  return { subtotal, descuento, total, anticipo, aCobrar: total - anticipo };
}

/** Lo que falta cobrar: total − anticipo − cobros netos (los reversos restan). Nunca negativo. */
export function saldoVenta(total: bigint, anticipo: bigint, cobradoNeto: bigint): bigint {
  const saldo = total - anticipo - cobradoNeto;
  return saldo < 0n ? 0n : saldo;
}

/** Una venta está completa cuando anticipo + cobros cubren exactamente el total. */
export function estadoSegunCobros(total: bigint, anticipo: bigint, cobradoNeto: bigint): "PENDIENTE" | "COMPLETADA" {
  return anticipo + cobradoNeto >= total ? "COMPLETADA" : "PENDIENTE";
}

export type CobroEntrada = { medio: string; monto: string; referencia?: string | null };
export type CobroValidado = { medio: MedioCobro; monto: bigint; referencia: string | null };

export function validarCobro(c: CobroEntrada): { error: string } | { cobro: CobroValidado } {
  if (!(MEDIOS_COBRO as readonly string[]).includes(c.medio)) return { error: "Medio de cobro inválido" };
  const monto = aCentavos(c.monto ?? "");
  if (monto === null || monto <= 0n) return { error: "Monto del cobro inválido: mayor a cero, con hasta 2 decimales" };
  const referencia = normalizarTexto(c.referencia);
  if (referencia.length > 120) return { error: "La referencia del cobro tiene hasta 120 caracteres" };
  return { cobro: { medio: c.medio as MedioCobro, monto, referencia: referencia || null } };
}

/**
 * Valida varios cobros contra lo que falta cobrar. Cobrar de más se rechaza: no hay vuelto registrado
 * en el sistema (el vuelto en efectivo se resuelve en el mostrador cobrando el importe exacto).
 */
export function validarCobros(cobros: readonly CobroEntrada[], saldo: bigint): { error: string } | { cobros: CobroValidado[]; total: bigint } {
  if (cobros.length > MAX_COBROS_POR_ALTA) return { error: `Hasta ${MAX_COBROS_POR_ALTA} cobros a la vez` };
  const validos: CobroValidado[] = [];
  for (const c of cobros) {
    const v = validarCobro(c);
    if ("error" in v) return v;
    validos.push(v.cobro);
  }
  const total = validos.reduce((s, c) => s + c.monto, 0n);
  if (total > saldo) return { error: `Se intenta cobrar más de lo que falta (${formatoPesos(saldo)})` };
  return { cobros: validos, total };
}

/** Descuento opcional: vacío = 0. */
export function descuentoDe(texto: string | null | undefined): bigint | null {
  const t = (texto ?? "").trim();
  if (!t) return 0n;
  return aCentavos(t);
}

/** «$ 21.000,00» para mensajes. Sin Number. */
export function formatoPesos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const entero = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "−" : ""}$ ${entero},${(abs % 100n).toString().padStart(2, "0")}`;
}

export type CobroResumen = { medio: MedioCobro; monto: bigint };

/**
 * Resumen de cobros de un conjunto de ventas (o de una caja): neto por medio, efectivo y no efectivo.
 * Los reversos ya vienen con monto negativo. El anticipo no es un cobro de recepción y no entra aquí.
 */
export function resumirCobros(cobros: readonly CobroResumen[]) {
  const porMedio = new Map<MedioCobro, bigint>();
  let efectivo = 0n, otros = 0n;
  for (const c of cobros) {
    porMedio.set(c.medio, (porMedio.get(c.medio) ?? 0n) + c.monto);
    if (esEfectivo(c.medio)) efectivo += c.monto; else otros += c.monto;
  }
  return { porMedio: new Map([...porMedio].filter(([, v]) => v !== 0n)), efectivo, otros, total: efectivo + otros };
}

export function validarMotivo(motivo: string): { error: string } | { motivo: string } {
  const m = normalizarTexto(motivo);
  return m.length >= 5 && m.length <= 500 ? { motivo: m } : { error: "Indicá el motivo (de 5 a 500 caracteres)" };
}

/** Clave de idempotencia del formulario: 16 a 64 caracteres seguros (un UUID la cumple). */
export function claveValida(clave: string | null | undefined): boolean {
  return typeof clave === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(clave);
}
