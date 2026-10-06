import { NextResponse } from "next/server";
import { imagenPublica } from "@nailnet/database/imagenes";
import { db } from "@/lib/db";
import { responderError } from "@/lib/publico";

/**
 * Imagen de servicio o profesional para el portal. Inmutable: reemplazar una imagen crea otro id,
 * así que se puede cachear un año. Solo se sirve mientras está en uso (si no, 404 `no-store`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ imagenId: string }> }) {
  try {
    const imagen = await imagenPublica(db(), (await params).imagenId);
    const etag = `"${imagen.sha256}"`;
    const cabeceras = {
      "Content-Type": imagen.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": etag,
      // El portal vive en otro origen; la imagen nunca se interpreta como documento.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: cabeceras });
    return new NextResponse(imagen.datos, { headers: cabeceras });
  } catch (e) { return responderError(request, e); }
}
