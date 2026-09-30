"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AccesoDenegado, type Asignacion } from "@nailnet/domain";
import { DatosInvalidos, actualizarSede, cambiarEstadoSede, crearFranquiciado, crearSede, listarSedes } from "@nailnet/database/access";
import { cambiarEstadoUsuario, crearUsuario, emitirInvitacion, otorgarRol, revocarRol } from "@nailnet/database/usuarios";
import { actualizarConfiguracionOrganizacion, actualizarConfiguracionSede, eliminarCredencial, guardarCredencial } from "@nailnet/database/configuracion";
import { CifradoNoConfigurado } from "@nailnet/domain/secretos";
import type { DatosCliente, TipoConsentimiento } from "@nailnet/domain/clientes";
import { actualizarCliente, actualizarObservaciones, crearCliente, publicarConsentimiento, registrarConsentimiento, vincularCliente } from "@nailnet/database/clientes";
import type { Sena, TipoSena } from "@nailnet/domain/catalogo";
import { crearCategoria, crearSkill, crearTipoRecurso, guardarServicio, guardarServicioSede } from "@nailnet/database/catalogo";
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

// Configuración (A03). Vacío = heredar de la organización.
const numero = (f: FormData, k: string) => { const v = texto(f, k).trim(); return v === "" ? null : Number(v); };
const parametros = (f: FormData) => ({ horizonteReservaDias: numero(f, "horizonteReservaDias"), anticipacionMinimaMinutos: numero(f, "anticipacionMinimaMinutos") });

export async function accionConfiguracionSede(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  return ejecutar(`/sedes/${sedeId}`, (actor, org) => actualizarConfiguracionSede(db(), actor, org, sedeId, parametros(form)), "Configuración de la sede guardada");
}
export async function accionConfiguracionOrganizacion(_: Estado, form: FormData) {
  return ejecutar("/sedes", (actor, org) => actualizarConfiguracionOrganizacion(db(), actor, org, parametros(form)), "Valores de la organización guardados");
}
export async function accionGuardarCredencial(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  const campos = Object.fromEntries([...form.entries()].filter(([k, v]) => k.startsWith("c_") && typeof v === "string").map(([k, v]) => [k.slice(2), v as string]));
  try {
    return await ejecutar(`/sedes/${sedeId}`, (actor, org) => guardarCredencial(db(), actor, org, sedeId, texto(form, "proveedor"), texto(form, "ambiente"), campos), "Credencial guardada");
  } catch (e) {
    if (e instanceof CifradoNoConfigurado) return { error: e.message };
    throw e;
  }
}
export async function accionEliminarCredencial(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  return ejecutar(`/sedes/${sedeId}`, (actor, org) => eliminarCredencial(db(), actor, org, sedeId, texto(form, "proveedor"), texto(form, "ambiente")), "Credencial eliminada");
}

// Clientes y consentimientos (C01).
const datosCliente = (f: FormData) => ({
  nombre: texto(f, "nombre"), apellido: texto(f, "apellido"), email: texto(f, "email"), telefono: texto(f, "telefono"),
  sexo: (texto(f, "sexo") || null) as DatosCliente["sexo"], tipoDocumento: (texto(f, "tipoDocumento") || null) as DatosCliente["tipoDocumento"], documento: texto(f, "documento"),
});
export async function accionCrearCliente(_: Estado, form: FormData) {
  let id = "";
  const r = await ejecutar("/clientes", async (actor, org) => { id = (await crearCliente(db(), actor, org, texto(form, "sedeId"), datosCliente(form))).id; }, "Cliente creado");
  if (r?.ok && id) redirect(`/clientes/${id}`);
  return r;
}
export async function accionVincularCliente(_: Estado, form: FormData) {
  const clienteId = texto(form, "clienteId");
  const r = await ejecutar("/clientes", (actor, org) => vincularCliente(db(), actor, org, clienteId, texto(form, "sedeId")), "Cliente vinculado a la sede");
  if (r?.ok) redirect(`/clientes/${clienteId}`);
  return r;
}
export async function accionActualizarCliente(_: Estado, form: FormData) {
  const clienteId = texto(form, "clienteId");
  return ejecutar(`/clientes/${clienteId}`, (actor, org) => actualizarCliente(db(), actor, org, clienteId, datosCliente(form)), "Datos actualizados");
}
export async function accionObservaciones(_: Estado, form: FormData) {
  const clienteId = texto(form, "clienteId");
  return ejecutar(`/clientes/${clienteId}`, (actor, org) => actualizarObservaciones(db(), actor, org, clienteId, texto(form, "sedeId"), texto(form, "observaciones")), "Observaciones guardadas");
}
export async function accionConsentimiento(_: Estado, form: FormData) {
  const clienteId = texto(form, "clienteId");
  const accion = texto(form, "accion") === "REVOCA" ? "REVOCA" : "ACEPTA";
  return ejecutar(`/clientes/${clienteId}`, (actor, org) => registrarConsentimiento(db(), actor, org, { clienteId, versionId: texto(form, "versionId"), sedeId: texto(form, "sedeId"), accion }), accion === "ACEPTA" ? "Aceptación registrada" : "Revocación registrada");
}
export async function accionPublicarConsentimiento(_: Estado, form: FormData) {
  return ejecutar("/consentimientos", async (actor, org) => {
    const v = await publicarConsentimiento(db(), actor, org, { tipo: texto(form, "tipo") as TipoConsentimiento, clave: texto(form, "clave").trim(), titulo: texto(form, "titulo"), texto: texto(form, "texto") });
    return `Publicada la versión ${v.version}`;
  }, "");
}

