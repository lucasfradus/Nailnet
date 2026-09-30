import { AccesoDenegado, cubreSede, tienePermiso, type Asignacion, type FranquiciadoDeSede, type Permiso } from "@nailnet/domain";
import { estadoConsentimiento, normalizarTelefono, validarClaveConsentimiento, validarCliente, type DatosCliente, type TipoConsentimiento } from "@nailnet/domain/clientes";
import { normalizarEmail } from "@nailnet/domain/credenciales";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, bloquearOrganizacion, exigirIds } from "./access.ts";

type Cliente = Database | Prisma.TransactionClient;

/** Sedes de la organización (activas) sobre las que el actor tiene el permiso. */
async function sedesConPermiso(db: Cliente, actorId: string, organizacionId: string, permiso: Permiso) {
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const sedes = await db.sede.findMany({ where: { organizacionId, activo: true }, select: { id: true, franquiciadoId: true, nombre: true } });
  const mapa = new Map(sedes.map(s => [s.id, s.franquiciadoId]));
  const franquiciadoDe: FranquiciadoDeSede = id => mapa.get(id);
  const permitidas = sedes.filter(s => actor.some(a => tienePermiso(a, permiso) && cubreSede(a, s.id, franquiciadoDe)));
  return { actor, sedes: permitidas, ids: new Set(permitidas.map(s => s.id)), organizacional: actor.some((a: Asignacion) => tienePermiso(a, permiso) && a.alcance === "ORGANIZACION") };
}

function datosValidos(d: DatosCliente) {
  const r = validarCliente(d);
  if ("error" in r) throw new DatosInvalidos(r.error);
  return r.datos;
}
function conflicto(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos("Ya existe un cliente con ese email o documento. Buscalo y vinculalo a tu sede.");
  throw e;
}

const identidad = { id: true, nombre: true, apellido: true, email: true, telefono: true } as const;

/** Clientes vinculados a sedes del alcance. El texto filtra por nombre, email o teléfono dentro de ese alcance. */
export async function listarClientes(db: Database, actorId: string, organizacionId: string, filtro: { sedeId?: string; texto?: string } = {}) {
  exigirIds(filtro.sedeId);
  const { ids, sedes, organizacional } = await sedesConPermiso(db, actorId, organizacionId, "cliente:leer");
  if (!ids.size && !organizacional) throw new AccesoDenegado();
  if (filtro.sedeId && !ids.has(filtro.sedeId)) throw new AccesoDenegado();
  const alcance = filtro.sedeId ? [filtro.sedeId] : [...ids];
  const q = filtro.texto?.trim().slice(0, 80);
  // Búsqueda parcial por dígitos (p. ej. los últimos 4 del teléfono) dentro del alcance.
  const digitos = q && /^[\d\s()+.-]+$/.test(q) ? q.replace(/\D/g, "") : "";
  const clientes = await db.cliente.findMany({
    where: {
      organizacionId,
      // Solo el alcance organizacional ve clientes sin sede (p. ej. altas futuras desde el portal).
      ...(organizacional && !filtro.sedeId ? {} : { sedes: { some: { sedeId: { in: alcance } } } }),
      ...(q ? { OR: [
        { nombre: { contains: q, mode: "insensitive" as const } },
        { apellido: { contains: q, mode: "insensitive" as const } },
        { email: { contains: q.toLowerCase() } },
        ...(digitos.length >= 4 ? [{ telefono: { contains: digitos } }] : []),
      ] } : {}),
    },
    select: { ...identidad, sedes: { where: { sedeId: { in: [...ids] } }, select: { sedeId: true } } },
    orderBy: [{ nombre: "asc" }, { apellido: "asc" }, { id: "asc" }],
    take: 50,
  });
  const nombres = new Map(sedes.map(s => [s.id, s.nombre]));
  return clientes.map(c => ({ ...c, sedes: c.sedes.map(s => nombres.get(s.sedeId)!).filter(Boolean) }));
}

/**
 * Búsqueda en toda la organización para vincular un cliente existente (D13). Solo por coincidencia
 * exacta de email o teléfono: quien lo pide ya conoce el dato, y así no se pueden hojear clientes
 * de otros franquiciados por nombre.
 */
export async function buscarParaVincular(db: Database, actorId: string, organizacionId: string, contacto: string) {
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "cliente:editar");
  if (!ids.size) throw new AccesoDenegado();
  const email = contacto.includes("@") ? normalizarEmail(contacto) : null;
  const telefono = email ? null : normalizarTelefono(contacto);
  if (!email && !telefono) throw new DatosInvalidos("Ingresá un email o un teléfono completo");
  return db.cliente.findMany({
    where: { organizacionId, ...(email ? { email } : { telefono }) },
    select: { id: true, nombre: true, apellido: true, sedes: { where: { sedeId: { in: [...ids] } }, select: { sedeId: true } } },
    take: 5,
  });
}

