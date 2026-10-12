import { iniciarPagoPublico } from "@nailnet/database/pagos";
import { db } from "@/lib/db";
import { pasarela } from "@/lib/mercadopago";
import { json, opciones, responderError, urlPortal } from "@/lib/publico";
import { urlBackoffice } from "@/lib/red";

export const OPTIONS = opciones;
/**
 * Link de Checkout Pro para pagar la seña (R04). Token en `Authorization: Bearer`. 200 con la URL de
 * Mercado Pago; 422 si la reserva ya no está pendiente o la sede no tiene el pago online habilitado.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
    return json(request, await iniciarPagoPublico(db(), pasarela, { token, urlApi: urlBackoffice(), urlPortal: urlPortal() }));
  } catch (e) { return responderError(request, e); }
}
