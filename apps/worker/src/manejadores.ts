import type { Database } from "@nailnet/database";
import { purgarJobsCompletados, type Manejador } from "@nailnet/database/jobs";
import { limpiarDatosPublicos } from "@nailnet/database/publico";

/**
 * Tipos de trabajo que este worker sabe ejecutar. Un tipo que no figura acá no se toma: queda
 * pendiente para un worker que lo conozca, sin gastar intentos. Cada manejador debe ser idempotente.
 */
export function manejadores(db: Database): Record<string, Manejador> {
  return {
    "mantenimiento.limpieza": async () => ({ ...await limpiarDatosPublicos(db), jobs: await purgarJobsCompletados(db) }),
  };
}

/** Clave por hora: varias instancias encolan la misma limpieza y queda un solo trabajo. */
export const claveLimpieza = (ahora: Date) => `mantenimiento.limpieza:${ahora.toISOString().slice(0, 13)}`;
