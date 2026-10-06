/** Lo mínimo de una colección de cabeceras HTTP (Headers de fetch o de Next). */
type Cabeceras = { get(nombre: string): string | null };

/**
 * IP del cliente para límites de intentos. Solo se confía en una cabecera si el despliegue declara un
 * proxy propio delante: sin él, cualquiera puede inventarla.
 *
 * `cabecera` elige cuál. En Railway es `x-real-ip`, que fija el edge. `x-forwarded-for` (predeterminada)
 * solo sirve detrás de un proxy que la reescribe: si la agrega en vez de reemplazarla, el primer valor
 * lo controla el cliente.
 */
export function ipCliente(cabeceras: Cabeceras, config: { confiarEnProxy: boolean; cabecera?: string | null }): string | null {
  if (!config.confiarEnProxy) return null;
  const nombre = (config.cabecera?.trim() || "x-forwarded-for").toLowerCase();
  const valor = cabeceras.get(nombre);
  if (!valor) return null;
  const ip = (nombre === "x-forwarded-for" ? valor.split(",")[0] : valor)?.trim();
  // Una IP (v4 o v6), no texto arbitrario: el valor se usa como clave de límites.
  return ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/**
 * Origen a partir de una variable que puede traer el origen completo o solo el dominio (las referencias
 * de Railway, como `RAILWAY_PUBLIC_DOMAIN`, no traen esquema). Sin esquema se asume https.
 */
export function origen(valor: string | undefined | null): string | null {
  const v = valor?.trim().replace(/\/+$/, "");
  if (!v) return null;
  return /^https?:\/\//.test(v) ? v : `https://${v}`;
}
