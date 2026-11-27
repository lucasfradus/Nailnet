import { redirect } from "next/navigation";

/** Los precios por sede se unificaron con los servicios en /catalogo; se conserva la ruta vieja por enlaces guardados. */
export default function PreciosSede() {
  redirect("/catalogo");
}
