"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AccesoDenegado, type Asignacion } from "@nailnet/domain";
import { DatosInvalidos, actualizarSede, cambiarEstadoSede, crearFranquiciado, crearSede, listarSedes, zonaHorariaValida } from "@nailnet/database/access";
import { cambiarEstadoUsuario, crearUsuario, emitirInvitacion, otorgarRol, revocarRol } from "@nailnet/database/usuarios";
import { actualizarConfiguracionOrganizacion, actualizarConfiguracionSede, configurarSenaRecepcion, eliminarCredencial, guardarCredencial } from "@nailnet/database/configuracion";
import { CifradoNoConfigurado } from "@nailnet/domain/secretos";
import { PARAMETROS, type Parametro } from "@nailnet/domain/configuracion";
import type { DatosCliente, TipoConsentimiento } from "@nailnet/domain/clientes";
import { actualizarCliente, actualizarObservaciones, crearCliente, publicarConsentimiento, registrarConsentimiento, vincularCliente } from "@nailnet/database/clientes";
import type { Sena, TipoSena } from "@nailnet/domain/catalogo";
import { crearCategoria, crearSkill, crearTipoRecurso, guardarImagenServicio, guardarServicio, guardarServicioSede } from "@nailnet/database/catalogo";
import { aMinutos, aUtc, validarFecha } from "@nailnet/domain/agenda";
import { actualizarProfesional, guardarFotoProfesional, cambiarEstadoRecurso, crearBloqueo, crearExcepcion, crearProfesional, crearRecurso, eliminarBloqueo, eliminarExcepcion, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos, vincularSede } from "@nailnet/database/profesionales";
import { ConfiguracionIncompleta } from "@nailnet/database/disponibilidad";
import { TurnoNoDisponible, cancelarReserva, marcarAtendida, marcarAusente, reprogramarReserva, tomarTurno } from "@nailnet/database/reservas";
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
const parametros = (f: FormData) => Object.fromEntries((Object.keys(PARAMETROS) as Parametro[]).map(p => [p, numero(f, p)]));

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
/** Archivo subido o null si se pidió quitar la imagen. El repositorio la valida y la procesa. */
async function archivoImagen(form: FormData) {
  if (texto(form, "quitar") === "1") return null;
  const archivo = form.get("imagen");
  if (!(archivo instanceof File) || !archivo.size) throw new DatosInvalidos("Elegí una imagen");
  return new Uint8Array(await archivo.arrayBuffer());
}
export async function accionImagenServicio(_: Estado, form: FormData) {
  const quitar = texto(form, "quitar") === "1";
  return ejecutar("/catalogo", async (actor, org) => guardarImagenServicio(db(), actor, org, texto(form, "servicioId"), await archivoImagen(form)), quitar ? "Imagen quitada" : "Imagen guardada");
}
export async function accionServicioSede(_: Estado, form: FormData) {
  const duracion = entero(form, "duracionMinutos");
  return ejecutar("/catalogo", (actor, org) => guardarServicioSede(db(), actor, org, texto(form, "sedeId"), texto(form, "servicioId"), {
    habilitado: marcado(form, "habilitado"), precio: texto(form, "precio") || null, duracionMinutos: Number.isNaN(duracion) ? null : duracion,
    sena: senaForm(form), reservableOnline: marcado(form, "reservableOnline"),
  }), "Condiciones de la sede guardadas");
}

