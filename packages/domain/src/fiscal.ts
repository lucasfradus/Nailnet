// Identidad fiscal de una sede (D8): un emisor (CUIT) puede servir a varias sedes, cada una con su punto de venta.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** CUIT sin guiones ni espacios, o null si no tiene 11 dígitos o el dígito verificador no coincide. */
export function normalizarCuit(valor: string): string | null {
  const cuit = valor.replace(/[\s.-]/g, "");
  if (!/^\d{11}$/.test(cuit)) return null;
  const suma = PESOS.reduce((s, p, i) => s + p * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto;
  return verificador !== 10 && verificador === Number(cuit[10]) ? cuit : null;
}

export const formatearCuit = (cuit: string) => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;

/** Punto de venta habilitado en ARCA: entero entre 1 y 99999. */
export const puntoVentaValido = (n: number) => Number.isInteger(n) && n >= 1 && n <= 99999;
