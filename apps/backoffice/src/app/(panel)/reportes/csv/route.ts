import { NextResponse } from "next/server";
import { AccesoDenegado } from "@nailnet/domain";
import { aCsv } from "@nailnet/domain/reportes";
import { DatosInvalidos } from "@nailnet/database/access";
import { reporteSede } from "@nailnet/database/reportes";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { TABLAS, esSeccion } from "../tablas";

const archivo = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/** Una tabla del reporte en CSV, con el mismo alcance que la pantalla: la sede elegida y `reporte:leer`. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const seccion = q.get("seccion");
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verReportes || !sede || !esSeccion(seccion)) return new NextResponse("No encontrado", { status: 404 });
  try {
    const reporte = await reporteSede(db(), sesion.usuario.id, organizacion.id, { sedeId: sede.id, desde: q.get("desde") ?? "", hasta: q.get("hasta") ?? "" });
    const tabla = TABLAS[seccion](reporte);
    return new NextResponse(aCsv(tabla.encabezados, tabla.filas), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${archivo(`${seccion} ${sede.nombre} ${reporte.desde} ${reporte.hasta}`)}.csv"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (e) {
    if (e instanceof AccesoDenegado) return new NextResponse("No encontrado", { status: 404 });
    if (e instanceof DatosInvalidos) return new NextResponse(e.message, { status: 400 });
    throw e;
  }
}
