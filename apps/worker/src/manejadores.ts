import type { Database } from "@nailnet/database";
import { renovarTokensPorVencer } from "@nailnet/database/configuracion";
import { ErrorPermanente, purgarJobsCompletados, type Manejador } from "@nailnet/database/jobs";
import { TIPO_JOB_PAGO, procesarPagoMercadoPago, type PasarelaMercadoPago } from "@nailnet/database/pagos";
import { limpiarDatosPublicos } from "@nailnet/database/publico";
import { ErrorProveedor, crearPreferencia, obtenerPago, refrescarTokens } from "@nailnet/integrations/mercadopago";

/**
 * Aplicación de Mercado Pago de NailNet: renovar tokens solo necesita client id y secret. Sin ellas
 * los cobros usan el token guardado tal cual y no se renueva nada.
 */
const aplicacion = process.env.MP_APP_ID && process.env.MP_CLIENT_SECRET ? { clientId: process.env.MP_APP_ID, clientSecret: process.env.MP_CLIENT_SECRET } : null;

const pasarela: PasarelaMercadoPago = {
  crearPreferencia: (token, preferencia, ambiente) => crearPreferencia(token, preferencia, ambiente),
  obtenerPago: (token, id) => obtenerPago(token, id),
  ...(aplicacion ? { renovarTokens: (refreshToken: string) => refrescarTokens(aplicacion, refreshToken) } : {}),
};

export const TIPO_RENOVACION_MP = "mercadopago.renovacion";
export const renovacionHabilitada = aplicacion !== null;

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
    // Renueva los tokens OAuth antes de que venzan, aunque la sede no esté cobrando. Una cuenta que
    // falla no frena a las demás; se vuelve a intentar en la próxima vuelta.
    ...(pasarela.renovarTokens ? { [TIPO_RENOVACION_MP]: () => renovarTokensPorVencer(db, pasarela.renovarTokens!) } : {}),
  };
}

/** Clave por hora: varias instancias encolan la misma limpieza y queda un solo trabajo. */
export const claveLimpieza = (ahora: Date) => `mantenimiento.limpieza:${ahora.toISOString().slice(0, 13)}`;
export const claveRenovacion = (ahora: Date) => `${TIPO_RENOVACION_MP}:${ahora.toISOString().slice(0, 13)}`;
