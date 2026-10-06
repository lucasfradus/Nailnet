import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { validarSesion } from "@nailnet/database/auth";
import { db } from "./db";
import { ipDesdeCabeceras } from "./red";

const produccion = process.env.NODE_ENV === "production";
// __Host- exige Secure, Path=/ y sin Domain: la cookie no se comparte con subdominios.
export const COOKIE_SESION = produccion ? "__Host-nailnet_sesion" : "nailnet_sesion";

export async function guardarCookieSesion(token: string, expiraEn: Date) {
  (await cookies()).set(COOKIE_SESION, token, { httpOnly: true, secure: produccion, sameSite: "lax", path: "/", expires: expiraEn });
}
export async function leerTokenSesion() {
  return (await cookies()).get(COOKIE_SESION)?.value;
}
export async function borrarCookieSesion() {
  (await cookies()).delete({ name: COOKIE_SESION, path: "/", secure: produccion });
}

/** Se revalida contra la base en cada request; cache() solo evita repetirlo dentro del mismo render. */
export const sesionActual = cache(async () => {
  const token = await leerTokenSesion();
  return token ? validarSesion(db(), token) : null;
});

export async function requerirSesion() {
  const sesion = await sesionActual();
  if (!sesion) redirect("/login");
  return sesion;
}

/** IP del cliente según la configuración del proxy (ver red.ts). */
export async function ipCliente(): Promise<string | null> {
  return ipDesdeCabeceras(await headers());
}
