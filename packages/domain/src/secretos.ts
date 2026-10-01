import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Solo servidor. Cifrado AES-256-GCM con versión de clave: permite rotar sin perder lo guardado.
// El contexto (sede/proveedor/ambiente) va como dato asociado: un secreto copiado a otra fila no descifra.
export type Llavero = { activa: string; claves: ReadonlyMap<string, Buffer> };

export class CifradoNoConfigurado extends Error {
  constructor() { super("El cifrado de secretos no está configurado en este entorno"); this.name = "CifradoNoConfigurado"; }
}
export class SecretoIlegible extends Error {
  constructor() { super("No se pudo descifrar el secreto"); this.name = "SecretoIlegible"; }
}

/** Formato: `v1:<base64 de 32 bytes>;v2:<...>` y versión activa aparte. */
export function llaveroDesde(claves: string | undefined, activa: string | undefined): Llavero {
  if (!claves || !activa) throw new CifradoNoConfigurado();
  const mapa = new Map<string, Buffer>();
  for (const parte of claves.split(";").map(p => p.trim()).filter(Boolean)) {
    const [version, valor] = parte.split(":");
    const clave = Buffer.from(valor ?? "", "base64");
    if (!version || !/^v\d+$/.test(version) || clave.length !== 32) throw new CifradoNoConfigurado();
    mapa.set(version, clave);
  }
  if (!mapa.has(activa)) throw new CifradoNoConfigurado();
  return { activa, claves: mapa };
}

export function cifrar(llavero: Llavero, texto: string, contexto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", llavero.claves.get(llavero.activa)!, iv);
  cipher.setAAD(Buffer.from(contexto, "utf8"));
  const datos = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return ["gcm", llavero.activa, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), datos.toString("base64url")].join(".");
}

export function versionDe(cifrado: string): string | undefined {
  return cifrado.split(".")[1];
}

export function descifrar(llavero: Llavero, cifrado: string, contexto: string): string {
  const [formato, version, iv, tag, datos] = cifrado.split(".");
  const clave = version ? llavero.claves.get(version) : undefined;
  if (formato !== "gcm" || !clave || !iv || !tag || datos === undefined) throw new SecretoIlegible();
  try {
    const decipher = createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(contexto, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(datos, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new SecretoIlegible(); }
}

/** Últimos 4 caracteres para reconocer qué credencial está cargada, sin exponerla. */
export function pista(valor: string): string {
  return valor.length <= 8 ? "••••" : `••••${valor.slice(-4)}`;
}

const SENSIBLE = /(token|secret|password|contrase|clave|key|authorization|cookie|credencial)/i;
/** Copia profunda que reemplaza valores de claves sensibles. Para logs, auditoría y respuestas. */
export function redactar<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(redactar) as T;
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, SENSIBLE.test(k) ? "[redactado]" : redactar(v)])) as T;
  }
  return valor;
}

export type Proveedor = "MERCADO_PAGO" | "FACTURANTE";
type Campo = { nombre: string; etiqueta: string; formato: RegExp; ayuda?: string };
/**
 * Campos por proveedor. Los públicos se guardan en claro y pueden mostrarse; los secretos, cifrados
 * y nunca vuelven al navegador. cuentaExterna identifica la cuenta en el proveedor para impedir
 * que dos sedes compartan la misma cuenta receptora (D8).
 */
export const ESQUEMAS: Record<Proveedor, { publicos: Campo[]; secretos: Campo[]; cuentaExterna?: string }> = {
  MERCADO_PAGO: {
    publicos: [
      { nombre: "cuentaId", etiqueta: "ID de cuenta (user_id)", formato: /^\d{3,20}$/ },
      { nombre: "publicKey", etiqueta: "Public key", formato: /^(APP_USR|TEST)-\S{8,200}$/ },
    ],
    secretos: [
      { nombre: "accessToken", etiqueta: "Access token", formato: /^(APP_USR|TEST)-\S{20,400}$/ },
      { nombre: "webhookSecret", etiqueta: "Clave secreta de notificaciones", formato: /^\S{16,256}$/ },
    ],
    cuentaExterna: "cuentaId",
  },
  FACTURANTE: {
    publicos: [
      { nombre: "companyId", etiqueta: "Company ID", formato: /^\d{1,10}$/ },
      { nombre: "subsidiaryId", etiqueta: "Subsidiary ID", formato: /^\d{1,10}$/ },
    ],
    secretos: [
      { nombre: "usuario", etiqueta: "Usuario", formato: /^\S{3,120}$/ },
      { nombre: "password", etiqueta: "Contraseña", formato: /^.{6,200}$/ },
    ],
  },
};

/** Valida y separa los campos recibidos; devuelve el primer error legible o los datos listos. */
export function validarCredencial(proveedor: Proveedor, entrada: Record<string, string>): { error: string } | { publicos: Record<string, string>; secretos: Record<string, string>; cuentaExterna: string | null } {
  const esquema = ESQUEMAS[proveedor];
  if (!esquema) return { error: "Proveedor desconocido" };
  const leer = (campos: Campo[]) => {
    const out: Record<string, string> = {};
    for (const c of campos) {
      const v = (entrada[c.nombre] ?? "").trim();
      if (!c.formato.test(v)) return `${c.etiqueta}: formato inválido`;
      out[c.nombre] = v;
    }
    return out;
  };
  const publicos = leer(esquema.publicos);
  if (typeof publicos === "string") return { error: publicos };
  const secretos = leer(esquema.secretos);
  if (typeof secretos === "string") return { error: secretos };
  return { publicos, secretos, cuentaExterna: esquema.cuentaExterna ? publicos[esquema.cuentaExterna]! : null };
}
