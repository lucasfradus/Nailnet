"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { marcarLlegada, terminarAtencion } from "@nailnet/database/reservas";
import { listarClientes } from "@nailnet/database/clientes";
import { agregarEspera, esperaSeFue, registrarEntrada, registrarSalida, sentarEspera } from "@nailnet/database/tablero";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// Tablero de recepción (doc 29): acciones delgadas; actor y organización salen de la sesión y el
// repositorio vuelve a autorizar sede, profesional y turno.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

async function ejecutar(fn: (actorId: string, organizacionId: string) => Promise<unknown>, exito: string): Promise<Estado & { id?: string }> {
  let r: unknown;
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    r = await fn(sesion.usuario.id, organizacion.id);
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
  revalidatePath("/recepcion");
  revalidatePath("/agenda");
  // Lo que creó, si creó algo (la espera recién anotada, para dejarla elegida en la pantalla).
  const id = r && typeof r === "object" && "id" in r && typeof r.id === "string" ? r.id : undefined;
  return { ok: exito, ...(id ? { id } : {}) };
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
/** «Llegó sin turno» (doc 31, etapa 2): con ficha si recepción la eligió, o con solo el nombre. Devuelve el id de la espera. */
export async function accionAgregarEspera(_: Estado, form: FormData) {
  return ejecutar((actor, org) => agregarEspera(db(), actor, org, {
    sedeId: texto(form, "sedeId"), nombre: texto(form, "nombre"), telefono: texto(form, "telefono"), clienteId: texto(form, "clienteId") || null,
    servicioIds: [texto(form, "s_0"), texto(form, "s_1")], profesionalId: texto(form, "profesionalId") || null, notas: texto(form, "notas"),
  }), "Anotada en la lista de espera");
}

/**
 * Sienta ahora a una clienta de la lista de espera (doc 31, etapa 2). Los pares servicio/profesional van
 * como `s_N`/`p_N`; el repositorio decide si se puede (permisos, quién está libre, la espera sigue abierta).
 */
export async function accionSentar(_: Estado, form: FormData) {
  const items: { servicioId: string; profesionalId: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const servicioId = texto(form, `s_${i}`);
    if (servicioId) items.push({ servicioId, profesionalId: texto(form, `p_${i}`) });
  }
  return ejecutar((actor, org) => sentarEspera(db(), actor, org, { esperaId: texto(form, "esperaId"), items }), "Sentada");
}

export type Ficha = { id: string; nombre: string; apellido: string | null; telefono: string | null; email: string | null };

/** Fichas que coinciden con lo que se va escribiendo en «Llegó sin turno». Sin permiso para leer clientes, ninguna. */
export async function accionBuscarFichas(textoBuscado: string): Promise<Ficha[]> {
  const q = typeof textoBuscado === "string" ? textoBuscado.trim().slice(0, 80) : "";
  if (q.length < 3) return [];
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    const r = await listarClientes(db(), sesion.usuario.id, organizacion.id, { texto: q });
    return r.slice(0, 6).map(c => ({ id: c.id, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, email: c.email }));
  } catch (e) {
    if (e instanceof AccesoDenegado || e instanceof DatosInvalidos) return [];
    throw e;
  }
}
export async function accionSeFue(_: Estado, form: FormData) {
  return ejecutar((actor, org) => esperaSeFue(db(), actor, org, texto(form, "esperaId")), "Quitada de la lista de espera");
}