// Catálogo (C02).
const marcado = (f: FormData, k: string) => f.get(k) === "on";
const entero = (f: FormData, k: string) => { const v = texto(f, k).trim(); return v === "" ? NaN : Number(v); };
function senaForm(f: FormData, prefijo = ""): Sena {
  const tipo = texto(f, `${prefijo}senaTipo`);
  if (!tipo) return null;
  return { tipo: tipo as TipoSena, valor: tipo === "NINGUNA" ? null : texto(f, `${prefijo}senaValor`).trim() || null };
}
export async function accionCrearCategoria(_: Estado, form: FormData) {
  return ejecutar("/catalogo", async (actor, org) => { await crearCategoria(db(), actor, org, texto(form, "nombre"), entero(form, "orden") || 0); }, "Categoría creada");
}
export async function accionCrearSkill(_: Estado, form: FormData) {
  return ejecutar("/catalogo", async (actor, org) => { await crearSkill(db(), actor, org, texto(form, "nombre")); }, "Habilidad creada");
}
export async function accionCrearTipoRecurso(_: Estado, form: FormData) {
  return ejecutar("/catalogo", async (actor, org) => { await crearTipoRecurso(db(), actor, org, texto(form, "nombre")); }, "Tipo de recurso creado");
}
export async function accionGuardarServicio(_: Estado, form: FormData) {
  const servicioId = texto(form, "servicioId") || undefined;
  const recursos = form.getAll("tipoRecursoId").map(String).map(id => ({ tipoRecursoId: id, cantidad: entero(form, `cantidad_${id}`) })).filter(r => r.cantidad > 0);
  return ejecutar("/catalogo", async (actor, org) => {
    await guardarServicio(db(), actor, org, {
      categoriaId: texto(form, "categoriaId"), nombre: texto(form, "nombre"), descripcion: texto(form, "descripcion"),
      duracionMinutos: entero(form, "duracionMinutos"), bufferAntesMinutos: entero(form, "bufferAntesMinutos") || 0, bufferDespuesMinutos: entero(form, "bufferDespuesMinutos") || 0,
      sena: senaForm(form), activo: servicioId ? marcado(form, "activo") : true,
      skillIds: form.getAll("skillId").map(String), recursos, consentimientos: form.getAll("consentimiento").map(String),
    }, servicioId);
  }, servicioId ? "Servicio actualizado" : "Servicio creado");
}
export async function accionServicioSede(_: Estado, form: FormData) {
  const duracion = entero(form, "duracionMinutos");
  return ejecutar("/catalogo", (actor, org) => guardarServicioSede(db(), actor, org, texto(form, "sedeId"), texto(form, "servicioId"), {
    habilitado: marcado(form, "habilitado"), precio: texto(form, "precio") || null, duracionMinutos: Number.isNaN(duracion) ? null : duracion,
    sena: senaForm(form), reservableOnline: marcado(form, "reservableOnline"),
  }), "Condiciones de la sede guardadas");
}
