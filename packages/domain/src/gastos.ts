// O04 · Gastos de sede. Reglas puras: validación del alta, del período y de la anulación, totales y
// alcance de las categorías. Importes en centavos (bigint), nunca Number. Ver docs/25-gastos.md.
import { cubreSede, tienePermiso, type Asignacion, type FranquiciadoDeSede } from "./access.ts";
import { validarFecha } from "./agenda.ts";
import { aCentavos } from "./catalogo.ts";

export const MEDIOS_PAGO_GASTO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADO_PAGO", "OTRO"] as const;
export type MedioPagoGasto = (typeof MEDIOS_PAGO_GASTO)[number];

/**
 * ¿El gasto sale del efectivo de la sede? Cuando exista la caja (O02), estos gastos (y sus reversos)
 * generarán un egreso de caja. Los demás medios no tocan el efectivo esperado.
 */
export function afectaCajaEfectivo(medio: MedioPagoGasto): boolean {
  return medio === "EFECTIVO";
}

/** Cuántos días hacia atrás se acepta registrar un gasto. La carga histórica masiva sería una importación aparte. */
export const DIAS_ATRAS_MAXIMO = 366;
/** Rango máximo de un listado (inclusivo). */
export const DIAS_PERIODO_MAXIMO = 366;

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
export const sumarDias = (fecha: string, n: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function normalizarTexto(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
}

export type AltaGasto = { fecha: string; monto: string; medioPago: string; descripcion: string; comprobante?: string | null };
export type GastoValidado = { fecha: string; montoCentavos: bigint; medioPago: MedioPagoGasto; descripcion: string; comprobante: string | null };

/**
 * Valida el alta de un gasto. `hoy` es la fecha local de la sede: un gasto no puede tener fecha futura
 * ni más de DIAS_ATRAS_MAXIMO días de antigüedad. El monto es positivo, en pesos con hasta 2 decimales.
 */
export function validarGasto(datos: AltaGasto, hoy: string): { error: string } | { gasto: GastoValidado } {
  if (!validarFecha(datos.fecha)) return { error: "Fecha inválida" };
  if (datos.fecha > hoy) return { error: "La fecha del gasto no puede ser futura" };
  if (dias(datos.fecha, hoy) > DIAS_ATRAS_MAXIMO) return { error: `La fecha del gasto no puede tener más de ${DIAS_ATRAS_MAXIMO} días` };
  const montoCentavos = aCentavos(datos.monto ?? "");
  if (montoCentavos === null || montoCentavos <= 0n) return { error: "Monto inválido: mayor a cero, con hasta 2 decimales" };
  if (!(MEDIOS_PAGO_GASTO as readonly string[]).includes(datos.medioPago)) return { error: "Medio de pago inválido" };
  const descripcion = normalizarTexto(datos.descripcion);
  if (descripcion.length < 3 || descripcion.length > 500) return { error: "La descripción va de 3 a 500 caracteres" };
  const comprobante = normalizarTexto(datos.comprobante);
  if (comprobante.length > 120) return { error: "La referencia del comprobante tiene hasta 120 caracteres" };
  return { gasto: { fecha: datos.fecha, montoCentavos, medioPago: datos.medioPago as MedioPagoGasto, descripcion, comprobante: comprobante || null } };
}

/** La anulación exige un motivo legible: queda en el reverso para siempre. */
export function validarMotivoAnulacion(motivo: string): { error: string } | { motivo: string } {
  const m = normalizarTexto(motivo);
  return m.length >= 5 && m.length <= 500 ? { motivo: m } : { error: "Indicá el motivo de la anulación (de 5 a 500 caracteres)" };
}

export function validarNombreCategoria(nombre: string): { error: string } | { nombre: string } {
  const n = normalizarTexto(nombre);
  return n.length >= 1 && n.length <= 60 ? { nombre: n } : { error: "Nombre inválido: entre 1 y 60 caracteres" };
}

/** Período inclusivo por fecha local. */
export function validarPeriodo(desde: string, hasta: string): string | null {
  if (!validarFecha(desde) || !validarFecha(hasta)) return "Período inválido";
  if (desde > hasta) return "El período empieza después de terminar";
  if (dias(desde, hasta) + 1 > DIAS_PERIODO_MAXIMO) return `El período puede abarcar hasta ${DIAS_PERIODO_MAXIMO} días`;
  return null;
}

/** Mes calendario que contiene la fecha local indicada. */
export function mesDe(fecha: string): { desde: string; hasta: string } {
  const [y, m] = fecha.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

export type Movimiento = { montoCentavos: bigint; categoriaId: string; medioPago: MedioPagoGasto };

/**
 * Totales de un período sobre movimientos (gastos positivos y reversos negativos). Un gasto anulado
 * suma cero porque su reverso lleva la misma fecha. `efectivo` es lo que, con O02, saldrá de la caja.
 */
export function resumirGastos(movimientos: readonly Movimiento[]) {
  let total = 0n, efectivo = 0n;
  const porCategoria = new Map<string, bigint>();
  const porMedio = new Map<MedioPagoGasto, bigint>();
  for (const m of movimientos) {
    total += m.montoCentavos;
    if (afectaCajaEfectivo(m.medioPago)) efectivo += m.montoCentavos;
    porCategoria.set(m.categoriaId, (porCategoria.get(m.categoriaId) ?? 0n) + m.montoCentavos);
    porMedio.set(m.medioPago, (porMedio.get(m.medioPago) ?? 0n) + m.montoCentavos);
  }
  const sinCeros = <K>(mapa: Map<K, bigint>) => new Map([...mapa].filter(([, v]) => v !== 0n));
  return { total, efectivo, porCategoria: sinCeros(porCategoria), porMedio: sinCeros(porMedio) };
}

/**
 * Categorías de gasto (alineado a D12): las globales (sedeId null) son de toda la organización y solo
 * las define quien tiene alcance de organización; cada sede puede sumar categorías locales, que
 * administra quien cubre esa sede.
 */
export function puedeAdministrarCategoriaGasto(actores: readonly Asignacion[], sedeId: string | null, franquiciadoDe: FranquiciadoDeSede): boolean {
  return actores.some(a => tienePermiso(a, "gasto:categorias") && (sedeId === null ? a.alcance === "ORGANIZACION" : cubreSede(a, sedeId, franquiciadoDe)));
}

/** Una categoría se puede usar en una sede si es global o local de esa misma sede. */
export function categoriaAplicaASede(categoria: { sedeId: string | null }, sedeId: string): boolean {
  return categoria.sedeId === null || categoria.sedeId === sedeId;
}
