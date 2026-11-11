"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc, validarFecha } from "@nailnet/domain/agenda";
import { DatosInvalidos } from "@nailnet/database/access";
import { crearCliente, listarClientes } from "@nailnet/database/clientes";
import { ConfiguracionIncompleta } from "@nailnet/database/disponibilidad";
import { TurnoNoDisponible, cancelarReserva, empezarSesion, marcarAusente, reprogramarReserva, terminarAtencion, tomarTurno } from "@nailnet/database/reservas";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// Grilla de Tratamientos (doc 31, etapa 4): acciones delgadas que llama la pantalla con datos sueltos.
// Actor, organización y sede salen de la sesión; los IDs solo indican el objetivo y el repositorio vuelve
// a autorizar. Los horarios llegan como fecha y minutos locales de la sede y se convierten acá.

type Resultado<T = undefined> = Estado & { dato?: T };

async function ejecutar<T>(fn: (actorId: string, organizacionId: string, sede: { id: string; timezone: string }) => Promise<T>, exito: string, revalidar = true): Promise<Resultado<T>> {
  try {
    const { sesion, organizacion, sede } = await requerirOrganizacion();
    if (!sede) throw new AccesoDenegado();
    const dato = await fn(sesion.usuario.id, organizacion.id, sede);
    if (revalidar) {
      revalidatePath("/recepcion");
      revalidatePath("/agenda");
    }
    return { ok: exito, dato };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos || e instanceof TurnoNoDisponible || e instanceof ConfiguracionIncompleta) return { error: e.message };
    throw e;
  }
}

function instante(fecha: string, minutos: number, tz: string) {
  if (!validarFecha(fecha) || !Number.isInteger(minutos) || minutos < 0 || minutos > 1440) throw new DatosInvalidos("Horario inválido");
  return aUtc(fecha, minutos, tz);
}

/** «Empezó»: la sesión empieza ahora; si la clienta llegó antes y está todo libre, el turno se adelanta. */
export async function accionEmpezo(reservaId: string) {
  return ejecutar((actor, org) => empezarSesion(db(), actor, org, reservaId), "Sesión empezada");
}
/** «Terminó» de la profesional: con servicios de varias, el turno queda por cobrar cuando terminan todas. */
export async function accionTerminoSesion(reservaId: string, profesionalId: string) {
  return ejecutar((actor, org) => terminarAtencion(db(), actor, org, reservaId, new Date(), { profesionalId: profesionalId || null }), "Terminó: queda por cobrar");
}
export async function accionAusenteTurno(reservaId: string) {
  return ejecutar((actor, org) => marcarAusente(db(), actor, org, reservaId), "Marcado como ausente");
}
export async function accionCancelarTurno(reservaId: string, motivo: string) {
  return ejecutar((actor, org) => cancelarReserva(db(), actor, org, reservaId, motivo), "Turno cancelado: el horario queda libre. Si hubo seña, la devolución es manual por ahora.");
}

/** Mover: horario, profesional y cabina de cada servicio (null: cualquiera libre). Devuelve el turno nuevo. */
export async function accionMoverTurno(reservaId: string, destino: { fecha: string; minutos: number; profesionales: string[]; recursos: (string[] | null)[] }) {
  return ejecutar(async (actor, org, sede) => (await reprogramarReserva(db(), actor, org, reservaId, {
    fecha: destino.fecha, inicio: instante(destino.fecha, destino.minutos, sede.timezone), profesionales: destino.profesionales, recursos: destino.recursos,
  })).reservaId, "Turno movido");
}

/** Reservar en un inicio libre de la grilla, con la profesional y la cabina que eligió recepción. */
export async function accionReservarTurno(datos: { fecha: string; minutos: number; servicioId: string; profesionalId: string; recursoIds: string[]; clienteId: string; notas: string }) {
  return ejecutar(async (actor, org, sede) => (await tomarTurno(db(), actor, org, {
    sedeId: sede.id, fecha: datos.fecha, canal: "RECEPCION", clienteId: datos.clienteId, notas: datos.notas,
    items: [{ servicioId: datos.servicioId, profesionalId: datos.profesionalId, ...(datos.recursoIds.length ? { recursoIds: datos.recursoIds } : {}) }],
    inicio: instante(datos.fecha, datos.minutos, sede.timezone),
  })).reservaId, "Turno reservado");
}

/** Fichas que coinciden con el nombre o el teléfono escrito. */
export async function accionBuscarClientas(texto: string) {
  const q = texto.trim();
  if (q.length < 2) return { ok: "", dato: [] };
  // Como «Nuevo turno» de la agenda: todo el alcance de quien busca; al reservar, la ficha se vincula a la sede.
  return ejecutar(async (actor, org) => (await listarClientes(db(), actor, org, { texto: q })).slice(0, 8)
    .map(c => ({ id: c.id, nombre: [c.nombre, c.apellido].filter(Boolean).join(" "), telefono: c.telefono })), "", false);
}

/** Ficha nueva con nombre y teléfono, vinculada a la sede; el resto se completa después. */
export async function accionCrearClienta(nombre: string, telefono: string) {
  return ejecutar(async (actor, org, sede) => {
    const { id } = (await crearCliente(db(), actor, org, sede.id, { nombre, telefono }))!;
    return { id, nombre: nombre.trim(), telefono: telefono.trim() || null };
  }, "Ficha creada");
}
