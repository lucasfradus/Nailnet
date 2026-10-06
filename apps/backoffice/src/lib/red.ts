import { ipCliente, origen } from "@nailnet/domain/red";

/**
 * IP del cliente según el proxy declarado: `TRUST_PROXY=true` y `CLIENTE_IP_HEADER` (en Railway,
 * `x-real-ip`). Ver la explicación en @nailnet/domain/red.
 */
export const ipDesdeCabeceras = (cabeceras: Headers) =>
  ipCliente(cabeceras, { confiarEnProxy: process.env.TRUST_PROXY === "true", cabecera: process.env.CLIENTE_IP_HEADER });

export { origen };

/** URL pública del backoffice para enlaces (invitaciones, recuperación). En Railway sale de su dominio. */
export const urlBackoffice = () =>
  origen(process.env.BACKOFFICE_URL) ?? origen(process.env.RAILWAY_PUBLIC_DOMAIN) ?? "http://localhost:3000";
