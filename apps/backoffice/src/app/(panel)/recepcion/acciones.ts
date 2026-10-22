"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { marcarLlegada, terminarAtencion } from "@nailnet/database/reservas";
import { agregarEspera, esperaSeFue, registrarEntrada, registrarSalida } from "@nailnet/database/tablero";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// Tablero de recepción (doc 29): acciones delgadas; actor y organización salen de la sesión y el
// repositorio vuelve a autorizar sede, profesional y turno.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

async function ejecutar(fn: (actorId: string, organizacionId: string) => Promise<unknown>, exito: string): Promise<Estado> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    await fn(sesion.usuario.id, organizacion.id);
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
  revalidatePath("/recepcion");
  revalidatePath("/agenda");
  return { ok: exito };
}

export async function accionEntrada(_: Estado, form: FormData) {
  return ejecutar((actor, org) => registrarEntrada(db(), actor, org, { sedeId: texto(form, "sedeId"), profesionalId: texto(form, "profesionalId") }), "Entrada registrada");
}
export async function accionSalida(_: Estado, form: FormData) {
  return ejecutar((actor, org) => registrarSalida(db(), actor, org, texto(form, "presenciaId")), "Salida registrada");
}
export async function accionLlegada(_: Estado, form: FormData) {
  return ejecutar((actor, org) => marcarLlegada(db(), actor, org, texto(form, "reservaId")), "En atención");
}
export async function accionTermino(_: Estado, form: FormData) {
  // Termina los servicios de esa profesional; con servicios a la vez, el turno queda por cobrar cuando terminan todas.
  return ejecutar((actor, org) => terminarAtencion(db(), actor, org, texto(form, "reservaId"), new Date(), { profesionalId: texto(form, "profesionalId") || null }), "Terminó");
}
export async function accionAgregarEspera(_: Estado, form: FormData) {
  return ejecutar((actor, org) => agregarEspera(db(), actor, org, {
    sedeId: texto(form, "sedeId"), nombre: texto(form, "nombre"), telefono: texto(form, "telefono"),
    servicioIds: [texto(form, "s_0"), texto(form, "s_1")], profesionalId: texto(form, "profesionalId") || null, notas: texto(form, "notas"),
  }), "Anotada en la lista de espera");
}
export async function accionSeFue(_: Estado, form: FormData) {
  return ejecutar((actor, org) => esperaSeFue(db(), actor, org, texto(form, "esperaId")), "Quitada de la lista de espera");
}
