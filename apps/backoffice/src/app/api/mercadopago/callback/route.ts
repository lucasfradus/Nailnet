import { NextResponse } from "next/server";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { vincularMercadoPago } from "@nailnet/database/configuracion";
import { canjearCodigo } from "@nailnet/integrations/mercadopago";
import { db } from "@/lib/db";
import { aplicacionMercadoPago, consumirVinculacion } from "@/lib/mercadopago";
import { urlBackoffice } from "@/lib/red";
import { sesionActual } from "@/lib/sesion";

/**
 * Regreso de Mercado Pago después de que la sede autorizó (o rechazó) la vinculación. El state tiene
 * que coincidir con la cookie cifrada que dejó «Conectar» en este navegador, y la sesión tiene que ser
 * la misma persona: si no, no se vincula nada. El permiso se vuelve a exigir al guardar.
 * El resultado se informa en la página de la sede con ?mp=…, sin detalles del error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const volver = (sedeId: string | null, resultado: string) =>
    NextResponse.redirect(new URL(sedeId ? `/sedes/${sedeId}?mp=${resultado}` : `/sedes?mp=${resultado}`, urlBackoffice()), 303);

  const pendiente = await consumirVinculacion(url.searchParams.get("state"));
  if (!pendiente) return volver(null, "vencido");
  const sesion = await sesionActual();
  if (!sesion || sesion.usuario.id !== pendiente.usuarioId) return volver(null, "vencido");
  // Quien autoriza puede cancelar en Mercado Pago: vuelve con error=access_denied y sin code.
  if (url.searchParams.get("error")) return volver(pendiente.sedeId, "cancelado");
  const code = url.searchParams.get("code");
  const app = aplicacionMercadoPago();
  if (!code || !app) return volver(pendiente.sedeId, "error");

  try {
    const tokens = await canjearCodigo(app, code);
    await vincularMercadoPago(db(), pendiente.usuarioId, pendiente.organizacionId, pendiente.sedeId, pendiente.ambiente, tokens);
    return volver(pendiente.sedeId, "vinculada");
  } catch (e) {
    if (e instanceof DatosInvalidos && e.message.includes("otra sede")) return volver(pendiente.sedeId, "duplicada");
    if (e instanceof AccesoDenegado) return volver(pendiente.sedeId, "sin-permiso");
    // Solo el mensaje: los errores de integrations nunca incluyen tokens ni el code.
    console.error("Vinculación de Mercado Pago", e instanceof Error ? e.message : e);
    return volver(pendiente.sedeId, "error");
  }
}
