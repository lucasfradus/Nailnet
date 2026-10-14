import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabeceraFicha, FormCategoria } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Categoría · Sicurella" };

export default async function EditarCategoria({ params }: { params: Promise<{ categoriaId: string }> }) {
  const { categoriaId } = await params;
  const { cat } = await cargarCatalogo();
  const categoria = cat.categorias.find(c => c.id === categoriaId);
  if (!categoria) notFound();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo/categorias" seccion="Categorías" titulo={categoria.nombre} />
    <FormCategoria categoria={categoria} />
  </section>;
}
