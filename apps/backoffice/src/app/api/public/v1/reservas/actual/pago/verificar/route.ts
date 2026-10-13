import { verificarPagoPublico } from "@nailnet/database/pagos";
import { db } from "@/lib/db";
import { invalido, json, leerJson, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
/**
 * El portal volvió de Mercado Pago con `payment_id`: encola la consulta del pago. No confirma nada por
 * sí misma (el estado sale de la API de Mercado Pago); solo adelanta lo que hará la notificación. 202.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
    const cuerpo = await leerJson(request, 1_000) as { pagoId?: unknown } | null;
    if (typeof cuerpo?.pagoId !== "string") return invalido(request, "Falta pagoId");
    await verificarPagoPublico(db(), token, cuerpo.pagoId);
    return json(request, { ok: true }, 202);
  } catch (e) { return responderError(request, e); }
}
