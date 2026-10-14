import type { Metadata } from "next";
import { CabeceraFicha, FormCategoria } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Nueva categoría · Sicurella" };

export default async function NuevaCategoria() {
  await cargarCatalogo();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo/categorias" seccion="Categorías" titulo="Nueva categoría" />
    <FormCategoria />
  </section>;
}
