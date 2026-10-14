import { NextResponse } from "next/server";
import { registrarEntregaEmail } from "@nailnet/database/emails";
import { estadoEntregaResend, verificarFirmaResend } from "@nailnet/domain/resend";
import { db } from "@/lib/db";

const respuesta = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Eventos de entrega de Resend (P03): entregado, demorado, rebotado, queja. Completan la evidencia de
 * cada envío (EnvioEmail) buscándolo por el id que Resend devolvió al aceptarlo. La firma (Svix) se
 * valida con RESEND_WEBHOOK_SECRET.
 *
 * 200 también para eventos que no usamos o ids desconocidos (otro ambiente en la misma cuenta), para que
 * Resend no reintente. 401 sin firma válida; 500 si no se pudo guardar, para que reintente.
 */
export async function POST(request: Request) {
  const cuerpo = await request.text();
  if (cuerpo.length > 100_000) return respuesta(413);
  const secreto = process.env.RESEND_WEBHOOK_SECRET;
  if (!secreto) { console.error("Webhook de Resend: falta RESEND_WEBHOOK_SECRET"); return respuesta(401); }
  const h = request.headers;
  if (!verificarFirmaResend({ id: h.get("svix-id"), timestamp: h.get("svix-timestamp"), firma: h.get("svix-signature"), cuerpo, secreto })) {
    console.warn("Webhook de Resend: firma inválida", { conFirma: h.has("svix-signature") });
    return respuesta(401);
  }
  let evento: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; bounce?: { message?: unknown } } } | null = null;
  try { evento = JSON.parse(cuerpo); } catch { return respuesta(400); }
  const estado = typeof evento?.type === "string" ? estadoEntregaResend(evento.type) : null;
  const emailId = evento?.data?.email_id;
  if (!estado || typeof emailId !== "string" || !emailId) return respuesta(200);
  const fecha = typeof evento?.created_at === "string" && !Number.isNaN(Date.parse(evento.created_at)) ? new Date(evento.created_at) : new Date();
  const motivo = typeof evento?.data?.bounce?.message === "string" ? evento.data.bounce.message : null;
  try {
    await registrarEntregaEmail(db(), { proveedorId: emailId, estado, fecha, motivo });
    return respuesta(200);
  } catch (e) {
    console.error("Webhook de Resend", e instanceof Error ? e.message : e);
    return respuesta(500);
  }
}
