import Link from "next/link";
import type { MedioCobro } from "@nailnet/domain/ventas";

export { pesos } from "../gastos/comun";

export const FILAS_PRODUCTO = 6;
export const FILAS_COBRO = 3;

export const MEDIOS_COBRO_ETIQUETA: Record<MedioCobro, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA_DEBITO: "Tarjeta de débito", TARJETA_CREDITO: "Tarjeta de crédito", MERCADO_PAGO: "Mercado Pago", OTRO: "Otro",
};
export const ESTADOS_VENTA: Record<string, string> = { PENDIENTE: "Pendiente de cobro", COMPLETADA: "Cobrada", ANULADA: "Anulada" };

export const instante = (d: Date, tz: string) => d.toLocaleString("es-AR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const fechaCorta = (f: string) => f.split("-").reverse().join("/");

export function PestanasVentas({ actual }: { actual: "ventas" | "nueva" }) {
  return <nav className="pestanas" aria-label="Secciones de ventas">
    <Link href="/ventas" aria-current={actual === "ventas" ? "page" : undefined}>Ventas del día</Link>
    <Link href="/ventas/nueva" aria-current={actual === "nueva" ? "page" : undefined}>Venta de productos</Link>
  </nav>;
}
