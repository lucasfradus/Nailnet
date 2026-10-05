import type { Metadata } from "next";
import { FormularioRecuperacion } from "../acceso/formularios";
import { TarjetaAcceso } from "../acceso/tarjeta";

export const metadata: Metadata = { title: "Recuperar acceso · Sicurella" };
export default function Recuperar() {
  // Sin proveedor de email (P03) no se emiten enlaces que nadie recibiría.
  if (process.env.NODE_ENV === "production") return <TarjetaAcceso titulo="Recuperar acceso">
    <p>Por ahora la recuperación la gestiona un administrador. Pedile que restablezca tu contraseña.</p>
    <p className="pie"><a href="/login">Volver al ingreso</a></p>
  </TarjetaAcceso>;
  return <TarjetaAcceso titulo="Recuperar acceso">
    <p>Te enviamos un enlace para elegir una nueva contraseña.</p>
    <FormularioRecuperacion />
    <p className="pie"><a href="/login">Volver al ingreso</a></p>
  </TarjetaAcceso>;
}
