import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de las notificaciones de Mercado Pago (cabecera `x-signature: ts=…,v1=…`). El manifiesto es
 * `id:{data.id};request-id:{x-request-id};ts:{ts};`, sin las partes que no llegaron, y v1 es su
 * HMAC-SHA256 en hexadecimal con la clave secreta de la aplicación. Si data.id es alfanumérico va en
 * minúsculas. Ver https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 *
 * La firma solo evita que cualquiera nos haga consultar la API: el estado del pago nunca sale de la
 * notificación, siempre de una consulta autenticada a Mercado Pago.
 */
export function verificarFirmaMercadoPago(entrada: { firma: string | null; requestId: string | null; dataId: string | null; secreto: string }): boolean {
  if (!entrada.firma || !entrada.secreto) return false;
  const partes = new Map(entrada.firma.split(",").map(p => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
  }));
  const ts = partes.get("ts"), v1 = partes.get("v1");
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const dataId = entrada.dataId && /^[a-z0-9]+$/i.test(entrada.dataId) ? entrada.dataId.toLowerCase() : entrada.dataId;
  const manifiesto = (dataId ? `id:${dataId};` : "") + (entrada.requestId ? `request-id:${entrada.requestId};` : "") + `ts:${ts};`;
  const esperado = createHmac("sha256", entrada.secreto).update(manifiesto).digest();
  return timingSafeEqual(esperado, Buffer.from(v1, "hex"));
}

export type EstadoPago = "EN_PROCESO" | "APROBADO" | "RECHAZADO" | "REEMBOLSADO";

/**
 * Estado de un pago de Mercado Pago en nuestros términos. Con `binary_mode` solo deberían llegar
 * approved y rejected; el resto se contempla igual. Un estado desconocido se trata como en proceso:
 * nunca confirma un turno.
 */
export function estadoPagoMercadoPago(status: string): EstadoPago {
  switch (status) {
    case "approved": return "APROBADO";
    case "rejected": case "cancelled": return "RECHAZADO";
    case "refunded": case "charged_back": return "REEMBOLSADO";
    default: return "EN_PROCESO";
  }
}
