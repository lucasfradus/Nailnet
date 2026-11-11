import type { Universo } from "@nailnet/domain/catalogo";

// Universos de recepción (doc 31). El slug va en la URL del tablero (`?u=`) y en la cookie que lo recuerda.
export const UNIVERSO: Record<Universo, string> = { MANOS_PIES: "Manos y pies", TRATAMIENTOS: "Tratamientos" };
export const UNIVERSO_SLUG: Record<Universo, string> = { MANOS_PIES: "manos", TRATAMIENTOS: "tratamientos" };
export const COOKIE_UNIVERSO = "nailnet_universo";

export const ROLES: Record<string, string> = { MASTER_FRANQUICIADOR: "Master franquiciador", FRANQUICIADO: "Franquiciado", ADMIN_SEDE: "Administración de sede", RECEPCIONISTA: "Recepción", PROFESIONAL: "Profesional" };

// Zonas horarias ofrecidas en formularios; el servidor acepta cualquier IANA válida.
export const ZONAS = ["America/Argentina/Buenos_Aires", "America/Argentina/Cordoba", "America/Argentina/Mendoza", "America/Argentina/Salta", "America/Argentina/Ushuaia", "America/Montevideo", "America/Santiago", "America/Asuncion"];
