import { sedesPublicas } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { json, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return json(request, { sedes: await sedesPublicas(db(), (await params).slug) }); }
  catch (e) { return responderError(request, e); }
}
