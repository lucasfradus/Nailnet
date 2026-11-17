/**
 * Dirección de la sede en el portal de reservas (`/lomada`): se comparte con las clientas, así que se
 * genera una vez desde el nombre y no cambia sola al renombrar la sede (rompería los links ya enviados).
 */
export const LARGO_MAXIMO_SLUG = 60;

/**
 * Rutas que el portal usa o va a usar para otra cosa. Las rutas con extensión (archivos) nunca chocan:
 * el servidor del portal las resuelve antes.
 */
const RESERVADAS = new Set(["assets", "api", "mis-turnos", "turnos", "reserva", "reservas", "sedes"]);

/** «Lomada Sur» → «lomada-sur»; «Nuñez» → «nunez». Puede devolver vacío si el nombre no tiene letras ni números. */
export function slugDesdeNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LARGO_MAXIMO_SLUG).replace(/-+$/, "");
}

/** Motivo por el que no sirve, o null si es válido. */
export function problemaSlug(slug: string): string | null {
  if (!slug) return "La dirección no puede quedar vacía";
  if (slug.length > LARGO_MAXIMO_SLUG) return `La dirección admite hasta ${LARGO_MAXIMO_SLUG} caracteres`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "La dirección solo admite minúsculas sin acentos, números y guiones entre palabras";
  if (RESERVADAS.has(slug)) return "Esa dirección está reservada por el portal";
  return null;
}

/**
 * Primer slug libre para el nombre: el propio, o con sufijo numérico (`lomada-2`) si ya lo usa otra sede
 * de la organización o es una ruta reservada.
 */
export function slugLibre(nombre: string, ocupados: ReadonlySet<string>): string {
  const base = slugDesdeNombre(nombre) || "sede";
  const libre = (s: string) => !ocupados.has(s) && problemaSlug(s) === null;
  if (libre(base)) return base;
  for (let n = 2; ; n++) {
    const sufijo = `-${n}`;
    const candidato = base.slice(0, LARGO_MAXIMO_SLUG - sufijo.length).replace(/-+$/, "") + sufijo;
    if (libre(candidato)) return candidato;
  }
}
