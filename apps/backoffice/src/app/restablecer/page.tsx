import type { Metadata } from "next";
import { FormularioRestablecer } from "../acceso/formularios";
import { TarjetaAcceso } from "../acceso/tarjeta";

export const metadata: Metadata = { title: "Nueva contraseña · NailNet", referrer: "no-referrer" };
export default function Restablecer() {
  return <TarjetaAcceso titulo="Nueva contraseña">
    <p>Al guardarla se cierran todas las sesiones abiertas.</p>
    <FormularioRestablecer />
  </TarjetaAcceso>;
}
