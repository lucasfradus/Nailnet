"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { actualizarCategoriaGasto, anularGasto, crearCategoriaGasto, registrarGasto } from "@nailnet/database/gastos";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// O04. Acciones delgadas: actor y organización salen de la sesión; los IDs del formulario solo indican
// el objetivo y el repositorio vuelve a autorizarlos contra el alcance.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

async function ejecutar(ruta: string, fn: (actorId: string, organizacionId: string) => Promise<unknown>, exito: string): Promise<Estado> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    await fn(sesion.usuario.id, organizacion.id);
    revalidatePath(ruta);
    return { ok: exito };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
}

export async function accionRegistrarGasto(_: Estado, form: FormData) {
  return ejecutar("/gastos", (actor, org) => registrarGasto(db(), actor, org, {
    sedeId: texto(form, "sedeId"), categoriaId: texto(form, "categoriaId"), fecha: texto(form, "fecha"), monto: texto(form, "monto"),
    medioPago: texto(form, "medioPago"), descripcion: texto(form, "descripcion"), comprobante: texto(form, "comprobante"),
  }), "Gasto registrado");
}
export async function accionAnularGasto(_: Estado, form: FormData) {
  return ejecutar("/gastos", (actor, org) => anularGasto(db(), actor, org, texto(form, "gastoId"), texto(form, "motivo")), "Gasto anulado");
}
export async function accionCrearCategoriaGasto(_: Estado, form: FormData) {
  const sedeId = texto(form, "alcance") === "global" ? null : texto(form, "sedeId");
  return ejecutar("/gastos/categorias", (actor, org) => crearCategoriaGasto(db(), actor, org, { nombre: texto(form, "nombre"), sedeId }), "Categoría creada");
}
export async function accionRenombrarCategoriaGasto(_: Estado, form: FormData) {
  return ejecutar("/gastos/categorias", (actor, org) => actualizarCategoriaGasto(db(), actor, org, texto(form, "categoriaId"), { nombre: texto(form, "nombre") }), "Categoría renombrada");
}
export async function accionEstadoCategoriaGasto(_: Estado, form: FormData) {
  const activo = texto(form, "activo") === "true";
  return ejecutar("/gastos/categorias", (actor, org) => actualizarCategoriaGasto(db(), actor, org, texto(form, "categoriaId"), { activo }), activo ? "Categoría reactivada" : "Categoría desactivada");
}
