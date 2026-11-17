// D22 · Precios por medio de pago (doc 32). Reglas puras: el ajuste de cada medio sobre el precio de
// lista, el redondeo de la sede y la validación de los medios. Importes en centavos y porcentajes en
// centésimas de punto (bigint, nunca Number): −10% = −1000n.
import { MEDIOS_COBRO, calcularVenta, type LineaVenta, type MedioCobro, type TotalesVenta } from "./ventas.ts";
import { normalizarTexto } from "./gastos.ts";

export const TIPO_MEDIO_ETIQUETA: Record<MedioCobro, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA_DEBITO: "Tarjeta de débito",
  TARJETA_CREDITO: "Tarjeta de crédito", MERCADO_PAGO: "Mercado Pago", OTRO: "Otro",
};

/** Ajuste admitido: de −90% a +100% (en centésimas de punto). */
export const AJUSTE_MIN = -9000n, AJUSTE_MAX = 10000n;
export const MAX_NOMBRE_MEDIO = 40;
export const MAX_MEDIOS_SEDE = 20;

// ─── Redondeo ─────────────────────────────────────────────────────────────────

/** Múltiplos en pesos (0 = sin redondeo: al centavo). */
export const PASOS_REDONDEO = [0, 10, 50, 100, 500, 1000] as const;
export type PasoRedondeo = (typeof PASOS_REDONDEO)[number];
export const SENTIDOS_REDONDEO = ["ABAJO", "CERCANO", "ARRIBA"] as const;
export type SentidoRedondeo = (typeof SENTIDOS_REDONDEO)[number];
export type Redondeo = { paso: PasoRedondeo; sentido: SentidoRedondeo };
export const SENTIDO_ETIQUETA: Record<SentidoRedondeo, string> = { ABAJO: "hacia abajo", CERCANO: "al más cercano", ARRIBA: "hacia arriba" };

/** Confirmado por el usuario el 2026-11-16: por defecto, a $100 hacia abajo (nunca cobra más que el porcentaje anunciado). */
export const REDONDEO_POR_DEFECTO: Redondeo = { paso: 100, sentido: "ABAJO" };

/** Redondeo efectivo de la sede: lo que no está definido toma el valor por defecto. */
export function redondeoDe(paso: number | null | undefined, sentido: string | null | undefined): Redondeo {
  return {
    paso: (PASOS_REDONDEO as readonly number[]).includes(paso ?? -1) ? paso as PasoRedondeo : REDONDEO_POR_DEFECTO.paso,
    sentido: (SENTIDOS_REDONDEO as readonly string[]).includes(sentido ?? "") ? sentido as SentidoRedondeo : REDONDEO_POR_DEFECTO.sentido,
  };
}

export function validarRedondeo(paso: string, sentido: string): { error: string } | { redondeo: Redondeo } {
  const p = Number(paso);
  if (!/^\d+$/.test(paso.trim()) || !(PASOS_REDONDEO as readonly number[]).includes(p)) return { error: "Redondeo inválido" };
  if (!(SENTIDOS_REDONDEO as readonly string[]).includes(sentido)) return { error: "Sentido del redondeo inválido" };
  return { redondeo: { paso: p as PasoRedondeo, sentido: sentido as SentidoRedondeo } };
}

/** «a $100 hacia abajo» o «sin redondeo». */
export function textoRedondeo(r: Redondeo): string {
  return r.paso === 0 ? "sin redondeo (al centavo)" : `a $${r.paso.toLocaleString("es-AR")} ${SENTIDO_ETIQUETA[r.sentido]}`;
}

/** num / den redondeado según el sentido. num y den positivos. */
function dividir(num: bigint, den: bigint, sentido: SentidoRedondeo): bigint {
  const q = num / den, r = num % den;
  if (r === 0n || sentido === "ABAJO") return q;
  if (sentido === "ARRIBA") return q + 1n;
  return r * 2n >= den ? q + 1n : q;
}

/**
 * Precio de un ítem con el ajuste del medio: lista × (1 + ajuste), redondeado al paso de la sede. Sin
 * ajuste se cobra la lista tal cual, sin redondear. Sin paso (0) el resultado queda al centavo, mitad
 * hacia arriba. Ejemplo del doc 32: $15.500 con −10% y $100 hacia abajo → $13.900.
 */
export function precioConAjuste(lista: bigint, ajuste: bigint, redondeo: Redondeo): bigint {
  if (ajuste === 0n || lista <= 0n) return lista;
  const num = lista * (10000n + ajuste);
  if (redondeo.paso === 0) return dividir(num, 10000n, "CERCANO");
  const paso = BigInt(redondeo.paso) * 100n;
  return dividir(num, 10000n * paso, redondeo.sentido) * paso;
}

// ─── Porcentaje ───────────────────────────────────────────────────────────────

const PORCENTAJE = /^[-+−]?\d{1,3}([.,]\d{1,2})?$/;

/** «−10», «-10», «10,5», «+15» → centésimas de punto. Vacío = 0. null si es inválido. */
export function aAjuste(texto: string | null | undefined): bigint | null {
  const t = (texto ?? "").trim().replace(/\s|%/g, "");
  if (!t) return 0n;
  if (!PORCENTAJE.test(t)) return null;
  const negativo = t.startsWith("-") || t.startsWith("−");
  const [entero, dec = ""] = t.replace(/^[-+−]/, "").replace(",", ".").split(".");
  const v = BigInt(entero!) * 100n + BigInt((dec + "00").slice(0, 2));
  return negativo ? -v : v;
}

