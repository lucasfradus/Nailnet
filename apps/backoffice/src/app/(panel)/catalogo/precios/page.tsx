import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { catalogoSede } from "@nailnet/database/catalogo";
import { CabeceraCatalogo, ServiciosSede } from "@/components/catalogo";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { AccesoDenegado } from "@nailnet/domain";

export const metadata: Metadata = { title: "Precios en la sede · Sicurella" };

export default async function PreciosSede() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.administrarCatalogo || !sede) notFound();
  const datos = await catalogoSede(db(), sesion.usuario.id, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!datos) notFound();
  return <section className="panel">
    <CabeceraCatalogo sede={sede.nombre} />
    <p className="ayuda pie-tabla">Precio, duración y seña de cada servicio en {sede.nombre}. Lo que se deja vacío usa el valor del servicio.</p>
    <ServiciosSede sedeId={sede.id} datos={datos} />
  </section>;
}
