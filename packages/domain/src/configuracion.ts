/**
 * Parámetros operativos con herencia organización → sede. Sin valor en ninguno de los dos niveles
 * el parámetro queda SIN_DEFINIR: quien lo usa debe negarse a operar (p. ej. no abrir reservas
 * online) en lugar de suponer un valor. Los valores iniciales siguen pendientes (D18).
 */
export const PARAMETROS = {
  horizonteReservaDias: { etiqueta: "Horizonte de reserva", unidad: "días", min: 1, max: 365, decision: "D18" },
  anticipacionMinimaMinutos: { etiqueta: "Anticipación mínima", unidad: "minutos", min: 0, max: 10_080, decision: "D18" },
  // Cada cuánto se ofrecen inicios de turno desde la medianoche local. Pendiente de definición (D17).
  pasoGrillaMinutos: { etiqueta: "Intervalo entre inicios de turno", unidad: "minutos", min: 5, max: 120, multiplo: 5, decision: "D17" },
} as const;
export type Parametro = keyof typeof PARAMETROS;
export type ValoresConfiguracion = { [K in Parametro]: number | null };
export type Origen = "SEDE" | "ORGANIZACION" | "SIN_DEFINIR";

export function resolverConfiguracion(organizacion: Partial<ValoresConfiguracion> | null, sede: Partial<ValoresConfiguracion> | null) {
  const resultado = {} as { [K in Parametro]: { valor: number | null; origen: Origen } };
  for (const clave of Object.keys(PARAMETROS) as Parametro[]) {
    const deSede = sede?.[clave] ?? null;
    const deOrganizacion = organizacion?.[clave] ?? null;
    resultado[clave] = deSede !== null ? { valor: deSede, origen: "SEDE" } : deOrganizacion !== null ? { valor: deOrganizacion, origen: "ORGANIZACION" } : { valor: null, origen: "SIN_DEFINIR" };
  }
  return resultado;
}

/** null significa «heredar». Rechaza valores fuera de rango o no enteros. */
export function validarValores(entrada: Partial<Record<Parametro, number | null>>): { error: string } | { valores: Partial<ValoresConfiguracion> } {
  const valores: Partial<ValoresConfiguracion> = {};
  for (const [clave, valor] of Object.entries(entrada) as [Parametro, number | null][]) {
    const def = PARAMETROS[clave];
    if (!def) return { error: `Parámetro desconocido: ${clave}` };
    if (valor !== null && (!Number.isInteger(valor) || valor < def.min || valor > def.max)) return { error: `${def.etiqueta}: entre ${def.min} y ${def.max} ${def.unidad}` };
    if (valor !== null && "multiplo" in def && valor % def.multiplo !== 0) return { error: `${def.etiqueta}: múltiplo de ${def.multiplo}` };
    valores[clave] = valor;
  }
  return { valores };
}
