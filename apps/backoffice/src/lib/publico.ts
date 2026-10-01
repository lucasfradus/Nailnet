import { NextResponse } from "next/server";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { ConfiguracionIncompleta } from "@nailnet/database/disponibilidad";
import { ConflictoIdempotencia, LimiteExcedido } from "@nailnet/database/publico";
import { TurnoNoDisponible } from "@nailnet/database/reservas";
import type { ErrorPublico } from "@nailnet/contracts/publico";

// CORS acotado al portal. CORS no autoriza nada: cada operación valida igual en el servidor.
const ORIGEN_PORTAL = process.env.PORTAL_ORIGIN ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:5173");

export function cabeceras(request: Request, extra: Record<string, string> = {}): HeadersInit {
  const origen = request.headers.get("origin");
  return {
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(origen && origen === ORIGEN_PORTAL ? {
      "Access-Control-Allow-Origin": origen,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, Authorization",
      "Access-Control-Max-Age": "600",
    } : {}),
    ...extra,
  };
}
export const opciones = (request: Request) => new NextResponse(null, { status: 204, headers: cabeceras(request) });
export const json = (request: Request, cuerpo: unknown, status = 200, extra: Record<string, string> = {}) => NextResponse.json(cuerpo, { status, headers: cabeceras(request, extra) });

const error = (request: Request, status: number, codigo: ErrorPublico["error"]["codigo"], mensaje: string, extra: Record<string, string> = {}) => json(request, { error: { codigo, mensaje } } satisfies ErrorPublico, status, extra);

/** Traduce errores de dominio a códigos HTTP del contrato. Nunca filtra detalles internos. */
export function responderError(request: Request, e: unknown) {
  if (e instanceof AccesoDenegado) return error(request, 404, "NO_ENCONTRADO", "No encontrado");
  if (e instanceof TurnoNoDisponible) return error(request, 409, "NO_DISPONIBLE", e.message);
  if (e instanceof ConflictoIdempotencia) return error(request, 409, "CONFLICTO_IDEMPOTENCIA", e.message);
  if (e instanceof DatosInvalidos || e instanceof ConfiguracionIncompleta) return error(request, 422, "INVALIDO", e.message);
  if (e instanceof LimiteExcedido) return error(request, 429, "LIMITE", e.message, { "Retry-After": "600" });
  console.error("Error en API pública", e instanceof Error ? e.message : e);
  return error(request, 500, "INTERNO", "Error interno. Probá de nuevo en unos minutos.");
}
export const invalido = (request: Request, mensaje: string) => error(request, 422, "INVALIDO", mensaje);

/** Solo confía en X-Forwarded-For si el despliegue lo declara (proxy propio delante). */
export function ipDe(request: Request) {
  if (process.env.TRUST_PROXY !== "true") return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** Lee JSON con tope de tamaño: el portal nunca necesita más de unos pocos KB. */
export async function leerJson(request: Request, maximo = 10_000): Promise<unknown> {
  const texto = await request.text();
  if (texto.length > maximo) throw new DatosInvalidos("Solicitud demasiado grande");
  try { return JSON.parse(texto); } catch { throw new DatosInvalidos("JSON inválido"); }
}
