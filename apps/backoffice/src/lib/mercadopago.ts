import type { PasarelaMercadoPago } from "@nailnet/database/pagos";
import { crearPreferencia, obtenerPago } from "@nailnet/integrations/mercadopago";

/** Mercado Pago real para las rutas del servidor. Las pruebas de base usan una pasarela falsa. */
export const pasarela: PasarelaMercadoPago = {
  crearPreferencia: (token, preferencia, ambiente) => crearPreferencia(token, preferencia, ambiente),
  obtenerPago: (token, id) => obtenerPago(token, id),
};
