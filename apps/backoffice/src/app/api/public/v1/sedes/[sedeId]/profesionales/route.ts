import { profesionalesPublicos } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { json, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
export async function GET(request: Request, { params }: { params: Promise<{ sedeId: string }> }) {
  try {
    const servicioId = new URL(request.url).searchParams.get("servicioId");
    return json(request, { profesionales: await profesionalesPublicos(db(), (await params).sedeId, servicioId) });
  } catch (e) { return responderError(request, e); }
}
