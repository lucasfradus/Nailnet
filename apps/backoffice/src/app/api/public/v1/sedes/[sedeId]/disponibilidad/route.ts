import { disponibilidadPublica } from "@nailnet/database/publico";
import { db } from "@/lib/db";
import { invalido, json, opciones, responderError } from "@/lib/publico";

export const OPTIONS = opciones;
/** ?fecha=AAAA-MM-DD&servicio=<id>&profesional=<id|vacío> (servicio y profesional repetibles, en orden). */
export async function GET(request: Request, { params }: { params: Promise<{ sedeId: string }> }) {
  try {
    const q = new URL(request.url).searchParams;
    const servicios = q.getAll("servicio"), profesionales = q.getAll("profesional");
    if (!q.get("fecha") || !servicios.length || servicios.length > 4) return invalido(request, "Indicá fecha y entre 1 y 4 servicios");
    const items = servicios.map((servicioId, i) => ({ servicioId, profesionalId: profesionales[i] || null }));
    return json(request, { turnos: await disponibilidadPublica(db(), (await params).sedeId, q.get("fecha")!, items) });
  } catch (e) { return responderError(request, e); }
}
