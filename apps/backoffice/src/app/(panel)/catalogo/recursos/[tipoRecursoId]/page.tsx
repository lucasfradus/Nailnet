import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabeceraFicha, FormTipoRecurso } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Tipo de recurso · Sicurella" };

export default async function EditarTipoRecurso({ params }: { params: Promise<{ tipoRecursoId: string }> }) {
  const { tipoRecursoId } = await params;
  const { cat } = await cargarCatalogo();
  const tipo = cat.tiposRecurso.find(t => t.id === tipoRecursoId);
  if (!tipo) notFound();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo/recursos" seccion="Tipos de recurso" titulo={tipo.nombre} />
    <FormTipoRecurso cat={cat} tipo={tipo} />
  </section>;
}
