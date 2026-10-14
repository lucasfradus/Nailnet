import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalogoSede } from "@nailnet/database/catalogo";
import { ServiciosSede } from "@/components/catalogo";
import { db } from "@/lib/db";
import { cargarSede, oNulo } from "@/lib/sede";

export const metadata: Metadata = { title: "Servicios de la sede · Sicurella" };

export default async function ServiciosDeSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede, puede } = await cargarSede(sedeId);
  if (!sede.activo) return <p className="ayuda">Disponible mientras la sede esté activa.</p>;
  const datos = await oNulo(catalogoSede(db(), actorId, organizacion.id, sede.id));
  if (!datos) notFound();
  const online = datos.servicios.filter(s => s.efectivo.reservableOnline).length;
  const habilitados = datos.servicios.filter(s => s.efectivo.habilitado).length;

  return <>
    <h2 className="subtitulo">Servicios que ofrece</h2>
    <p className="ayuda pie-tabla">{habilitados} habilitados · {online} reservables online. El catálogo es común a todas las sedes; acá se define el precio y, si hace falta, la duración y la seña propias de la sede.
      {puede.administrarCatalogo && <> <Link href="/catalogo">Editar el catálogo de la organización</Link>.</>}</p>
    <ServiciosSede sedeId={sede.id} datos={datos} />
  </>;
}
