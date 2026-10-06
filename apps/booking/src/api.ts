import { useEffect, useState } from "react";
import type { ErrorPublico, ProfesionalPublico, ReservaPublicaEstado, ReservaPublicaRespuesta, ReservaPublicaSolicitud, SedePublica, ServicioPublico, TerminoPublico, TurnoPublico } from "@nailnet/contracts/publico";

// Origen completo o solo el dominio (la referencia de Railway a RAILWAY_PUBLIC_DOMAIN no trae esquema).
const crudo = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
const ORIGEN_API = /^https?:\/\//.test(crudo) ? crudo : `https://${crudo}`;
const BASE = `${ORIGEN_API}/api/public/v1`;
/** Las imágenes llegan como rutas relativas al origen de la API. */
export const urlImagen = (ruta: string | null) => (ruta ? `${ORIGEN_API}${ruta}` : null);
export const ORGANIZACION = import.meta.env.VITE_ORGANIZACION ?? "demo";

/** Error del contrato público, o "RED" si no hubo respuesta (en ese caso reintentar es seguro). */
export class ErrorApi extends Error {
  constructor(readonly status: number, readonly codigo: ErrorPublico["error"]["codigo"] | "RED", mensaje: string) { super(mensaje); this.name = "ErrorApi"; }
}

async function pedir<T>(ruta: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, { ...init, signal, headers: { Accept: "application/json", ...init.headers } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ErrorApi(0, "RED", "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
  }
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const error = (cuerpo as ErrorPublico | null)?.error;
    throw new ErrorApi(respuesta.status, error?.codigo ?? "INTERNO", error?.mensaje ?? "Error inesperado. Probá de nuevo en unos minutos.");
  }
  return cuerpo as T;
}

const segmento = encodeURIComponent;
export const api = {
  sedes: (signal?: AbortSignal) => pedir<{ sedes: SedePublica[] }>(`/organizaciones/${segmento(ORGANIZACION)}/sedes`, {}, signal).then(r => r.sedes),
  terminos: (signal?: AbortSignal) => pedir<{ terminos: TerminoPublico[] }>(`/organizaciones/${segmento(ORGANIZACION)}/terminos`, {}, signal).then(r => r.terminos),
  servicios: (sedeId: string, signal?: AbortSignal) => pedir<{ servicios: ServicioPublico[] }>(`/sedes/${segmento(sedeId)}/servicios`, {}, signal).then(r => r.servicios),
  profesionales: (sedeId: string, servicioId: string, signal?: AbortSignal) =>
    pedir<{ profesionales: ProfesionalPublico[] }>(`/sedes/${segmento(sedeId)}/profesionales?${new URLSearchParams({ servicioId })}`, {}, signal).then(r => r.profesionales),
  disponibilidad: (sedeId: string, fecha: string, servicioId: string, profesionalId: string | null, signal?: AbortSignal) =>
    pedir<{ turnos: TurnoPublico[] }>(`/sedes/${segmento(sedeId)}/disponibilidad?${new URLSearchParams({ fecha, servicio: servicioId, profesional: profesionalId ?? "" })}`, {}, signal).then(r => r.turnos),
  reservar: (solicitud: ReservaPublicaSolicitud, claveIdempotencia: string) =>
    pedir<ReservaPublicaRespuesta>("/reservas", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": claveIdempotencia }, body: JSON.stringify(solicitud) }),
  /** El token va en Authorization, nunca en la URL (logs, Referer). */
  reservaActual: (token: string, signal?: AbortSignal) => pedir<ReservaPublicaEstado>("/reservas/actual", { headers: { Authorization: `Bearer ${token}` } }, signal),
};

export type Carga<T> = { datos?: T; error?: ErrorApi; cargando: boolean; recargar: () => void };

/**
 * Carga con cancelación: si cambian las dependencias, la respuesta anterior se descarta. Mientras
 * recarga conserva los datos previos (`cargando` indica que pueden estar desactualizados).
 */
export function useCarga<T>(cargar: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Carga<T> {
  const [estado, setEstado] = useState<Omit<Carga<T>, "recargar">>({ cargando: true });
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    const control = new AbortController();
    setEstado(e => ({ datos: e.datos, cargando: true }));
    cargar(control.signal).then(
      datos => setEstado({ datos, cargando: false }),
      (e: unknown) => { if (!control.signal.aborted) setEstado({ error: e instanceof ErrorApi ? e : new ErrorApi(0, "INTERNO", "Error inesperado. Probá de nuevo."), cargando: false }); },
    );
    return () => control.abort();
    // Las dependencias las define quien llama; `cargar` cambia en cada render.
  }, [...deps, vuelta]);
  return { ...estado, recargar: () => setVuelta(v => v + 1) };
}
