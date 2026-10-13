/**
 * Cliente mínimo de la API de Mercado Pago (Checkout Pro). Sin SDK: dos llamadas, con tiempo límite y
 * errores clasificados. `fetch` se inyecta para las pruebas.
 *
 * - ErrorTransitorio: red, 429 o 5xx. Reintentar (los trabajos de la cola lo hacen solos).
 * - ErrorProveedor: 4xx. Reintentar no cambia nada (token inválido, pago inexistente).
 *
 * Nunca incluir el access token en un mensaje de error.
 */
const API = "https://api.mercadopago.com";
const TIEMPO_LIMITE_MS = 10_000;

export class ErrorProveedor extends Error {
  constructor(readonly status: number, mensaje: string) { super(mensaje); this.name = "ErrorProveedor"; }
}
export class ErrorTransitorio extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "ErrorTransitorio"; }
}

export type PreferenciaMercadoPago = {
  /** Idempotencia del lado de Mercado Pago: el mismo valor devuelve la misma preferencia. */
  claveIdempotencia: string;
  titulo: string;
  /** Importe decimal «12345.67», en ARS. */
  monto: string;
  referenciaExterna: string;
  urlNotificacion: string | null;
  urlRetorno: string;
  expiraEn: Date;
  ahora: Date;
};
export type PreferenciaCreada = { id: string; url: string };

/** Pago tal como lo informa la API, reducido a lo que usamos para conciliar. */
export type PagoMercadoPago = {
  id: string; status: string; statusDetail: string | null; monto: string; moneda: string;
  referenciaExterna: string | null; cobradorId: string | null; aprobadoEn: Date | null;
};

type Fetch = typeof fetch;

async function llamar(fetchImpl: Fetch, accessToken: string, ruta: string, init: RequestInit = {}): Promise<unknown> {
  let respuesta: Response;
  try {
    respuesta = await fetchImpl(`${API}${ruta}`, {
      ...init, signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...init.headers },
    });
  } catch (e) {
    throw new ErrorTransitorio(`Mercado Pago no respondió: ${e instanceof Error ? e.name : "error de red"}`);
  }
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (respuesta.ok) return cuerpo;
  const detalle = (cuerpo as { message?: unknown } | null)?.message;
  const mensaje = `Mercado Pago respondió ${respuesta.status}${typeof detalle === "string" ? `: ${detalle.slice(0, 200)}` : ""}`;
  if (respuesta.status === 429 || respuesta.status >= 500) throw new ErrorTransitorio(mensaje);
  throw new ErrorProveedor(respuesta.status, mensaje);
}

/**
 * Crea la preferencia de Checkout Pro para la seña. `binary_mode`: el pago se aprueba o se rechaza en
 * el momento, sin estados pendientes; se excluyen los medios en efectivo (ticket, cajero), que se
 * acreditan días después de vencida la retención. La preferencia vence junto con la retención.
 */
export async function crearPreferencia(accessToken: string, p: PreferenciaMercadoPago, ambiente: "PRUEBA" | "PRODUCCION", fetchImpl: Fetch = fetch): Promise<PreferenciaCreada> {
  const cuerpo = {
    items: [{ id: p.referenciaExterna, title: p.titulo.slice(0, 250), quantity: 1, unit_price: Number(p.monto), currency_id: "ARS" }],
    external_reference: p.referenciaExterna,
    ...(p.urlNotificacion ? { notification_url: p.urlNotificacion } : {}),
    back_urls: { success: p.urlRetorno, failure: p.urlRetorno, pending: p.urlRetorno },
    auto_return: "approved",
    binary_mode: true,
    payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 1 },
    expires: true,
    expiration_date_from: p.ahora.toISOString(),
    expiration_date_to: p.expiraEn.toISOString(),
  };
  const r = await llamar(fetchImpl, accessToken, "/checkout/preferences", {
    method: "POST", body: JSON.stringify(cuerpo),
    headers: { "Content-Type": "application/json", "X-Idempotency-Key": p.claveIdempotencia },
  }) as { id?: unknown; init_point?: unknown; sandbox_init_point?: unknown } | null;
  // Con credenciales de prueba se usa el checkout de sandbox cuando la API lo informa.
  const url = ambiente === "PRUEBA" && typeof r?.sandbox_init_point === "string" ? r.sandbox_init_point : r?.init_point;
  if (typeof r?.id !== "string" || typeof url !== "string" || !url.startsWith("https://")) throw new ErrorTransitorio("Respuesta de preferencia inesperada");
  return { id: r.id, url };
}

/** Consulta un pago por id. Es la única fuente del estado: las notificaciones solo avisan que cambió. */
export async function obtenerPago(accessToken: string, id: string, fetchImpl: Fetch = fetch): Promise<PagoMercadoPago> {
  if (!/^\d{1,30}$/.test(id)) throw new ErrorProveedor(400, "Id de pago inválido");
  const r = await llamar(fetchImpl, accessToken, `/v1/payments/${id}`) as Record<string, unknown> | null;
  if (!r || (typeof r.id !== "number" && typeof r.id !== "string") || typeof r.status !== "string" || typeof r.transaction_amount !== "number" || typeof r.currency_id !== "string") {
    throw new ErrorTransitorio("Respuesta de pago inesperada");
  }
  const cobrador = (r.collector_id ?? (r.collector as { id?: unknown } | undefined)?.id) as number | string | null | undefined;
  return {
    id: String(r.id), status: r.status,
    statusDetail: typeof r.status_detail === "string" ? r.status_detail : null,
    monto: r.transaction_amount.toFixed(2), moneda: r.currency_id,
    referenciaExterna: typeof r.external_reference === "string" && r.external_reference ? r.external_reference : null,
    cobradorId: cobrador === undefined || cobrador === null ? null : String(cobrador),
    aprobadoEn: typeof r.date_approved === "string" && !Number.isNaN(Date.parse(r.date_approved)) ? new Date(r.date_approved) : null,
  };
}
