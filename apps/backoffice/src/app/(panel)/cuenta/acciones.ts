"use server";
import { revalidatePath } from "next/cache";
import { DatosInvalidos } from "@nailnet/database/access";
import { DemasiadosIntentos, PasswordInvalida } from "@nailnet/database/auth";
import { PasswordActualIncorrecta, cambiarMiEmail, cambiarMiNombre, cambiarMiPassword, cerrarOtrasSesiones } from "@nailnet/database/cuenta";
import type { Estado } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirSesion } from "@/lib/sesion";

// Todo sale de la sesión validada: el formulario nunca dice sobre qué usuario se opera.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
const conocido = (e: unknown) => e instanceof DatosInvalidos || e instanceof PasswordActualIncorrecta || e instanceof DemasiadosIntentos || e instanceof PasswordInvalida;

async function ejecutar(fn: (usuarioId: string, sesionId: string) => Promise<string>): Promise<Estado> {
  try {
    const sesion = await requerirSesion();
    const ok = await fn(sesion.usuario.id, sesion.sesionId);
    // El nombre se ve en el lateral de todas las pantallas.
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    if (conocido(e)) return { error: (e as Error).message };
    throw e;
  }
}

export async function accionMiNombre(_: Estado, form: FormData) {
  return ejecutar(async u => { await cambiarMiNombre(db(), u, texto(form, "nombre")); return "Nombre actualizado"; });
}

export async function accionMiEmail(_: Estado, form: FormData) {
  return ejecutar(async (u, s) => {
    await cambiarMiEmail(db(), u, s, { email: texto(form, "email"), password: texto(form, "password") });
    return "Email actualizado. Desde ahora ingresás con el nuevo; se cerraron tus sesiones en otros dispositivos.";
  });
}

export async function accionMiPassword(_: Estado, form: FormData) {
  const nueva = texto(form, "nueva");
  if (nueva !== texto(form, "confirmacion")) return { error: "Las contraseñas nuevas no coinciden" };
  return ejecutar(async (u, s) => {
    await cambiarMiPassword(db(), u, s, { actual: texto(form, "actual"), nueva });
    return "Contraseña actualizada. Se cerraron tus sesiones en otros dispositivos.";
  });
}

export async function accionCerrarOtrasSesiones() {
  return ejecutar(async (u, s) => {
    const n = await cerrarOtrasSesiones(db(), u, s);
    return n ? `Se ${n === 1 ? "cerró 1 sesión" : `cerraron ${n} sesiones`} en otros dispositivos.` : "No tenías otras sesiones abiertas.";
  });
}
