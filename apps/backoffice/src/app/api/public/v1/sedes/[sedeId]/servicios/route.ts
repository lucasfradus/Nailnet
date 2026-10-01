import { serviciosPublicos } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { json, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
export async function GET(request: Request, { params }: { params: Promise<{ sedeId: string }> }) {
  try { return json(request, { servicios: await serviciosPublicos(db(), (await params).sedeId) }); }
  catch (e) { return responderError(request, e); }
}