// Profesionales, calendario y recursos (C03).
const semanaForm = (f: FormData) => semanaDesdeTextos(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, texto(f, `dia${d}`)])));
/** datetime-local interpretado en la zona de la sede indicada. */
function instante(f: FormData, k: string): Date {
  const [fecha, hora] = texto(f, k).split("T");
  const tz = texto(f, "tz");
  const minutos = hora ? aMinutos(hora.slice(0, 5)) : null;
  if (!fecha || !validarFecha(fecha) || minutos === null || !zonaHorariaValida(tz)) return new Date(NaN);
  return aUtc(fecha, minutos, tz);
}
export async function accionCrearProfesional(_: Estado, form: FormData) {
  let id = "";
  const r = await ejecutar("/profesionales", async (actor, org) => { id = (await crearProfesional(db(), actor, org, texto(form, "sedeId"), { nombre: texto(form, "nombre"), apellido: texto(form, "apellido") })).id; }, "Profesional creado");
  if (r?.ok && id) redirect(`/profesionales/${id}`);
  return r;
}
export async function accionActualizarProfesional(_: Estado, form: FormData) {
  const id = texto(form, "profesionalId");
  return ejecutar(`/profesionales/${id}`, (actor, org) => actualizarProfesional(db(), actor, org, id, { nombre: texto(form, "nombre"), apellido: texto(form, "apellido"), activo: marcado(form, "activo") }), "Datos guardados");
}
export async function accionFotoProfesional(_: Estado, form: FormData) {
  const id = texto(form, "profesionalId"), quitar = texto(form, "quitar") === "1";
  return ejecutar(`/profesionales/${id}`, async (actor, org) => guardarFotoProfesional(db(), actor, org, id, await archivoImagen(form)), quitar ? "Foto quitada" : "Foto guardada");
}
export async function accionVincularSedeProfesional(_: Estado, form: FormData) {
  const id = texto(form, "profesionalId");
  return ejecutar(`/profesionales/${id}`, (actor, org) => vincularSede(db(), actor, org, id, texto(form, "sedeId"), texto(form, "activo") !== "false"), "Sede actualizada");
}
export async function accionHabilidades(_: Estado, form: FormData) {
  const id = texto(form, "profesionalId");
  return ejecutar(`/profesionales/${id}`, (actor, org) => guardarHabilidades(db(), actor, org, id, { skillIds: form.getAll("skillId").map(String), servicioIds: form.getAll("servicioId").map(String) }), "Habilidades guardadas");
}
export async function accionHorarioProfesional(_: Estado, form: FormData) {
  const id = texto(form, "profesionalId");
  return ejecutar(`/profesionales/${id}`, (actor, org) => guardarHorarioProfesional(db(), actor, org, id, texto(form, "sedeId"), semanaForm(form)), "Jornada guardada");
}
export async function accionCrearBloqueo(_: Estado, form: FormData) {
  const id = texto(form, "profesionalId");
  return ejecutar(`/profesionales/${id}`, async (actor, org) => { await crearBloqueo(db(), actor, org, id, { inicio: instante(form, "inicio"), fin: instante(form, "fin"), motivo: texto(form, "motivo") }); }, "Bloqueo agregado");
}
export async function accionEliminarBloqueo(_: Estado, form: FormData) {
  return ejecutar(`/profesionales/${texto(form, "profesionalId")}`, (actor, org) => eliminarBloqueo(db(), actor, org, texto(form, "bloqueoId")), "Bloqueo eliminado");
}
export async function accionHorarioSede(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  return ejecutar(`/sedes/${sedeId}`, (actor, org) => guardarHorarioSede(db(), actor, org, sedeId, semanaForm(form)), "Horario de la sede guardado");
}
export async function accionCrearExcepcion(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  const inicio = aMinutos(texto(form, "desde")), fin = aMinutos(texto(form, "hasta"));
  return ejecutar(`/sedes/${sedeId}`, async (actor, org) => {
    if (!marcado(form, "cerrado") && (inicio === null || fin === null || inicio >= fin)) throw new DatosInvalidos("Indicá el horario especial o marcá cerrado");
    await crearExcepcion(db(), actor, org, { sedeId: marcado(form, "toda") ? null : sedeId, fecha: texto(form, "fecha"), rango: marcado(form, "cerrado") ? null : { inicio: inicio!, fin: fin! }, motivo: texto(form, "motivo") });
  }, "Fecha especial agregada");
}
export async function accionEliminarExcepcion(_: Estado, form: FormData) {
  return ejecutar(`/sedes/${texto(form, "sedeId")}`, (actor, org) => eliminarExcepcion(db(), actor, org, texto(form, "excepcionId")), "Fecha especial eliminada");
}
export async function accionCrearRecurso(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  return ejecutar(`/sedes/${sedeId}`, async (actor, org) => { await crearRecurso(db(), actor, org, sedeId, { tipoRecursoId: texto(form, "tipoRecursoId"), nombre: texto(form, "nombre") }); }, "Recurso agregado");
}
export async function accionEstadoRecurso(_: Estado, form: FormData) {
  return ejecutar(`/sedes/${texto(form, "sedeId")}`, (actor, org) => cambiarEstadoRecurso(db(), actor, org, texto(form, "recursoId"), texto(form, "activo") === "true"), "Recurso actualizado");
}

