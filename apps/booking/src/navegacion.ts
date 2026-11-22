import type { ProfesionalPublico, SedePublica, ServicioPublico, TurnoPublico } from "@nailnet/contracts/publico";

export type Seleccion = {
  /** `sedeFija`: la sede no se elige (es la única, o llegó en el link: `/lomada`) y el recorrido arranca en el servicio. */
  sede?: SedePublica; sedeFija?: boolean; servicio?: ServicioPublico;
  /** `null` es «cualquier profesional» (D16); `undefined`, todavía sin elegir. */
  profesional?: ProfesionalPublico | null;
  fecha?: string; turno?: TurnoPublico;
};
export type NombrePaso = "sede" | "servicio" | "profesional" | "horario" | "datos";
export const ORDEN: NombrePaso[] = ["sede", "servicio", "profesional", "horario", "datos"];
export const NOMBRES: Record<NombrePaso, string> = { sede: "Sede", servicio: "Servicio", profesional: "Profesional", horario: "Día y horario", datos: "Tus datos" };

/** Lo que deja resuelto cada paso: el siguiente solo se puede mostrar si esto se cumple. */
const RESUELTO: Record<NombrePaso, (s: Seleccion) => boolean> = {
  sede: s => !!s.sede, servicio: s => !!s.servicio, profesional: s => s.profesional !== undefined, horario: s => !!s.turno, datos: () => false,
};

/**
 * Paso que corresponde mostrar: el pedido, salvo que falte algo de un paso anterior (por ejemplo, al avanzar
 * con el navegador hacia una entrada de una reserva ya descartada). Contador, resumen y contenido salen de acá.
 */
export function pasoVisible(paso: NombrePaso, sel: Seleccion, primero: NombrePaso): NombrePaso {
  const desde = ORDEN.indexOf(primero);
  if (ORDEN.indexOf(paso) <= desde) return primero;
  return ORDEN.slice(desde, ORDEN.indexOf(paso)).find(p => !RESUELTO[p](sel)) ?? paso;
}

/**
 * Cada paso es una entrada del historial del navegador, así el «atrás» del navegador o del celular vuelve un
 * paso en lugar de salir del sitio. La entrada guarda también la selección para sobrevivir a una recarga; los
 * datos de contacto no se guardan (el historial puede persistir en disco).
 */
/**
 * Sede pedida en la ruta (`/lomada` o `/lomada/`), en minúsculas. La ruta refleja siempre la sede elegida, así
 * que un link copiado en cualquier paso abre esa sede.
 */
export function slugDeRuta(ruta: string): string | null {
  try { return decodeURIComponent(ruta.split("/").find(Boolean) ?? "").trim().toLowerCase() || null; }
  catch { return null; }
}
export const rutaDeSede = (sede: SedePublica | undefined) => (sede ? `/${encodeURIComponent(sede.slug)}` : "/");

type Entrada = { paso: NombrePaso; sel: Seleccion };
const CLAVE = "nailnet.paso";
export const entradaHistorial = (paso: NombrePaso, sel: Seleccion) => ({ [CLAVE]: { paso, sel } satisfies Entrada });
export function leerEntrada(estado: unknown): Entrada | null {
  const e = (estado as Record<string, Entrada | undefined> | null)?.[CLAVE];
  return e && ORDEN.includes(e.paso) && e.sel && typeof e.sel === "object" ? e : null;
}
