import Link from "next/link";
import type { MedioPagoGasto } from "@nailnet/domain/gastos";

export const MEDIOS: Record<MedioPagoGasto, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA_DEBITO: "Tarjeta de débito", TARJETA_CREDITO: "Tarjeta de crédito", MERCADO_PAGO: "Mercado Pago", OTRO: "Otro",
};

/** Importe exacto («12345.67», puede ser negativo) en formato argentino, sin pasar por Number. */
export function pesos(importe: string): string {
  const negativo = importe.startsWith("-");
  const [entero = "0", decimales = "00"] = importe.replace("-", "").split(".");
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "−" : ""}$ ${miles},${decimales}`;
}

export function Pestanas({ actual }: { actual: "gastos" | "categorias" }) {
  return <nav className="pestanas" aria-label="Secciones de gastos">
    <Link href="/gastos" aria-current={actual === "gastos" ? "page" : undefined}>Gastos</Link>
    <Link href="/gastos/categorias" aria-current={actual === "categorias" ? "page" : undefined}>Categorías</Link>
  </nav>;
}
