import { claveIdempotenciaValida, validarReservaPublica } from "@nailnet/contracts/publico";
import { crearReservaPublica } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { invalido, ipDe, json, leerJson, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
/** Crea una reserva invitada. Exige Idempotency-Key; 201 creada, 409 no disponible o clave reutilizada, 422 inválida, 429 límite. */
export async function POST(request: Request) {
  try {
    const clave = request.headers.get("idempotency-key");
    if (!claveIdempotenciaValida(clave)) return invalido(request, "Falta Idempotency-Key válida (16 a 100 caracteres)");
    const validacion = validarReservaPublica(await leerJson(request));
    if (!validacion.ok) return invalido(request, validacion.mensaje);
    const r = await crearReservaPublica(db(), { solicitud: validacion.valor, claveIdempotencia: clave, ip: ipDe(request) });
    return json(request, r.cuerpo, r.codigo);
  } catch (e) { return responderError(request, e); }
}
