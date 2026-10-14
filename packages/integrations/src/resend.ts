import { createHash } from "node:crypto";

/**
 * Envío de emails transaccionales con Resend (P03). Sin SDK: una sola llamada HTTP, con tiempo límite,
 * clave de idempotencia y errores clasificados. `fetch` se inyecta para las pruebas.
 *
 * - ErrorResendTransitorio: red, tiempo agotado, 429, 5xx o 409 por pedidos concurrentes con la misma
 *   clave. Reintentar (la cola lo hace sola).
 * - ErrorResend: el resto de los 4xx (validación, dominio no verificado, clave inválida). Reintentar no
 *   cambia nada: va a revisión.
 *
 * Idempotency-Key: Resend devuelve el mismo envío para la misma clave durante 24 h, así que un trabajo
 * reintentado después de un envío que sí salió no duplica el email. Nunca incluir la API key en errores.
 */
const API = "https://api.resend.com";
const TIEMPO_LIMITE_MS = 10_000;

export class ErrorResend extends Error {
  constructor(readonly status: number, mensaje: string) { super(mensaje); this.name = "ErrorResend"; }
}
export class ErrorResendTransitorio extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "ErrorResendTransitorio"; }
}

export type MensajeSaliente = {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** 1 a 256 caracteres. La misma clave en 24 h no envía otra vez. */
  claveIdempotencia: string;
  /** Etiquetas para filtrar en Resend: solo letras ASCII, números, `_` y `-`. */
  etiquetas?: Record<string, string>;
};
export type EnvioAceptado = { id: string };
export type TransporteEmail = {
  /** "resend" o "simulado": queda como proveedor en la evidencia del envío. */
  readonly nombre: "resend" | "simulado";
  enviar(mensaje: MensajeSaliente, signal?: AbortSignal): Promise<EnvioAceptado>;
};

type Fetch = typeof fetch;
const ETIQUETA = /^[A-Za-z0-9_-]{1,256}$/;
/** Remitente «Nombre <direccion@dominio>» o solo la dirección. */
const REMITENTE = /^(?:[^<>\r\n]{1,100} <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

export const remitenteValido = (de: string) => REMITENTE.test(de);

export function transporteResend(config: { apiKey: string; de: string; fetch?: Fetch }): TransporteEmail {
  if (!config.apiKey) throw new Error("Falta la API key de Resend");
  if (!remitenteValido(config.de)) throw new Error("Remitente de Resend inválido: usar «Nombre <direccion@dominio>»");
  const fetchImpl = config.fetch ?? fetch;
  return {
    nombre: "resend",
    async enviar(m, signal) {
      if (!m.claveIdempotencia || m.claveIdempotencia.length > 256) throw new ErrorResend(400, "Clave de idempotencia inválida");
      const tags = Object.entries(m.etiquetas ?? {}).filter(([k, v]) => ETIQUETA.test(k) && ETIQUETA.test(v)).map(([name, value]) => ({ name, value }));
      const cuerpo = { from: config.de, to: [m.para], subject: m.asunto, html: m.html, text: m.texto, ...(tags.length ? { tags } : {}) };
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(`${API}/emails`, {
          method: "POST", body: JSON.stringify(cuerpo),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIEMPO_LIMITE_MS)]) : AbortSignal.timeout(TIEMPO_LIMITE_MS),
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": m.claveIdempotencia },
        });
      } catch (e) {
        throw new ErrorResendTransitorio(`Resend no respondió: ${e instanceof Error ? e.name : "error de red"}`);
      }
      const r = await respuesta.json().catch(() => null) as { id?: unknown; name?: unknown; message?: unknown } | null;
      if (respuesta.ok) {
        if (typeof r?.id !== "string" || !r.id) throw new ErrorResendTransitorio("Respuesta de Resend inesperada");
        return { id: r.id };
      }
      // `name` es el código de error de Resend (validation_error, rate_limit_exceeded…); el mensaje se
      // acota y nunca repite la API key (Resend no la devuelve, pero por las dudas se filtra).
      const codigo = typeof r?.name === "string" ? r.name.slice(0, 60) : null;
      const detalle = typeof r?.message === "string" ? r.message.replaceAll(config.apiKey, "•••").slice(0, 200) : null;
      const mensaje = `Resend respondió ${respuesta.status}${codigo ? ` ${codigo}` : ""}${detalle ? `: ${detalle}` : ""}`;
      if (respuesta.status === 429 || respuesta.status >= 500 || codigo === "concurrent_idempotent_requests") throw new ErrorResendTransitorio(mensaje);
      throw new ErrorResend(respuesta.status, mensaje);
    },
  };
}

/**
 * Transporte para desarrollo y pruebas, cuando no hay RESEND_API_KEY: no sale nada a la red. Guarda los
 * mensajes y avisa a `registrar` (el worker los muestra en la consola). Como Resend, la misma clave de
 * idempotencia devuelve el mismo id y no registra dos veces.
 */
export function transporteFalso(opciones: { registrar?: (m: MensajeSaliente) => void } = {}): TransporteEmail & { enviados: MensajeSaliente[] } {
  const enviados: MensajeSaliente[] = [];
  const ids = new Map<string, string>();
  return {
    nombre: "simulado",
    enviados,
    async enviar(m) {
      const previo = ids.get(m.claveIdempotencia);
      if (previo) return { id: previo };
      const id = `simulado-${createHash("sha256").update(m.claveIdempotencia).digest("hex").slice(0, 24)}`;
      ids.set(m.claveIdempotencia, id);
      enviados.push(m);
      opciones.registrar?.(m);
      return { id };
    },
  };
}

/** «l***@example.com»: para logs, sin exponer la dirección completa. */
export function enmascararEmail(email: string) {
  const [usuario, dominio] = email.split("@");
  return dominio ? `${(usuario ?? "").slice(0, 1)}***@${dominio}` : "***";
}
