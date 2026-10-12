import type { Database } from "@nailnet/database";
import { ErrorPermanente, purgarJobsCompletados, type Manejador } from "@nailnet/database/jobs";
import { TIPO_JOB_PAGO, procesarPagoMercadoPago, type PasarelaMercadoPago } from "@nailnet/database/pagos";
import { limpiarDatosPublicos } from "@nailnet/database/publico";
import { ErrorProveedor, crearPreferencia, obtenerPago } from "@nailnet/integrations/mercadopago";

const pasarela: PasarelaMercadoPago = {
  crearPreferencia: (token, preferencia, ambiente) => crearPreferencia(token, preferencia, ambiente),
  obtenerPago: (token, id) => obtenerPago(token, id),
};

/**
 * Tipos de trabajo que este worker sabe ejecutar. Un tipo que no figura acá no se toma: queda
 * pendiente para un worker que lo conozca, sin gastar intentos. Cada manejador debe ser idempotente.
 */
export function manejadores(db: Database): Record<string, Manejador> {
  return {
    "mantenimiento.limpieza": async () => ({ ...await limpiarDatosPublicos(db), jobs: await purgarJobsCompletados(db) }),
    // R04: consulta el pago a Mercado Pago y lo aplica a la reserva. Solo credenciales o pedido inválidos
    // (400, 401, 403) van directo a revisión. Un 404 se reintenta: el pago puede no ser consultable
    // todavía segundos después de la notificación, y perderlo sería perder una seña cobrada.
    [TIPO_JOB_PAGO]: async job => {
      try { return await procesarPagoMercadoPago(db, pasarela, job.payload); }
      catch (e) { throw e instanceof ErrorProveedor && [400, 401, 403].includes(e.status) ? new ErrorPermanente(e.message) : e; }
    },
  };
}

/** Clave por hora: varias instancias encolan la misma limpieza y queda un solo trabajo. */
export const claveLimpieza = (ahora: Date) => `mantenimiento.limpieza:${ahora.toISOString().slice(0, 13)}`;