/** Centésimas de punto → «-10.50» para Decimal(5,2). */
export function ajusteDecimal(ajuste: bigint): string {
  const abs = ajuste < 0n ? -ajuste : ajuste;
  return `${ajuste < 0n ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** «−10 %», «+15,5 %» o «lista». */
export function textoAjuste(ajuste: bigint): string {
  if (ajuste === 0n) return "lista";
  const abs = ajuste < 0n ? -ajuste : ajuste;
  const dec = abs % 100n;
  const num = `${abs / 100n}${dec ? `,${dec.toString().padStart(2, "0").replace(/0$/, "")}` : ""}`;
  return `${ajuste < 0n ? "−" : "+"}${num} %`;
}

/** Para mostrar el ajuste en un campo editable: «-10», «15,5» o «0». */
export function ajusteEditable(ajuste: bigint): string {
  const abs = ajuste < 0n ? -ajuste : ajuste;
  const dec = abs % 100n;
  return `${ajuste < 0n ? "-" : ""}${abs / 100n}${dec ? `,${dec.toString().padStart(2, "0").replace(/0$/, "")}` : ""}`;
}

// ─── Medio de la sede ─────────────────────────────────────────────────────────

export type MedioEntrada = { nombre: string; tipo?: string; ajuste: string; habilitado: boolean };
export type MedioValidado = { nombre: string; tipo?: MedioCobro; ajuste: bigint; habilitado: boolean };

/** Valida un medio. El tipo solo se pide al crearlo: después no cambia. */
export function validarMedio(m: MedioEntrada, alta: boolean): { error: string } | { medio: MedioValidado } {
  const nombre = normalizarTexto(m.nombre);
  if (!nombre || nombre.length > MAX_NOMBRE_MEDIO) return { error: `El nombre del medio tiene de 1 a ${MAX_NOMBRE_MEDIO} caracteres` };
  if (alta && !(MEDIOS_COBRO as readonly string[]).includes(m.tipo ?? "")) return { error: "Elegí el tipo del medio" };
  const ajuste = aAjuste(m.ajuste);
  if (ajuste === null) return { error: `«${nombre}»: el ajuste es un porcentaje con hasta 2 decimales (por ejemplo −10)` };
  if (ajuste < AJUSTE_MIN || ajuste > AJUSTE_MAX) return { error: `«${nombre}»: el ajuste va de −90 % a +100 %` };
  return { medio: { nombre, tipo: alta ? m.tipo as MedioCobro : undefined, ajuste, habilitado: m.habilitado } };
}

/** El primer nombre repetido (sin distinguir mayúsculas), o null. */
export function nombreRepetido(nombres: readonly string[]): string | null {
  const vistos = new Set<string>();
  for (const n of nombres) {
    const k = n.toLocaleLowerCase("es-AR");
    if (vistos.has(k)) return n;
    vistos.add(k);
  }
  return null;
}

// ─── Venta con el precio de un medio (etapa 2) ────────────────────────────────

/**
 * Línea de la comanda antes de elegir el medio: cantidad en milésimas, precio de lista (null si el
 * servicio no tiene) y, si recepción lo editó, el precio cobrado (la excepción, que no se ajusta).
 */
export type LineaPrecio = { cantidad: bigint; lista: bigint | null; editado: bigint | null };

/** Precio de cada línea con el medio: el editado si lo hay; si no, la lista con el ajuste y el redondeo. */
export function preciosConMedio(lineas: readonly LineaPrecio[], ajuste: bigint, redondeo: Redondeo): { error: string } | { lineas: LineaVenta[]; medio: (bigint | null)[] } {
  const medio = lineas.map(l => l.lista === null ? null : precioConAjuste(l.lista, ajuste, redondeo));
  const resultado: LineaVenta[] = [];
  for (const [i, l] of lineas.entries()) {
    const precio = l.editado ?? medio[i];
    if (precio === null || precio === undefined) return { error: "Un servicio no tiene precio de lista en la sede: indicá el precio cobrado" };
    resultado.push({ cantidad: l.cantidad, precioUnitario: precio });
  }
  return { lineas: resultado, medio };
}

/**
 * Totales de la venta si se paga con un medio (doc 32): primero el ajuste del medio en cada ítem,
 * después el descuento manual y al final la seña, que se calculó sobre la lista. Lo usan la pantalla
 * (los totales de «¿Cómo paga?») y el repositorio, así los números coinciden.
 */
export function totalesConMedio(lineas: readonly LineaPrecio[], ajuste: bigint, redondeo: Redondeo, descuento: bigint, anticipo: bigint): { error: string } | TotalesVenta {
  const p = preciosConMedio(lineas, ajuste, redondeo);
  return "error" in p ? p : calcularVenta(p.lineas, descuento, anticipo);
}

// ─── Portal (etapa 3) ─────────────────────────────────────────────────────────

/**
 * Precios con descuento que muestra el portal además de la lista (doc 32, etapa 3): uno por precio
 * distinto, con los medios que lo dan, en el orden de la sede. Los recargos no se muestran para no
 * confundir, y un precio igual a la lista tampoco. Ejemplo: lista $15.500 con efectivo y transferencia
 * en −10 % → [{ precio: $13.900, medios: ["Efectivo", "Transferencia"] }].
 */
export function preciosPortal(lista: bigint, medios: readonly { nombre: string; ajuste: bigint }[], redondeo: Redondeo): { precio: bigint; medios: string[] }[] {
  const grupos = new Map<bigint, string[]>();
  for (const m of medios) {
    if (m.ajuste >= 0n) continue;
    const precio = precioConAjuste(lista, m.ajuste, redondeo);
    if (precio === lista) continue;
    grupos.set(precio, [...(grupos.get(precio) ?? []), m.nombre]);
  }
  return [...grupos].map(([precio, nombres]) => ({ precio, medios: nombres }));
}
