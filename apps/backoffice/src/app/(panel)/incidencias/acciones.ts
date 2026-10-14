"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { registrarAccionIncidencia } from "@nailnet/database/incidencias";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";
import { EXITO } from "./formato";

// Incidencias (M04). Acción delgada: actor y organización salen de la sesión validada; fuente, id y
// acción del formulario solo indican el objetivo y el repositorio vuelve a autorizarlos y validarlos.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

export async function accionIncidencia(_: Estado, form: FormData): Promise<Estado> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    const accion = texto(form, "accion");
    await registrarAccionIncidencia(db(), sesion.usuario.id, organizacion.id, { fuente: texto(form, "fuente"), id: texto(form, "id"), accion, nota: texto(form, "nota") });
    // El aviso del lateral y del inicio también cambia.
    revalidatePath("/", "layout");
    return { ok: EXITO[accion as keyof typeof EXITO] ?? "Acción registrada" };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
}
