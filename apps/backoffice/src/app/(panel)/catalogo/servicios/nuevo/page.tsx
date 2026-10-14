import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CabeceraFicha, FormServicio } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Nuevo servicio · Sicurella" };

export default async function NuevoServicio() {
  const { cat } = await cargarCatalogo();
  if (!cat.categorias.length) redirect("/catalogo/categorias/nueva");
  return <section className="panel">
    <CabeceraFicha volver="/catalogo" seccion="Servicios" titulo="Nuevo servicio" />
    <p className="intro">Después de crearlo vas a poder subir la imagen y definir el precio en cada sede.</p>
    <FormServicio cat={cat} />
  </section>;
}