// Reservas (R01).
export async function accionReservar(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId"), fecha = texto(form, "fecha");
  const servicios = form.getAll("s").map(String), profesionales = form.getAll("p").map(String);
  let ok = false;
  try {
    const r = await ejecutar("/agenda", async (actor, org) => {
      await tomarTurno(db(), actor, org, {
        sedeId, fecha, canal: "RECEPCION", clienteId: texto(form, "clienteId"), notas: texto(form, "notas"),
        items: servicios.map((servicioId, i) => ({ servicioId, profesionalId: profesionales[i] || null })), inicio: new Date(texto(form, "inicio")),
      });
      ok = true;
    }, "Turno reservado");
    if (!ok) return r;
  } catch (e) {
    if (e instanceof TurnoNoDisponible) return { error: e.message };
    if (e instanceof ConfiguracionIncompleta) return { error: e.message };
    throw e;
  }
  redirect(`/agenda?${new URLSearchParams({ sede: sedeId, fecha, ok: "1" })}`);
}
export async function accionSenaRecepcion(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId");
  const valor = texto(form, "valor");
  return ejecutar(`/sedes/${sedeId}`, (actor, org) => configurarSenaRecepcion(db(), actor, org, texto(form, "nivel") === "organizacion" ? null : sedeId, valor === "" ? null : valor === "true"), "Política de seña en recepción guardada");
}

// Operación del turno (R03).
async function operar(form: FormData, fn: (actor: string, org: string, reservaId: string) => Promise<unknown>, exito: string): Promise<Estado> {
  try {
    return await ejecutar("/agenda", async (actor, org) => { await fn(actor, org, texto(form, "reservaId")); }, exito);
  } catch (e) {
    if (e instanceof TurnoNoDisponible) return { error: e.message };
    throw e;
  }
}
export async function accionCancelarReserva(_: Estado, form: FormData) {
  return operar(form, (actor, org, id) => cancelarReserva(db(), actor, org, id, texto(form, "motivo")), "Turno cancelado. Si hubo seña, la devolución es manual por ahora (D5).");
}
export async function accionAtendida(_: Estado, form: FormData) {
  return operar(form, (actor, org, id) => marcarAtendida(db(), actor, org, id), "Marcado como atendido");
}
export async function accionAusente(_: Estado, form: FormData) {
  return operar(form, (actor, org, id) => marcarAusente(db(), actor, org, id), "Marcado como ausente");
}
export async function accionReprogramar(_: Estado, form: FormData) {
  const sedeId = texto(form, "sedeId"), fecha = texto(form, "fecha");
  let ok = false;
  const r = await operar(form, async (actor, org, id) => {
    await reprogramarReserva(db(), actor, org, id, { fecha, inicio: new Date(texto(form, "inicio")), profesionales: form.getAll("p").map(String).map(p => p || null) });
    ok = true;
  }, "Turno reprogramado");
  if (!ok) return r;
  redirect(`/agenda?${new URLSearchParams({ sede: sedeId, fecha, ok: "reprogramado" })}`);
}
