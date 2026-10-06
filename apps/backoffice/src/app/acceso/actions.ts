"use server";
import { redirect } from "next/navigation";
import { CredencialesInvalidas, DemasiadosIntentos, PasswordInvalida, TokenInvalido, cerrarSesion, iniciarSesion, restablecerPassword, solicitarRecuperacion } from "@nailnet/database/auth";
import { db } from "@/lib/db";
import { urlBackoffice } from "@/lib/red";
import { borrarCookieSesion, guardarCookieSesion, ipCliente, leerTokenSesion } from "@/lib/sesion";

export type EstadoFormulario = { error?: string; ok?: string } | undefined;
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
const conocido = (e: unknown) => e instanceof CredencialesInvalidas || e instanceof DemasiadosIntentos || e instanceof PasswordInvalida || e instanceof TokenInvalido;

// Next.js rechaza Server Actions cuyo Origin no coincide con el Host: protección CSRF de estos formularios.
export async function ingresar(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  try {
    const { token, expiraEn } = await iniciarSesion(db(), { email: texto(form, "email"), password: texto(form, "password"), ip: await ipCliente() });
    await guardarCookieSesion(token, expiraEn);
  } catch (e) {
    if (conocido(e)) return { error: (e as Error).message };
    throw e;
  }
  redirect("/");
}

export async function salir() {
  await cerrarSesion(db(), await leerTokenSesion());
  await borrarCookieSesion();
  redirect("/login");
}

const MENSAJE_RECUPERACION = "Si el email corresponde a un usuario habilitado, vas a recibir un enlace válido por 30 minutos.";
export async function recuperar(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const resultado = await solicitarRecuperacion(db(), { email: texto(form, "email"), ip: await ipCliente() });
  // El envío por email llega con Resend y el outbox del worker (P03/F04). Hasta entonces el enlace
  // solo se muestra en la consola de desarrollo; en producción la página no ofrece este formulario.
  if (resultado && process.env.NODE_ENV !== "production") {
    const base = urlBackoffice();
    console.info(`[desarrollo] Enlace de recuperación para ${resultado.email}: ${base}/restablecer#${resultado.token}`);
  }
  return { ok: MENSAJE_RECUPERACION };
}

export async function restablecer(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const password = texto(form, "password");
  if (password !== texto(form, "confirmacion")) return { error: "Las contraseñas no coinciden" };
  try {
    await restablecerPassword(db(), texto(form, "token"), password);
  } catch (e) {
    if (conocido(e)) return { error: (e as Error).message };
    throw e;
  }
  return { ok: "Contraseña actualizada. Ya podés ingresar." };
}
