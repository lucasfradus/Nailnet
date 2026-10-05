import { createHash } from "node:crypto";
import sharp from "sharp";
import { AccesoDenegado } from "@nailnet/domain";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos } from "./access.ts";

type Tx = Prisma.TransactionClient;

/** Límites de subida. Lo que se guarda siempre es la versión procesada, mucho más chica. */
export const LIMITES_IMAGEN = { bytesEntrada: 8 * 1024 * 1024, pixelesEntrada: 50_000_000 } as const;
const FORMATOS_ENTRADA = new Set(["jpeg", "png", "webp", "avif"]);

/**
 * Uso de la imagen. Servicio: hasta 1200 px de lado, sin recorte (el portal encuadra).
 * Retrato: cuadrado de 600 px tomado desde arriba, donde suele estar la cara. (La estrategia «attention»
 * de sharp elige la zona más contrastada y puede quedarse con la ropa y cortar la cabeza.)
 */
export type UsoImagen = "SERVICIO" | "RETRATO";
export type ImagenProcesada = { datos: Uint8Array<ArrayBuffer>; ancho: number; alto: number; sha256: string };

/**
 * Decodifica y vuelve a codificar a WebP. Rechaza lo que no sea una imagen válida (aunque la extensión
 * diga otra cosa), corrige la orientación y descarta metadatos: EXIF puede traer ubicación GPS o datos
 * del dispositivo, y la imagen se publica.
 */
export async function procesarImagen(entrada: Uint8Array, uso: UsoImagen): Promise<ImagenProcesada> {
  if (!entrada.byteLength) throw new DatosInvalidos("Elegí una imagen");
  if (entrada.byteLength > LIMITES_IMAGEN.bytesEntrada) throw new DatosInvalidos("La imagen supera los 8 MB");
  try {
    const origen = sharp(entrada, { limitInputPixels: LIMITES_IMAGEN.pixelesEntrada, failOn: "error" });
    const { format } = await origen.metadata();
    if (!format || !FORMATOS_ENTRADA.has(format)) throw new DatosInvalidos("Formato no admitido: usá JPG, PNG, WebP o AVIF");
    const redimensionada = uso === "RETRATO"
      ? origen.rotate().resize(600, 600, { fit: "cover", position: "top" })
      : origen.rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: true });
    const { data, info } = await redimensionada.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    const datos = new Uint8Array(data);
    return { datos, ancho: info.width, alto: info.height, sha256: createHash("sha256").update(datos).digest("hex") };
  } catch (e) {
    if (e instanceof DatosInvalidos) throw e;
    throw new DatosInvalidos("No pudimos leer la imagen. Probá con otro archivo JPG o PNG.");
  }
}

/** Guarda una imagen ya procesada. Llamar dentro de la transacción que la referencia. */
export async function insertarImagen(tx: Tx, organizacionId: string, actorId: string | null, imagen: ImagenProcesada) {
  const { id } = await tx.imagen.create({ data: { organizacionId, creadoPor: actorId, mime: "image/webp", ...imagen }, select: { id: true } });
  return id;
}

/** Borra una imagen que dejó de estar referenciada (después de actualizar la referencia). */
export async function borrarImagenHuerfana(tx: Tx, imagenId: string | null) {
  if (!imagenId) return;
  await tx.imagen.deleteMany({ where: { id: imagenId, servicios: { none: {} }, profesionales: { none: {} } } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ruta pública de una imagen, relativa al origen del backoffice. */
export const rutaImagen = (imagenId: string | null) => (imagenId ? `/api/public/v1/imagenes/${imagenId}` : null);

/**
 * Imagen para el portal: solo si está en uso por un servicio o profesional de una organización activa.
 * Inexistente, huérfana o de una organización inactiva: AccesoDenegado (404), sin distinguir.
 */
export async function imagenPublica(db: Database, imagenId: string) {
  if (!UUID.test(imagenId)) throw new AccesoDenegado();
  const imagen = await db.imagen.findFirst({
    where: { id: imagenId, organizacion: { activo: true }, OR: [{ servicios: { some: {} } }, { profesionales: { some: {} } }] },
    select: { datos: true, mime: true, sha256: true },
  });
  if (!imagen) throw new AccesoDenegado();
  return imagen;
}
