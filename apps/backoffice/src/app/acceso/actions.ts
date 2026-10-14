"use server";
import { redirect } from "next/navigation";
import { CredencialesInvalidas, DemasiadosIntentos, PasswordInvalida, TokenInvalido, cerrarSesion, iniciarSesion, restablecerPassword, solicitarRecuperacion } from "@nailnet/database/auth";
import { llaveroEntorno } from "@nailnet/database/configuracion";
import { CifradoNoConfigurado, type Llavero } from "@nailnet/domain/secretos";
import { db } from "@/lib/db";
import { recuperacionPorEmail } from "@/lib/emails";
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
  // Sin envío de emails habilitado no se emiten enlaces que nadie recibiría (la página tampoco ofrece el formulario).
  if (!recuperacionPorEmail()) return { ok: MENSAJE_RECUPERACION };
  const base = urlBackoffice();
  const enlace = (token: string) => `${base}/restablecer#${token}`;
  // P03: el email sale del worker por el outbox, con el enlace cifrado con el llavero del servidor. Sin
  // llavero (desarrollo fuera de Docker) se vuelve al aviso por consola; en producción falla cerrado.
  let llavero: Llavero | null = null;
  try { llavero = llaveroEntorno(); } catch (e) { if (!(e instanceof CifradoNoConfigurado) || process.env.NODE_ENV === "production") throw e; }
  const resultado = await solicitarRecuperacion(db(), { email: texto(form, "email"), ip: await ipCliente(), ...(llavero ? { envio: { enlace, llavero } } : {}) });
  if (resultado && !llavero) console.info(`[desarrollo, sin NAILNET_CLAVES_CIFRADO] Enlace de recuperación para ${resultado.email}: ${enlace(resultado.token)}`);
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
