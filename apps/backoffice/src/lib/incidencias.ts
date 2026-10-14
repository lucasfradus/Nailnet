import { cache } from "react";
import { contarIncidenciasAbiertas } from "@nailnet/database/incidencias";
import { contextoPanel } from "./contexto";
import { db } from "./db";

/**
 * Incidencias sin revisar del actor en la organización elegida (M04), una vez por request: la usan el
 * lateral y el inicio. null si su rol no accede a la bandeja (recepción, profesional).
 */
export const incidenciasAbiertas = cache(async () => {
  const { sesion, organizacion } = await contextoPanel();
  return organizacion ? contarIncidenciasAbiertas(db(), sesion.usuario.id, organizacion.id) : null;
});
