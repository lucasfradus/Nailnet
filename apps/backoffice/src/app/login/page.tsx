import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FormularioIngreso } from "../acceso/formularios";
import { TarjetaAcceso } from "../acceso/tarjeta";
import { leerTokenSesion, sesionActual } from "@/lib/sesion";

export const metadata: Metadata = { title: "Ingresar · NailNet" };
export default async function Login() {
  // Sin cookie no se consulta la base: la pantalla de ingreso no depende de ella.
  if (await leerTokenSesion() && await sesionActual()) redirect("/");
  return <TarjetaAcceso titulo="Ingresar">
    <FormularioIngreso />
    <p className="pie"><a href="/recuperar">Olvidé mi contraseña</a></p>
  </TarjetaAcceso>;
}
