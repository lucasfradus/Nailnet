import { AccesoDenegado, cubreSede, tienePermiso, type Permiso } from "@nailnet/domain";
import { aCentavos, importe, servicioEfectivo, validarBuffer, validarDuracion, validarSena, type Sena, type TipoSena } from "@nailnet/domain/catalogo";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, bloquearOrganizacion, exigirIds, mapaSedes } from "./access.ts";

type Tx = Prisma.TransactionClient;
const TIPOS_SENA: readonly TipoSena[] = ["NINGUNA", "FIJA", "PORCENTAJE"];

function nombreValido(nombre: string, max = 120) {
  const n = nombre.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!n || n.length > max) throw new DatosInvalidos(`Nombre inválido: entre 1 y ${max} caracteres`);
  return n;
}
function unico(e: unknown, mensaje: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos(mensaje);
  throw e;
}
async function exigirOrganizacional(tx: Tx | Database, actorId: string, organizacionId: string, permiso: Permiso) {
  const actor = await asignacionesActor(tx, actorId, organizacionId);
  if (!actor.some(a => tienePermiso(a, permiso))) throw new AccesoDenegado();
}
async function exigirSede(db: Tx | Database, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  exigirIds(sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (!actor.some(a => tienePermiso(a, permiso) && cubreSede(a, sedeId, franquiciadoDe))) throw new AccesoDenegado();
}

/** Sena desde columnas: Decimal → cadena exacta con 2 decimales (porcentaje sin decimales). */
function senaDe(tipo: TipoSena | null, valor: Prisma.Decimal | null): Sena {
  if (!tipo) return null;
  return { tipo, valor: valor === null ? null : tipo === "PORCENTAJE" ? valor.toFixed(0) : valor.toFixed(2) };
}
function senaAColumnas(sena: Sena) {
  if (sena && !TIPOS_SENA.includes(sena.tipo)) throw new DatosInvalidos("Tipo de seña inválido");
  const valor = sena?.valor ? (sena.tipo === "FIJA" ? importe(aCentavos(sena.valor) ?? -1n) : sena.valor.trim()) : null;
  return { senaTipo: sena?.tipo ?? null, senaValor: valor };
}

// ─── Catálogo global (solo master: propuesta D12) ─────────────────────────────

export async function listarCatalogo(db: Database, actorId: string, organizacionId: string) {
  await exigirOrganizacional(db, actorId, organizacionId, "sede:leer");
  const [categorias, skills, tiposRecurso, claves] = await Promise.all([
    db.categoriaServicio.findMany({
      where: { organizacionId }, orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      include: { servicios: { orderBy: { nombre: "asc" }, include: { skills: { select: { skillId: true } }, recursos: { select: { tipoRecursoId: true, cantidad: true } }, consentimientos: { select: { clave: true } } } } },
    }),
    db.skill.findMany({ where: { organizacionId }, orderBy: { nombre: "asc" } }),
    db.tipoRecurso.findMany({ where: { organizacionId }, orderBy: { nombre: "asc" } }),
    db.consentimientoVersion.findMany({ where: { organizacionId, tipo: "PRACTICA" }, distinct: ["clave"], select: { clave: true, titulo: true }, orderBy: [{ clave: "asc" }, { version: "desc" }] }),
  ]);
  return {
    categorias: categorias.map(c => ({ ...c, servicios: c.servicios.map(s => ({ ...s, sena: senaDe(s.senaTipo, s.senaValor), senaValor: undefined, senaTipo: undefined })) })),
    skills, tiposRecurso, consentimientos: claves,
  };
}

export async function crearCategoria(db: Database, actorId: string, organizacionId: string, nombre: string, orden = 0) {
  const n = nombreValido(nombre, 60);
  try {
    return await db.$transaction(async tx => {
      await exigirOrganizacional(tx, actorId, organizacionId, "catalogo:administrar");
      const c = await tx.categoriaServicio.create({ data: { organizacionId, nombre: n, orden: Math.trunc(orden) || 0 }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, "catalogo.categoria", "CategoriaServicio", c.id, { nombre: n });
      return c;
    });
  } catch (e) { unico(e, "Ya existe una categoría con ese nombre"); }
}

export async function crearSkill(db: Database, actorId: string, organizacionId: string, nombre: string) {
  const n = nombreValido(nombre, 60);
  try {
    return await db.$transaction(async tx => {
      await exigirOrganizacional(tx, actorId, organizacionId, "catalogo:administrar");
      const s = await tx.skill.create({ data: { organizacionId, nombre: n }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, "catalogo.skill", "Skill", s.id, { nombre: n });
      return s;
    });
  } catch (e) { unico(e, "Ya existe una habilidad con ese nombre"); }
}

export async function crearTipoRecurso(db: Database, actorId: string, organizacionId: string, nombre: string) {
  const n = nombreValido(nombre, 60);
  try {
    return await db.$transaction(async tx => {
      await exigirOrganizacional(tx, actorId, organizacionId, "catalogo:administrar");
      const t = await tx.tipoRecurso.create({ data: { organizacionId, nombre: n }, select: { id: true } });
      await auditar(tx, organizacionId, actorId, "catalogo.tipoRecurso", "TipoRecurso", t.id, { nombre: n });
      return t;
    });
  } catch (e) { unico(e, "Ya existe un tipo de recurso con ese nombre"); }
}

export type DatosServicio = {
  categoriaId: string; nombre: string; descripcion?: string | null;
  duracionMinutos: number; bufferAntesMinutos: number; bufferDespuesMinutos: number;
  sena: Sena; activo: boolean;
  skillIds: string[]; recursos: { tipoRecursoId: string; cantidad: number }[]; consentimientos: string[];
};

/** Alta (sin id) o edición completa. Cambios de duración o precio no alteran reservas ya tomadas (snapshots). */
export async function guardarServicio(db: Database, actorId: string, organizacionId: string, datos: DatosServicio, servicioId?: string) {
  exigirIds(servicioId, datos.categoriaId, ...datos.skillIds, ...datos.recursos.map(r => r.tipoRecursoId));
  const nombre = nombreValido(datos.nombre);
  for (const error of [validarDuracion(datos.duracionMinutos), validarBuffer(datos.bufferAntesMinutos), validarBuffer(datos.bufferDespuesMinutos), validarSena(datos.sena, null)]) if (error) throw new DatosInvalidos(error);
  if (datos.recursos.some(r => !Number.isInteger(r.cantidad) || r.cantidad < 1 || r.cantidad > 10)) throw new DatosInvalidos("Cantidad de recursos entre 1 y 10");
  if (new Set(datos.recursos.map(r => r.tipoRecursoId)).size !== datos.recursos.length) throw new DatosInvalidos("Tipo de recurso repetido");
  const base = {
    categoriaId: datos.categoriaId, nombre, descripcion: datos.descripcion?.trim().slice(0, 1000) || null,
    duracionMinutos: datos.duracionMinutos, bufferAntesMinutos: datos.bufferAntesMinutos, bufferDespuesMinutos: datos.bufferDespuesMinutos,
    ...senaAColumnas(datos.sena), activo: datos.activo,
  };
  try {
    return await db.$transaction(async tx => {
      await bloquearOrganizacion(tx, organizacionId);
      await exigirOrganizacional(tx, actorId, organizacionId, "catalogo:administrar");
      const claves = [...new Set(datos.consentimientos)];
      const existentes = await tx.consentimientoVersion.findMany({ where: { organizacionId, clave: { in: claves }, tipo: "PRACTICA" }, distinct: ["clave"], select: { clave: true } });
      if (existentes.length !== claves.length) throw new DatosInvalidos("Consentimiento inexistente o que no es de práctica");
      // Las FK compuestas (organización, id) rechazan categorías, skills o tipos de otra organización.
      if (servicioId && !await tx.servicio.count({ where: { id: servicioId, organizacionId } })) throw new AccesoDenegado();
      const s = servicioId
        ? await tx.servicio.update({ where: { id: servicioId }, data: base, select: { id: true } })
        : await tx.servicio.create({ data: { organizacionId, ...base }, select: { id: true } });
      await tx.servicioSkill.deleteMany({ where: { servicioId: s.id } });
      await tx.servicioRequisitoRecurso.deleteMany({ where: { servicioId: s.id } });
      await tx.servicioConsentimiento.deleteMany({ where: { servicioId: s.id } });
      await tx.servicioSkill.createMany({ data: [...new Set(datos.skillIds)].map(skillId => ({ organizacionId, servicioId: s.id, skillId })) });
      await tx.servicioRequisitoRecurso.createMany({ data: datos.recursos.map(r => ({ organizacionId, servicioId: s.id, ...r })) });
      await tx.servicioConsentimiento.createMany({ data: claves.map(clave => ({ organizacionId, servicioId: s.id, clave })) });
      await auditar(tx, organizacionId, actorId, servicioId ? "catalogo.servicio.editar" : "catalogo.servicio.crear", "Servicio", s.id, { nombre, duracionMinutos: datos.duracionMinutos });
      return s;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw new AccesoDenegado();
    unico(e, "Ya existe un servicio con ese nombre");
  }
}

// ─── Condiciones por sede ─────────────────────────────────────────────────────

/** Catálogo de una sede con precio, duración y seña efectivos, y por qué no se ofrece online. */
export async function catalogoSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  await exigirSede(db, actorId, organizacionId, sedeId, "sede:leer");
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  const servicios = await db.servicio.findMany({
    where: { organizacionId },
    include: { categoria: { select: { nombre: true, orden: true } }, sedes: { where: { sedeId } } },
    orderBy: [{ categoria: { orden: "asc" } }, { nombre: "asc" }],
  });
  return {
    puedeEditar: actor.some(a => tienePermiso(a, "catalogo:precios") && cubreSede(a, sedeId, franquiciadoDe)),
    servicios: servicios.map(s => {
      const ss = s.sedes[0];
      const enSede = ss ? { habilitado: ss.habilitado, precio: ss.precio?.toFixed(2) ?? null, duracionMinutos: ss.duracionMinutos, sena: senaDe(ss.senaTipo, ss.senaValor), reservableOnline: ss.reservableOnline } : null;
      return {
        id: s.id, nombre: s.nombre, categoria: s.categoria.nombre, activo: s.activo, duracionBase: s.duracionMinutos, senaBase: senaDe(s.senaTipo, s.senaValor),
        enSede, efectivo: servicioEfectivo({ duracionMinutos: s.duracionMinutos, bufferAntesMinutos: s.bufferAntesMinutos, bufferDespuesMinutos: s.bufferDespuesMinutos, sena: senaDe(s.senaTipo, s.senaValor), activo: s.activo }, enSede),
      };
    }),
  };
}

/** duracionMinutos y sena en null = usar los del servicio. El precio es solo de la sede. */
export async function guardarServicioSede(db: Database, actorId: string, organizacionId: string, sedeId: string, servicioId: string, datos: { habilitado: boolean; precio: string | null; duracionMinutos: number | null; sena: Sena; reservableOnline: boolean }) {
  exigirIds(servicioId);
  const precio = datos.precio?.trim() ? aCentavos(datos.precio) : null;
  if (datos.precio?.trim() && precio === null) throw new DatosInvalidos("Precio inválido");
  if (datos.habilitado && precio === null) throw new DatosInvalidos("Para habilitar el servicio indicá el precio");
  if (datos.duracionMinutos !== null) { const e = validarDuracion(datos.duracionMinutos); if (e) throw new DatosInvalidos(e); }
  const errorSena = validarSena(datos.sena, precio);
  if (errorSena) throw new DatosInvalidos(errorSena);
  await db.$transaction(async tx => {
    await bloquearOrganizacion(tx, organizacionId);
    await exigirSede(tx, actorId, organizacionId, sedeId, "catalogo:precios");
    const servicio = await tx.servicio.findFirst({ where: { id: servicioId, organizacionId }, select: { senaTipo: true, senaValor: true } });
    if (!servicio) throw new AccesoDenegado();
    // La seña heredada también debe caber en el precio de esta sede.
    const heredada = datos.sena ? null : senaDe(servicio.senaTipo, servicio.senaValor);
    if (heredada && precio !== null) { const e = validarSena(heredada, precio); if (e) throw new DatosInvalidos(`${e} (seña del servicio)`); }
    const valores = { habilitado: datos.habilitado, precio: precio === null ? null : importe(precio), duracionMinutos: datos.duracionMinutos, ...senaAColumnas(datos.sena), reservableOnline: datos.reservableOnline };
    await tx.servicioSede.upsert({ where: { servicioId_sedeId: { servicioId, sedeId } }, create: { organizacionId, servicioId, sedeId, ...valores }, update: valores });
    await auditar(tx, organizacionId, actorId, "catalogo.sede", "Servicio", servicioId, { sedeId, ...valores });
  });
}