async function exigirEnSede(db: Cliente, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  exigirIds(sedeId);
  const r = await sedesConPermiso(db, actorId, organizacionId, permiso);
  if (!r.ids.has(sedeId)) throw new AccesoDenegado();
  return r;
}

export async function crearCliente(db: Database, actorId: string, organizacionId: string, sedeId: string, datos: DatosCliente) {
  const d = datosValidos(datos);
  try {
    return await db.$transaction(async tx => {
      await exigirEnSede(tx, actorId, organizacionId, sedeId, "cliente:editar");
      const cliente = await tx.cliente.create({ data: { organizacionId, ...d, sedes: { create: { sedeId } } }, select: { id: true } });
      // La auditoría registra el hecho, no los datos personales.
      await auditar(tx, organizacionId, actorId, "cliente.crear", "Cliente", cliente.id, { sedeId });
      return cliente;
    });
  } catch (e) { conflicto(e); }
}

export async function vincularCliente(db: Database, actorId: string, organizacionId: string, clienteId: string, sedeId: string) {
  exigirIds(clienteId);
  await db.$transaction(async tx => {
    await exigirEnSede(tx, actorId, organizacionId, sedeId, "cliente:editar");
    if (!await tx.cliente.count({ where: { id: clienteId, organizacionId } })) throw new AccesoDenegado();
    await tx.clienteSede.upsert({ where: { clienteId_sedeId: { clienteId, sedeId } }, create: { organizacionId, clienteId, sedeId }, update: {} });
    await auditar(tx, organizacionId, actorId, "cliente.vincular", "Cliente", clienteId, { sedeId });
  });
}

/** Sedes del cliente dentro del alcance del actor; vacío = el actor no puede verlo. */
async function sedesVisibles(db: Cliente, actorId: string, organizacionId: string, clienteId: string, permiso: Permiso) {
  exigirIds(clienteId);
  const r = await sedesConPermiso(db, actorId, organizacionId, permiso);
  const vinculos = await db.clienteSede.findMany({ where: { clienteId, organizacionId }, select: { sedeId: true, observaciones: true, updatedAt: true } });
  const visibles = vinculos.filter(v => r.ids.has(v.sedeId));
  const existe = await db.cliente.count({ where: { id: clienteId, organizacionId } });
  if (!existe || (!visibles.length && !(r.organizacional && !vinculos.length))) throw new AccesoDenegado();
  return { ...r, visibles };
}

export async function obtenerCliente(db: Database, actorId: string, organizacionId: string, clienteId: string) {
  const { visibles, sedes } = await sedesVisibles(db, actorId, organizacionId, clienteId, "cliente:leer");
  const editables = await sedesConPermiso(db, actorId, organizacionId, "cliente:editar");
  const cliente = await db.cliente.findUniqueOrThrow({ where: { id: clienteId }, select: { ...identidad, sexo: true, tipoDocumento: true, documento: true, createdAt: true } });
  const nombres = new Map(sedes.map(s => [s.id, s.nombre]));
  return {
    ...cliente,
    // Observaciones y demás historial: solo de sedes del alcance (propuesta vigente sobre D13).
    sedes: visibles.map(v => ({ sedeId: v.sedeId, sede: nombres.get(v.sedeId)!, observaciones: v.observaciones, editable: editables.ids.has(v.sedeId) })),
    editable: visibles.some(v => editables.ids.has(v.sedeId)),
    consentimientos: await estadoConsentimientos(db, organizacionId, clienteId),
  };
}

export async function actualizarCliente(db: Database, actorId: string, organizacionId: string, clienteId: string, datos: DatosCliente) {
  const d = datosValidos(datos);
  try {
    await db.$transaction(async tx => {
      await sedesVisibles(tx, actorId, organizacionId, clienteId, "cliente:editar");
      await tx.cliente.update({ where: { id: clienteId }, data: d });
      await auditar(tx, organizacionId, actorId, "cliente.actualizar", "Cliente", clienteId);
    });
  } catch (e) { conflicto(e); }
}

export async function actualizarObservaciones(db: Database, actorId: string, organizacionId: string, clienteId: string, sedeId: string, observaciones: string) {
  exigirIds(clienteId);
  const texto = observaciones.trim().slice(0, 2000) || null;
  await db.$transaction(async tx => {
    await exigirEnSede(tx, actorId, organizacionId, sedeId, "cliente:editar");
    const { count } = await tx.clienteSede.updateMany({ where: { clienteId, sedeId, organizacionId }, data: { observaciones: texto } });
    if (count !== 1) throw new AccesoDenegado();
    await auditar(tx, organizacionId, actorId, "cliente.observaciones", "Cliente", clienteId, { sedeId });
  });
}

// ─── Consentimientos ───────────────────────────────────────────────────────────

/** Última versión de cada consentimiento de la organización. */
export async function consentimientosVigentes(db: Cliente, organizacionId: string) {
  const versiones = await db.consentimientoVersion.findMany({ where: { organizacionId }, orderBy: [{ clave: "asc" }, { version: "desc" }] });
  return versiones.filter((v, i) => i === 0 || versiones[i - 1]!.clave !== v.clave);
}

