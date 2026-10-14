import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cifrar, descifrar } from "@nailnet/domain/secretos";
import { llaveroEntorno } from "@nailnet/database/configuracion";
import type { PasarelaMercadoPago } from "@nailnet/database/pagos";
import { crearPreferencia, obtenerPago, refrescarTokens, urlAutorizacion, type AplicacionMercadoPago } from "@nailnet/integrations/mercadopago";
import { urlBackoffice } from "./red";

/**
 * Aplicación de Mercado Pago de NailNet, desde el entorno. Null si este entorno no la tiene: la
 * vinculación queda deshabilitada y los cobros usan el token guardado sin renovarlo.
 * La redirect URI tiene que estar registrada tal cual en la aplicación de Mercado Pago.
 */
export function aplicacionMercadoPago(): AplicacionMercadoPago | null {
  const clientId = process.env.MP_APP_ID, clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: process.env.MP_REDIRECT_URI || `${urlBackoffice()}/api/mercadopago/callback` };
}

/** Mercado Pago real para las rutas del servidor. Las pruebas de base usan una pasarela falsa. */
export const pasarela: PasarelaMercadoPago = {
  crearPreferencia: (token, preferencia, ambiente) => crearPreferencia(token, preferencia, ambiente),
  obtenerPago: (token, id) => obtenerPago(token, id),
  renovarTokens: refreshToken => {
    const app = aplicacionMercadoPago();
    if (!app) return Promise.reject(new Error("La aplicación de Mercado Pago no está configurada"));
    return refrescarTokens(app, refreshToken);
  },
};

// ─── Vinculación por OAuth ────────────────────────────────────────────────────
//
// El `state` que viaja a Mercado Pago es un valor al azar. Lo que identifica a quién vincula qué
// sede queda en una cookie cifrada, atada a este navegador: un link de autorización armado por
// otra persona no puede vincular su cuenta a una sede ajena, porque no trae la cookie.

const produccion = process.env.NODE_ENV === "production";
const COOKIE = produccion ? "__Host-nailnet_mp_oauth" : "nailnet_mp_oauth";
const CONTEXTO = "oauth|MERCADO_PAGO";
const VIGENCIA_S = 600;
type Pendiente = { state: string; usuarioId: string; organizacionId: string; sedeId: string; ambiente: string; expira: number };

/** Guarda la vinculación pendiente y devuelve la URL de autorización de Mercado Pago. */
export async function iniciarVinculacion(app: AplicacionMercadoPago, datos: Omit<Pendiente, "state" | "expira">): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const valor = cifrar(llaveroEntorno(), JSON.stringify({ ...datos, state, expira: Date.now() + VIGENCIA_S * 1000 } satisfies Pendiente), CONTEXTO);
  // Lax: la cookie viaja en la navegación de vuelta desde Mercado Pago (GET de nivel superior).
  (await cookies()).set(COOKIE, valor, { httpOnly: true, secure: produccion, sameSite: "lax", path: "/", maxAge: VIGENCIA_S });
  return urlAutorizacion(app, state);
}

/** Lee y borra la vinculación pendiente. Null si no hay, venció o el state no coincide. Se usa una sola vez. */
export async function consumirVinculacion(state: string | null): Promise<Pendiente | null> {
  const almacen = await cookies();
  const valor = almacen.get(COOKIE)?.value;
  almacen.delete({ name: COOKIE, path: "/", secure: produccion });
  if (!valor || !state) return null;
  let p: Pendiente;
  try { p = JSON.parse(descifrar(llaveroEntorno(), valor, CONTEXTO)) as Pendiente; } catch { return null; }
  const a = Buffer.from(p.state), b = Buffer.from(state);
  if (p.expira < Date.now() || a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return p;
}
