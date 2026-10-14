import { notFound } from "next/navigation";
import { listarCatalogo } from "@nailnet/database/catalogo";
import { db } from "./db";
import { requerirOrganizacion } from "./contexto";

/** Catálogo de la organización para las pantallas de administración (solo quien puede editarlo). */
export async function cargarCatalogo() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.administrarCatalogo) notFound();
  return { cat: await listarCatalogo(db(), sesion.usuario.id, organizacion.id), sede };
}