async function estadoConsentimientos(db: Cliente, organizacionId: string, clienteId: string) {
  const [vigentes, registros] = await Promise.all([
    consentimientosVigentes(db, organizacionId),
    db.clienteConsentimiento.findMany({ where: { organizacionId, clienteId }, orderBy: { orden: "asc" }, select: { accion: true, createdAt: true, version: { select: { clave: true, version: true } } } }),
  ]);
  const planos = registros.map(r => ({ clave: r.version.clave, version: r.version.version, accion: r.accion, registradoEn: r.createdAt }));
  return vigentes.map(v => ({ versionId: v.id, clave: v.clave, titulo: v.titulo, texto: v.texto, tipo: v.tipo, version: v.version, estado: estadoConsentimiento(planos, v.clave, v.version) }));
}

/** Nueva versión del texto (D12 propone consentimientos globales: solo el master). */
export async function publicarConsentimiento(db: Database, actorId: string, organizacionId: string, datos: { tipo: TipoConsentimiento; clave: string; titulo: string; texto: string }) {
  if (!validarClaveConsentimiento(datos.clave)) throw new DatosInvalidos("Clave inválida: minúsculas, números y guiones");
  if (!["PRACTICA", "TERMINOS", "MARKETING"].includes(datos.tipo)) throw new DatosInvalidos("Tipo inválido");
  const titulo = datos.titulo.trim().slice(0, 120), texto = datos.texto.trim();
  if (!titulo || texto.length < 20 || texto.length > 20_000) throw new DatosInvalidos("Título obligatorio y texto de 20 a 20.000 caracteres");
  return db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    const actor = await asignacionesActor(tx, actorId, organizacionId);
    if (!actor.some(a => tienePermiso(a, "consentimiento:administrar"))) throw new AccesoDenegado();
    const anterior = await tx.consentimientoVersion.findFirst({ where: { organizacionId, clave: datos.clave }, orderBy: { version: "desc" } });
    if (anterior && anterior.tipo !== datos.tipo) throw new DatosInvalidos("Una clave no puede cambiar de tipo");
    const v = await tx.consentimientoVersion.create({ data: { organizacionId, tipo: datos.tipo, clave: datos.clave, version: (anterior?.version ?? 0) + 1, titulo, texto, creadoPor: actorId }, select: { id: true, version: true } });
    await auditar(tx, organizacionId, actorId, "consentimiento.publicar", "ConsentimientoVersion", v.id, { clave: datos.clave, version: v.version });
    return v;
  });
}

export async function textoConsentimiento(db: Database, actorId: string, organizacionId: string, versionId: string) {
  exigirIds(versionId);
  const { ids, organizacional } = await sedesConPermiso(db, actorId, organizacionId, "cliente:leer");
  if (!ids.size && !organizacional) throw new AccesoDenegado();
  const v = await db.consentimientoVersion.findFirst({ where: { id: versionId, organizacionId } });
  if (!v) throw new AccesoDenegado();
  return v;
}

/**
 * Registro presencial en recepción. Solo se acepta la versión vigente: el cliente leyó ese texto.
 * Revocar se registra como un hecho nuevo; nada se borra ni se edita.
 */
export async function registrarConsentimiento(db: Database, actorId: string, organizacionId: string, datos: { clienteId: string; versionId: string; sedeId: string; accion: "ACEPTA" | "REVOCA" }) {
  exigirIds(datos.clienteId, datos.versionId);
  if (datos.accion !== "ACEPTA" && datos.accion !== "REVOCA") throw new DatosInvalidos("Acción inválida");
  await db.$transaction(async tx => {
    await exigirEnSede(tx, actorId, organizacionId, datos.sedeId, "cliente:editar");
    if (!await tx.clienteSede.count({ where: { clienteId: datos.clienteId, sedeId: datos.sedeId, organizacionId } })) throw new AccesoDenegado();
    const version = await tx.consentimientoVersion.findFirst({ where: { id: datos.versionId, organizacionId } });
    if (!version) throw new AccesoDenegado();
    const vigente = (await consentimientosVigentes(tx, organizacionId)).find(v => v.clave === version.clave);
    if (datos.accion === "ACEPTA" && vigente?.id !== version.id) throw new DatosInvalidos("Hay una versión más nueva de ese texto; mostrá la vigente");
    await tx.clienteConsentimiento.create({ data: {
      organizacionId, clienteId: datos.clienteId, versionId: version.id, sedeId: datos.sedeId, accion: datos.accion,
      canal: "RECEPCION", registradoPor: actorId, evidencia: { modo: "presencial", declaradoPor: "personal de recepción" },
    } });
    await auditar(tx, organizacionId, actorId, datos.accion === "ACEPTA" ? "consentimiento.aceptar" : "consentimiento.revocar", "Cliente", datos.clienteId, { clave: version.clave, version: version.version, sedeId: datos.sedeId });
  });
}
