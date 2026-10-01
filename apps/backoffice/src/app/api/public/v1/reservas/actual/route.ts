import { AccesoDenegado } from "@nailnet/domain";
import { consultarReservaPublica, tokenConFormato } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { json, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
/** Estado de la reserva del invitado. Token en `Authorization: Bearer`, nunca en la URL (logs, Referer). */
export async function GET(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
    // Formato inválido se rechaza antes de tocar la base.
    if (!tokenConFormato(token)) return responderError(request, new AccesoDenegado());
    return json(request, await consultarReservaPublica(db(), token));
  } catch (e) { return responderError(request, e); }
}
