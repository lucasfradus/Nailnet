// Importes ARS en centavos enteros (bigint): nunca Number para dinero. Hacia afuera, cadenas «12345.67».
const IMPORTE = /^\d{1,10}([.,]\d{1,2})?$/;

export function aCentavos(texto: string): bigint | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!IMPORTE.test(t)) return null;
  const [entero, decimales = ""] = t.replace(",", ".").split(".");
  return BigInt(entero!) * 100n + BigInt((decimales + "00").slice(0, 2));
}
export function importe(centavos: bigint): string {
  const signo = centavos < 0n ? "-" : "";
  const abs = centavos < 0n ? -centavos : centavos;
  return `${signo}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export type TipoSena = "NINGUNA" | "FIJA" | "PORCENTAJE";
export type Sena = { tipo: TipoSena; valor: string | null } | null;

/**
 * Monto de seña. D3 (política) sigue pendiente: esto solo calcula lo configurado.
 * PORCENTAJE redondea al centavo (mitad hacia arriba). null = sin definir.
 */
export function montoSena(precioCentavos: bigint, sena: Sena): bigint | null {
  if (!sena) return null;
  if (sena.tipo === "NINGUNA") return 0n;
  if (sena.valor === null) return null;
  if (sena.tipo === "FIJA") { const v = aCentavos(sena.valor); return v === null ? null : v; }
  const pct = Number(sena.valor);
  if (!Number.isInteger(pct)) return null;
  return (precioCentavos * BigInt(pct) + 50n) / 100n;
}

export function validarSena(sena: Sena, precioCentavos: bigint | null): string | null {
  if (!sena) return null;
  if (sena.tipo === "NINGUNA") return sena.valor === null ? null : "Sin seña no lleva valor";
  if (sena.valor === null) return "Indicá el valor de la seña";
  if (sena.tipo === "PORCENTAJE") {
    const pct = Number(sena.valor);
    return Number.isInteger(pct) && pct >= 1 && pct <= 100 ? null : "El porcentaje de seña va de 1 a 100";
  }
  const monto = aCentavos(sena.valor);
  if (monto === null || monto <= 0n) return "Monto de seña inválido";
  if (precioCentavos !== null && monto > precioCentavos) return "La seña no puede superar el precio";
  return null;
}

export function validarDuracion(minutos: number): string | null {
  return Number.isInteger(minutos) && minutos >= 5 && minutos <= 480 && minutos % 5 === 0 ? null : "La duración va de 5 a 480 minutos, en múltiplos de 5";
}
export function validarBuffer(minutos: number): string | null {
  return Number.isInteger(minutos) && minutos >= 0 && minutos <= 120 && minutos % 5 === 0 ? null : "Los tiempos de preparación van de 0 a 120 minutos, en múltiplos de 5";
}

export type ServicioBase = { duracionMinutos: number; bufferAntesMinutos: number; bufferDespuesMinutos: number; sena: Sena; activo: boolean };
export type ServicioEnSede = { habilitado: boolean; precio: string | null; duracionMinutos: number | null; sena: Sena; reservableOnline: boolean } | null;

/**
 * Condiciones efectivas en una sede. La sede define precio (independiente del profesional) y puede
 * ajustar duración y seña; lo demás es global. motivosSinOnline explica por qué no se ofrece online.
 */
export function servicioEfectivo(base: ServicioBase, sede: ServicioEnSede) {
  const precio = sede?.precio ? aCentavos(sede.precio) : null;
  const sena = sede?.sena ?? base.sena;
  const duracion = sede?.duracionMinutos ?? base.duracionMinutos;
  const habilitado = base.activo && !!sede?.habilitado && precio !== null;
  const calculado = precio === null ? null : montoSena(precio, sena);
  // Si el precio bajó por debajo de una seña fija ya configurada, la seña deja de ser válida.
  const monto = calculado !== null && precio !== null && calculado > precio ? null : calculado;
  const motivos: string[] = [];
  if (calculado !== null && monto === null) motivos.push("seña mayor al precio");
  if (!base.activo) motivos.push("servicio inactivo");
  if (!sede?.habilitado) motivos.push("no habilitado en la sede");
  if (precio === null) motivos.push("sin precio");
  if (monto === null) motivos.push("seña sin definir (D3)");
  if (sede && !sede.reservableOnline) motivos.push("solo en recepción");
  return {
    habilitado, duracionMinutos: duracion, bufferAntesMinutos: base.bufferAntesMinutos, bufferDespuesMinutos: base.bufferDespuesMinutos,
    precio: precio === null ? null : importe(precio), sena: monto === null ? null : importe(monto), origenSena: sede?.sena ? "SEDE" as const : base.sena ? "SERVICIO" as const : null,
    reservableOnline: habilitado && monto !== null && !!sede?.reservableOnline, motivosSinOnline: motivos,
  };
}
