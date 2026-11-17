import type { Universo } from "@nailnet/domain/catalogo";

// Universos de recepción (doc 31). El slug va en la URL del tablero (`?u=`) y en la cookie que lo recuerda.
export const UNIVERSO: Record<Universo, string> = { MANOS_PIES: "Manos y pies", TRATAMIENTOS: "Tratamientos" };
export const UNIVERSO_SLUG: Record<Universo, string> = { MANOS_PIES: "manos", TRATAMIENTOS: "tratamientos" };
export const COOKIE_UNIVERSO = "nailnet_universo";

export const ROLES: Record<string, string> = { MASTER_FRANQUICIADOR: "Master franquiciador", FRANQUICIADO: "Franquiciado", ADMIN_SEDE: "Administración de sede", RECEPCIONISTA: "Recepción", PROFESIONAL: "Profesional" };

// Zonas horarias ofrecidas en formularios; el servidor acepta cualquier IANA válida.
export const ZONAS = ["America/Argentina/Buenos_Aires", "America/Argentina/Cordoba", "America/Argentina/Mendoza", "America/Argentina/Salta", "America/Argentina/Ushuaia", "America/Montevideo", "America/Santiago", "America/Asuncion"];

const TZ_PANEL = "America/Argentina/Buenos_Aires";
export const fechaHora = (d: Date) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ_PANEL, dateStyle: "short", timeStyle: "short" }).format(d);
const diaLocal = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PANEL }).format(d);

/** «Hoy 14:30», «Ayer», «Hace 5 días» o la fecha; para leer de un vistazo cuándo entró alguien por última vez. */
export function ultimoIngreso(d: Date | null, ahora = new Date()): string {
  if (!d) return "Nunca ingresó";
  const dias = Math.round((Date.parse(diaLocal(ahora)) - Date.parse(diaLocal(d))) / 86_400_000);
  if (dias <= 0) return `Hoy ${new Intl.DateTimeFormat("es-AR", { timeZone: TZ_PANEL, timeStyle: "short" }).format(d)}`;
  if (dias === 1) return "Ayer";
  if (dias < 30) return `Hace ${dias} días`;
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ_PANEL, dateStyle: "medium" }).format(d);
}
