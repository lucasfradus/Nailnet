import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de los webhooks de Resend (los envía Svix). Cabeceras `svix-id`, `svix-timestamp` (segundos)
 * y `svix-signature` (`v1,<base64>`, varias separadas por espacio durante una rotación). La firma es
 * HMAC-SHA256 de `{id}.{timestamp}.{cuerpo}` con el secreto `whsec_<base64>` decodificado.
 * Ver https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 *
 * La ventana de 5 minutos sobre el timestamp acota la repetición de una notificación capturada.
 */
export function verificarFirmaResend(entrada: { id: string | null; timestamp: string | null; firma: string | null; cuerpo: string; secreto: string; ahora?: Date; toleranciaMs?: number }): boolean {
  const { id, timestamp, firma, secreto } = entrada;
  if (!id || !timestamp || !firma || !secreto.startsWith("whsec_")) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const ahora = (entrada.ahora ?? new Date()).getTime();
  if (Math.abs(ahora - Number(timestamp) * 1000) > (entrada.toleranciaMs ?? 5 * 60_000)) return false;
  const clave = Buffer.from(secreto.slice("whsec_".length), "base64");
  if (!clave.length) return false;
  const esperado = createHmac("sha256", clave).update(`${id}.${timestamp}.${entrada.cuerpo}`).digest();
  return firma.split(" ").some(parte => {
    const [version, valor] = parte.split(",");
    if (version !== "v1" || !valor) return false;
    const recibido = Buffer.from(valor, "base64");
    return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
  });
}

export type EstadoEntrega = "DEMORADO" | "ENTREGADO" | "REBOTADO" | "QUEJA" | "FALLIDO";

/** Eventos de Resend que cambian el estado de entrega de un envío; el resto (enviado, abierto, clic) se ignora. */
export function estadoEntregaResend(tipo: string): EstadoEntrega | null {
  switch (tipo) {
    case "email.delivered": return "ENTREGADO";
    case "email.delivery_delayed": return "DEMORADO";
    case "email.bounced": return "REBOTADO";
    case "email.complained": return "QUEJA";
    case "email.failed": return "FALLIDO";
    default: return null;
  }
}

/**
 * Orden de los estados de un envío: un evento solo avanza, nunca retrocede. Los webhooks pueden llegar
 * desordenados o repetidos (un «demorado» después de «entregado» no lo pisa; una queja sí, porque
 * llega después de la entrega).
 */
export const RANGO_ENVIO: Record<string, number> = {
  PENDIENTE: 0, OMITIDO: 0, SIMULADO: 1, ENVIADO: 1, DEMORADO: 2, ENTREGADO: 3, REBOTADO: 4, FALLIDO: 4, QUEJA: 5,
};
