import { ABREVIATURAS, type TipoMovimiento, type UnidadMedida } from "@nailnet/domain/stock";

export const UNIDADES_ETIQUETA: Record<UnidadMedida, string> = { UNIDAD: "Unidades", MILILITRO: "Mililitros (ml)", LITRO: "Litros (l)", GRAMO: "Gramos (g)", KILOGRAMO: "Kilogramos (kg)" };
export const TIPOS_MOVIMIENTO: Record<TipoMovimiento, string> = {
  COMPRA: "Compra", CONSUMO_INTERNO: "Consumo interno", AJUSTE: "Ajuste de inventario", VENTA: "Venta",
  TRANSFERENCIA_SALIDA: "Transferencia enviada", TRANSFERENCIA_ENTRADA: "Transferencia recibida", REVERSO: "Reverso",
};

/** «1234.5» → «1.234,5 ml». Solo presentación: el valor exacto viene como cadena del repositorio. */
export function cantidad(valor: string, unidad: UnidadMedida, signo = false) {
  const negativo = valor.startsWith("-");
  const [entero, fraccion] = (negativo ? valor.slice(1) : valor).split(".");
  const texto = BigInt(entero!).toLocaleString("es-AR") + (fraccion ? `,${fraccion}` : "");
  return `${negativo ? "−" : signo ? "+" : ""}${texto} ${ABREVIATURAS[unidad]}`;
}
export const pesos = (v: string | null) => v === null ? "—" : `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const hoy = (timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
export const fechaHora = (d: Date, timezone: string) => new Intl.DateTimeFormat("es-AR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(d);
