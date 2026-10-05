import { terminosPublicos } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { json, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
/** Texto de los términos que se aceptan al reservar; el portal los muestra antes de confirmar. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return json(request, { terminos: await terminosPublicos(db(), (await params).slug) }); }
  catch (e) { return responderError(request, e); }
}
