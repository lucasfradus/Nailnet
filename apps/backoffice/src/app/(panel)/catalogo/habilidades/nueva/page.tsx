import type { Metadata } from "next";
import { CabeceraFicha, FormSkill } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Nueva habilidad · Sicurella" };

export default async function NuevaHabilidad() {
  const { cat } = await cargarCatalogo();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo/habilidades" seccion="Habilidades" titulo="Nueva habilidad" />
    <FormSkill cat={cat} />
  </section>;
}
