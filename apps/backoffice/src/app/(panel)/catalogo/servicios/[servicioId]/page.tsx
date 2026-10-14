import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabeceraFicha, FormServicio } from "@/components/catalogo";
import { EditorImagen } from "@/components/imagen";
import { cargarCatalogo } from "@/lib/catalogo";
import { accionImagenServicio } from "../../../acciones";

export const metadata: Metadata = { title: "Servicio · Sicurella" };

export default async function EditarServicio({ params, searchParams }: { params: Promise<{ servicioId: string }>; searchParams: Promise<{ creado?: string }> }) {
  const [{ servicioId }, { creado }] = await Promise.all([params, searchParams]);
  const { cat, sede } = await cargarCatalogo();
  const servicio = cat.categorias.flatMap(c => c.servicios).find(s => s.id === servicioId);
  if (!servicio) notFound();
  return <section className="panel">
    <CabeceraFicha volver="/catalogo" seccion="Servicios" titulo={servicio.nombre} />
    {creado && <p className="alerta ok" role="status">Servicio creado. Sumale una imagen y {sede ? <Link href="/catalogo/precios">definí su precio en {sede.nombre}</Link> : "definí su precio en cada sede"} para ofrecerlo.</p>}
    <section className="form-seccion ficha-form"><h2>Imagen</h2>
      <EditorImagen accion={accionImagenServicio} ocultos={{ servicioId: servicio.id }} imagenId={servicio.imagenId} titulo={`Imagen de ${servicio.nombre}`} />
    </section>
    <FormServicio cat={cat} servicio={servicio} />
  </section>;
}
