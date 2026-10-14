import { NextResponse } from "next/server";
import { tieneCuentaMercadoPago } from "@nailnet/database/configuracion";
import { ambientePagos, encolarConsultaPago } from "@nailnet/database/pagos";
import { verificarFirmaMercadoPago } from "@nailnet/domain/mercadopago";
import { db } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const respuesta = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Notificaciones de Mercado Pago de una sede (R04). La URL la fija la preferencia; la firma se valida
 * con la clave secreta de la aplicación (MP_WEBHOOK_SECRET). Solo encola la consulta del pago y responde enseguida: el estado
 * siempre sale de la API, nunca del cuerpo de la notificación.
 *
 * 200 también para lo que no nos interesa (otros tipos de evento), para que Mercado Pago no reintente.
 * 401 si la firma no cierra, falta x-request-id o la sede no tiene credenciales (indistinguibles a
 * propósito); 500 si no se pudo encolar, para que Mercado Pago reintente.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  if (!UUID.test(sedeId)) return respuesta(404);
  const url = new URL(request.url);
  const texto = await request.text();
  if (texto.length > 10_000) return respuesta(413);
  let cuerpo: { type?: unknown; data?: { id?: unknown } } | null = null;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch { /* algunas notificaciones llegan solo con query */ }

  const tipo = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? (typeof cuerpo?.type === "string" ? cuerpo.type : null);
  const idCuerpo = cuerpo?.data?.id;
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? (typeof idCuerpo === "string" || typeof idCuerpo === "number" ? String(idCuerpo) : null);

  try {
    const ambiente = ambientePagos();
    // Sin x-request-id no hay deduplicación posible: una notificación capturada se podría repetir.
    const requestId = request.headers.get("x-request-id");
    if (!requestId) return respuesta(401);
    // Las cuentas se vinculan por OAuth a la aplicación de NailNet: Mercado Pago firma con la clave
    // de la aplicación, no con una de cada sede.
    const secreto = process.env.MP_WEBHOOK_SECRET;
    if (!secreto) { console.error("Webhook de Mercado Pago: falta MP_WEBHOOK_SECRET"); return respuesta(401); }
    if (!verificarFirmaMercadoPago({ firma: request.headers.get("x-signature"), requestId, dataId, secreto })) {
      // Sin la firma ni el cuerpo: alcanza para notar una clave de webhook equivocada.
      console.warn("Webhook de Mercado Pago: firma inválida", { sedeId, tipo, conFirma: request.headers.has("x-signature") });
      return respuesta(401);
    }
    // Misma respuesta que una firma inválida: no revela qué sedes tienen Mercado Pago vinculado.
    if (!await tieneCuentaMercadoPago(db(), sedeId, ambiente)) return respuesta(401);
    if (tipo !== "payment" || !dataId || !/^\d{1,30}$/.test(dataId)) return respuesta(200);
    await encolarConsultaPago(db(), { sedeId, ambiente, pagoId: dataId, origen: `req:${requestId.slice(0, 100)}` });
    return respuesta(200);
  } catch (e) {
    console.error("Webhook de Mercado Pago", e instanceof Error ? e.message : e);
    return respuesta(500);
  }
}
