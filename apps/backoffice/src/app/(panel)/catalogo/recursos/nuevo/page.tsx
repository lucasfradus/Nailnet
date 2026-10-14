import type { Metadata } from "next";
import { CabeceraFicha, FormTipoRecurso } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Nuevo tipo de recurso · Sicurella" };

export default async function NuevoTipoRecurso() {
  const { cat } = await cargarCatalogo();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo/recursos" seccion="Tipos de recurso" titulo="Nuevo tipo de recurso" />
    <FormTipoRecurso cat={cat} />
  </section>;
}
