import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Solo servidor. Parámetros scrypt de la guía OWASP (N=2^15, r=8, p=3; ~32 MiB por hash).
// El formato versionado permite endurecerlos después y rehashear al iniciar sesión.
const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const LONGITUD = 64;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

function derivar(password: string, salt: Buffer, p: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...p, maxmem: 128 * p.N * p.r * 2 };
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, LONGITUD, options, (e, key) => e ? reject(e) : resolve(key)));
}

/** Longitud por sobre composición (NIST 800-63B). Devuelve el motivo o null si es válida. */
export function validarPassword(password: string): string | null {
  const largo = [...password.normalize("NFKC")].length;
  if (largo < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
  if (largo > PASSWORD_MAX) return `La contraseña no puede superar ${PASSWORD_MAX} caracteres`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const motivo = validarPassword(password);
  if (motivo) throw new Error(motivo);
  const salt = randomBytes(16);
  const key = await derivar(password, salt, PARAMS);
  return ["scrypt", "v1", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// Hash descartable para igualar el tiempo de respuesta cuando el usuario no existe.
let senuelo: Promise<string> | undefined;
export function hashSenuelo(): Promise<string> {
  return senuelo ??= hashPassword(randomBytes(24).toString("base64url"));
}

/** Compara en tiempo constante. Un hash con formato desconocido nunca valida. */
export async function verificarPassword(password: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split("$");
  if (partes.length !== 7 || partes[0] !== "scrypt" || partes[1] !== "v1") return false;
  const [N, r, p] = partes.slice(2, 5).map(Number);
  if (!N || !r || !p || N > 2 ** 20 || r > 16 || p > 16 || [...password].length > PASSWORD_MAX) return false;
  const esperado = Buffer.from(partes[6]!, "base64url");
  if (esperado.length !== LONGITUD) return false;
  const key = await derivar(password, Buffer.from(partes[5]!, "base64url"), { N, r, p });
  return timingSafeEqual(key, esperado);
}

export function requiereRehash(almacenado: string): boolean {
  return !almacenado.startsWith(`scrypt$v1$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$`);
}

/** Token opaco para el navegador; en base solo se guarda su hash. */
export function generarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function normalizarEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}
