import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabeceraFicha, FormSkill } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Habilidad · Sicurella" };

export default async function EditarHabilidad({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  const { cat } = await cargarCatalogo();
  const skill = cat.skills.find(s => s.id === skillId);
  if (!skill) notFound();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo/habilidades" seccion="Habilidades" titulo={skill.nombre} />
    <FormSkill cat={cat} skill={skill} />
  </section>;
}
