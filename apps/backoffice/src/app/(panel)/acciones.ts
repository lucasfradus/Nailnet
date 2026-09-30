"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AccesoDenegado, type Asignacion } from "@nailnet/domain";
import { DatosInvalidos, actualizarSede, cambiarEstadoSede, crearFranquiciado, crearSede, listarSedes } from "@nailnet/database/access";
import { cambiarEstadoUsuario, crearUsuario, emitirInvitacion, otorgarRol, revocarRol } from "@nailnet/database/usuarios";
import { db } from "@/lib/db";
import { COOKIE_ORGANIZACION, COOKIE_SEDE, requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// Cada acción obtiene actor y organización de la sesión validada; los IDs del formulario solo
// indican el objetivo y el repositorio vuelve a autorizarlos.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
const produccion = process.env.NODE_ENV === "production";

async function ejecutar(ruta: string, fn: (actorId: string, organizacionId: string) => Promise<string | void>, exito: string): Promise<Estado> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    const mensaje = await fn(sesion.usuario.id, organizacion.id);
    revalidatePath(ruta);
    return { ok: mensaje || exito };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
}

/** Codifica una asignación ofrecida en un <select>; el servidor la valida completa al recibirla. */
function leerAsignacion(valor: string): Asignacion {
  const [rol, alcance, franquiciadoId, sedeId] = valor.split("|");
  return { rol, alcance, franquiciadoId: franquiciadoId || null, sedeId: sedeId || null } as Asignacion;
}

export async function elegirContexto(form: FormData) {
  const { sesion, organizaciones } = await requerirOrganizacion();
  const almacen = await cookies();
  const opciones = { httpOnly: true, secure: produccion, sameSite: "lax" as const, path: "/" };
  const organizacionId = texto(form, "organizacionId");
  if (organizacionId) {
    if (!organizaciones.some(o => o.id === organizacionId)) throw new AccesoDenegado();
    almacen.set(COOKIE_ORGANIZACION, organizacionId, opciones);
    almacen.delete(COOKIE_SEDE);
  }
  const sedeId = texto(form, "sedeId");
  if (form.has("sedeId")) {
    if (!sedeId) almacen.delete(COOKIE_SEDE);
    else {
      // Rechaza una sede fuera de alcance en lugar de ignorarla en silencio.
      const actual = organizacionId || almacen.get(COOKIE_ORGANIZACION)?.value || organizaciones[0]!.id;
      await listarSedes(db(), sesion.usuario.id, actual, { sedeId });
      almacen.set(COOKIE_SEDE, sedeId, opciones);
    }
  }
  revalidatePath("/", "layout");
}

export async function accionCrearSede(_: Estado, form: FormData) {
  return ejecutar("/sedes", async (actor, org) => { await crearSede(db(), actor, org, { franquiciadoId: texto(form, "franquiciadoId"), nombre: texto(form, "nombre"), timezone: texto(form, "timezone") || undefined }); }, "Sede creada");
}
export async function accionActualizarSede(_: Estado, form: FormData) {
  return ejecutar("/sedes", (actor, org) => actualizarSede(db(), actor, org, texto(form, "sedeId"), { nombre: texto(form, "nombre"), timezone: texto(form, "timezone") }), "Cambios guardados");
}
export async function accionEstadoSede(_: Estado, form: FormData) {
  const activo = texto(form, "activo") === "true";
  return ejecutar("/sedes", (actor, org) => cambiarEstadoSede(db(), actor, org, texto(form, "sedeId"), activo), activo ? "Sede reactivada" : "Sede desactivada");
}
export async function accionCrearFranquiciado(_: Estado, form: FormData) {
  return ejecutar("/sedes", async (actor, org) => { await crearFranquiciado(db(), actor, org, texto(form, "nombre")); }, "Franquiciado creado");
}

export async function accionCrearUsuario(_: Estado, form: FormData) {
  return ejecutar("/usuarios", async (actor, org) => {
    const r = await crearUsuario(db(), actor, org, { email: texto(form, "email"), nombre: texto(form, "nombre"), asignacion: leerAsignacion(texto(form, "asignacion")) });
    return r.nuevo ? "Usuario creado. Generá su enlace de activación desde la lista." : "El usuario ya existía en otra organización; se le dio acceso con su cuenta actual.";
  }, "Usuario creado");
}
export async function accionOtorgarRol(_: Estado, form: FormData) {
  return ejecutar("/usuarios", (actor, org) => otorgarRol(db(), actor, org, texto(form, "usuarioId"), leerAsignacion(texto(form, "asignacion"))), "Rol agregado");
}
export async function accionRevocarRol(_: Estado, form: FormData) {
  return ejecutar("/usuarios", (actor, org) => revocarRol(db(), actor, org, texto(form, "asignacionId")), "Rol quitado");
}
export async function accionEstadoUsuario(_: Estado, form: FormData) {
  const activo = texto(form, "activo") === "true";
  return ejecutar("/usuarios", (actor, org) => cambiarEstadoUsuario(db(), actor, org, texto(form, "usuarioId"), activo), activo ? "Usuario reactivado" : "Usuario desactivado");
}
export async function accionInvitar(_: Estado, form: FormData) {
  return ejecutar("/usuarios", async (actor, org) => {
    const { token, expiraEn } = await emitirInvitacion(db(), actor, org, texto(form, "usuarioId"));
    const base = process.env.BACKOFFICE_URL ?? "http://localhost:3000";
    // Se muestra una sola vez a quien lo generó; no se guarda ni se registra.
    return `Enlace de activación (vence ${expiraEn.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}): ${base}/restablecer#${token}`;
  }, "");
}
