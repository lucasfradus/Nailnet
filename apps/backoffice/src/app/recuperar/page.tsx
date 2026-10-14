import type { Metadata } from "next";
import { recuperacionPorEmail } from "@/lib/emails";
import { FormularioRecuperacion } from "../acceso/formularios";
import { TarjetaAcceso } from "../acceso/tarjeta";

export const metadata: Metadata = { title: "Recuperar acceso · Sicurella" };
// Depende de una variable de entorno de ejecución, no del build.
export const dynamic = "force-dynamic";
export default function Recuperar() {
  // Sin envío de emails habilitado (P03, RECUPERACION_POR_EMAIL) no se emiten enlaces que nadie recibiría.
  if (!recuperacionPorEmail()) return <TarjetaAcceso titulo="Recuperar acceso">
    <p>Por ahora la recuperación la gestiona un administrador. Pedile que restablezca tu contraseña.</p>
    <p className="pie"><a href="/login">Volver al ingreso</a></p>
  </TarjetaAcceso>;
  return <TarjetaAcceso titulo="Recuperar acceso">
    <p>Te enviamos un enlace para elegir una nueva contraseña.</p>
    <FormularioRecuperacion />
    <p className="pie"><a href="/login">Volver al ingreso</a></p>
  </TarjetaAcceso>;
}
