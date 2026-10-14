import { AccesoDenegado, tienePermiso } from "@nailnet/domain";
import {
  ACCIONES, FUENTES, POLITICA_INCIDENCIAS, accionesPermitidas, alcanzaIncidencia, clasificarEmail, clasificarPago, clasificarTrabajo,
  estadoIncidencia, normalizarNota, referenciasTrabajo, validarNota,
  type EstadoIncidencia, type FuenteIncidencia, type TipoAccion, type TipoIncidencia,
} from "@nailnet/domain/incidencias";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, exigirIds } from "./access.ts";

type Tx = Prisma.TransactionClient;
type Cliente = Database | Tx;

/**
 * Bandeja de incidencias (M04, doc 28). Se arma leyendo las fuentes (Job, Pago, EnvioEmail) y las
 * acciones registradas (AccionIncidencia). No hay una tabla de incidencias que sincronizar: la fuente
 * es la verdad y la acción es la evidencia de quién hizo qué. Nada se borra.
 */

/** Por fuente, como mucho: suficiente para el piloto. La pantalla avisa si se cortó. */
const LIMITE = 200;
const ENTIDAD: Record<FuenteIncidencia, string> = { TRABAJO: "Job", PAGO: "Pago", EMAIL: "EnvioEmail" };
const TURNO_VIGENTE = ["PENDIENTE_PAGO", "PAGO_EN_REVISION", "CONFIRMADA", "ATENDIDA", "AUSENTE"] as const;

export type Incidencia = {
  fuente: FuenteIncidencia; id: string;
  /** null: la fuente ya no está en un estado problemático (solo se llega así por la ficha). */
  tipo: TipoIncidencia | null; estado: EstadoIncidencia;
  organizacionId: string | null; sedeId: string | null; sede: string | null;
  /** Último cambio de la fuente: marca la ocurrencia actual. */
  desde: Date; creado: Date;
  estadoFuente: string;
  /** Error resumido o motivo. Nunca payloads ni secretos. */
  detalle: string | null;
  trabajo?: { tipo: string; clave: string; intentos: number; maxIntentos: number; proximoIntento: Date; reservaId: string | null };
  pago?: { monto: string; moneda: string; externoId: string; estadoExterno: string; detalleExterno: string | null; reservaId: string; estadoReserva: string; reprogramadaA: string | null };
  email?: { tipo: string; clave: string; destinatario: string | null; asunto: string | null; reservaId: string | null; intentos: number };
  /** Lo que el actor puede hacer ahora. */
  acciones: TipoAccion[];
};

// ─── Alcance ───────────────────────────────────────────────────────────────────

async function alcance(db: Cliente, actorId: string, organizacionId: string) {
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const gestiona = actor.filter(a => tienePermiso(a, "incidencia:gestionar"));
  if (!gestiona.length) throw new AccesoDenegado();
  const sedes = await db.sede.findMany({ where: { organizacionId }, select: { id: true, nombre: true, franquiciadoId: true, activo: true }, orderBy: [{ nombre: "asc" }, { id: "asc" }] });
  const mapa = new Map(sedes.map(s => [s.id, s]));
  const franquiciadoDe = (id: string) => mapa.get(id)?.franquiciadoId;
  const ve = (i: { organizacionId: string | null; sedeId: string | null }) => alcanzaIncidencia(actor, i, franquiciadoDe);
  return {
    organizacionId, ve, mapa,
    organizacional: gestiona.some(a => a.alcance === "ORGANIZACION"),
    sedes: sedes.filter(s => ve({ organizacionId, sedeId: s.id })),
  };
}
type Alcance = Awaited<ReturnType<typeof alcance>>;

// ─── Carga de fuentes ──────────────────────────────────────────────────────────

type Fila = Omit<Incidencia, "estado" | "acciones">;
type Carga = { fuente?: FuenteIncidencia; ids?: string[] };

/** Trabajos de la organización (y del sistema, sin organización, solo para el alcance de organización). */
const deLaOrganizacion = (ctx: Alcance) => ctx.organizacional ? { OR: [{ organizacionId: ctx.organizacionId }, { organizacionId: null }] } : { organizacionId: ctx.organizacionId };

async function sedesDeReservas(db: Cliente, organizacionId: string, ids: (string | null)[]) {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map<string, string>();
  const reservas = await db.reserva.findMany({ where: { organizacionId, id: { in: unicos } }, select: { id: true, sedeId: true } });
  return new Map(reservas.map(r => [r.id, r.sedeId]));
}

async function cargarTrabajos(db: Cliente, ctx: Alcance, c: Carga, ahora: Date) {
  const limite = new Date(ahora.getTime() - POLITICA_INCIDENCIAS.toleranciaColaMs);
  const problema: Prisma.JobWhereInput = { OR: [
    { estado: "FALLIDO" },
    { estado: "PENDIENTE", proximoIntento: { lte: limite } },
    { estado: "EN_PROCESO", leaseHasta: { lte: limite } },
  ] };
  const jobs = await db.job.findMany({
    where: { AND: [deLaOrganizacion(ctx), c.ids ? { id: { in: c.ids } } : problema] },
    select: { id: true, organizacionId: true, tipo: true, clave: true, payload: true, estado: true, intentos: true, maxIntentos: true, proximoIntento: true, leaseHasta: true, ultimoError: true, createdAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: LIMITE,
  });
  const refs = new Map(jobs.map(j => [j.id, referenciasTrabajo(j.payload)]));
  const reservas = await sedesDeReservas(db, ctx.organizacionId, jobs.filter(j => j.organizacionId === ctx.organizacionId).map(j => refs.get(j.id)!.reservaId));
  const filas = jobs.map((j): Fila => {
    const r = refs.get(j.id)!;
    // La sede sale del payload (pagos) o de la reserva (emails), siempre de esta organización. Un
    // trabajo del sistema (sin organización) nunca se atribuye a una sede.
    const sedeId = j.organizacionId !== ctx.organizacionId ? null
      : r.sedeId && ctx.mapa.has(r.sedeId) ? r.sedeId : (r.reservaId && reservas.get(r.reservaId)) || null;
    return {
      fuente: "TRABAJO", id: j.id, tipo: clasificarTrabajo(j, ahora), organizacionId: j.organizacionId, sedeId, sede: sedeId ? ctx.mapa.get(sedeId)?.nombre ?? null : null,
      desde: j.updatedAt, creado: j.createdAt, estadoFuente: j.estado, detalle: j.ultimoError,
      trabajo: { tipo: j.tipo, clave: j.clave, intentos: j.intentos, maxIntentos: j.maxIntentos, proximoIntento: j.proximoIntento, reservaId: j.organizacionId === ctx.organizacionId ? r.reservaId : null },
    };
  });
  return { filas, truncado: jobs.length === LIMITE };
}

async function cargarPagos(db: Cliente, ctx: Alcance, c: Carga, ahora: Date) {
  const problema: Prisma.PagoWhereInput = { OR: [
    { estado: "A_DEVOLVER" },
    { estado: "EN_PROCESO", updatedAt: { lte: new Date(ahora.getTime() - POLITICA_INCIDENCIAS.pagoAmbiguoMs) } },
    { estado: "APROBADO", reserva: { estado: { in: ["CANCELADA", "EXPIRADA"] } } },
    { estado: "REEMBOLSADO", motivo: null, reserva: { estado: { in: [...TURNO_VIGENTE] } } },
  ] };
  const pagos = await db.pago.findMany({
    where: { AND: [{ organizacionId: ctx.organizacionId }, c.ids ? { id: { in: c.ids } } : problema] },
    select: {
      id: true, organizacionId: true, sedeId: true, reservaId: true, estado: true, motivo: true, monto: true, moneda: true, externoId: true, estadoExterno: true, detalleExterno: true, createdAt: true, updatedAt: true,
      reserva: { select: { estado: true, reemplazadaPor: { select: { id: true } }, pagos: { where: { estado: "APROBADO" }, select: { id: true } } } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: LIMITE,
  });
  const filas = pagos.map((p): Fila => ({
    fuente: "PAGO", id: p.id,
    tipo: clasificarPago({ estado: p.estado, motivo: p.motivo, actualizado: p.updatedAt, reserva: p.reserva, otroAprobado: p.reserva.pagos.some(o => o.id !== p.id) }, ahora),
    organizacionId: p.organizacionId, sedeId: p.sedeId, sede: ctx.mapa.get(p.sedeId)?.nombre ?? null,
    desde: p.updatedAt, creado: p.createdAt, estadoFuente: p.estado, detalle: p.motivo,
    pago: { monto: p.monto.toFixed(2), moneda: p.moneda, externoId: p.externoId, estadoExterno: p.estadoExterno, detalleExterno: p.detalleExterno, reservaId: p.reservaId, estadoReserva: p.reserva.estado, reprogramadaA: p.reserva.reemplazadaPor?.id ?? null },
  }));
  return { filas, truncado: pagos.length === LIMITE };
}

async function cargarEmails(db: Cliente, ctx: Alcance, c: Carga) {
  const envios = await db.envioEmail.findMany({
    where: { AND: [deLaOrganizacion(ctx), c.ids ? { id: { in: c.ids } } : { estado: { in: ["FALLIDO", "REBOTADO", "QUEJA"] } }] },
    select: { id: true, organizacionId: true, clave: true, tipo: true, reservaId: true, destinatario: true, asunto: true, estado: true, intentos: true, ultimoError: true, motivo: true, createdAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: LIMITE,
  });
  // Un envío FALLIDO cuyo trabajo también quedó FALLIDO es una sola incidencia: la del trabajo, que es
  // la que se puede reintentar (en su ficha se ve el envío). Si el trabajo ya se rearmó y está en la
  // cola, el envío tampoco cuenta: se está reintentando.
  const duplicados = c.ids ? new Set<string>() : new Set((await db.job.findMany({ where: { estado: { in: ["FALLIDO", "PENDIENTE", "EN_PROCESO"] }, clave: { in: envios.filter(e => e.estado === "FALLIDO").map(e => e.clave) } }, select: { clave: true } })).map(j => j.clave));
  const reservas = await sedesDeReservas(db, ctx.organizacionId, envios.filter(e => e.organizacionId === ctx.organizacionId).map(e => e.reservaId));
  const filas = envios.filter(e => !duplicados.has(e.clave)).map((e): Fila => {
    const sedeId = e.organizacionId === ctx.organizacionId && e.reservaId ? reservas.get(e.reservaId) ?? null : null;
    return {
      fuente: "EMAIL", id: e.id, tipo: clasificarEmail(e.estado), organizacionId: e.organizacionId, sedeId, sede: sedeId ? ctx.mapa.get(sedeId)?.nombre ?? null : null,
      desde: e.updatedAt, creado: e.createdAt, estadoFuente: e.estado, detalle: e.ultimoError ?? e.motivo,
      email: { tipo: e.tipo, clave: e.clave, destinatario: e.destinatario, asunto: e.asunto, reservaId: sedeId ? e.reservaId : null, intentos: e.intentos },
    };
  });
  return { filas, truncado: envios.length === LIMITE };
}

/** Carga, filtra por alcance y calcula estado y acciones posibles con el historial de cada una. */
async function cargar(db: Cliente, ctx: Alcance, c: Carga, ahora: Date) {
  const quiere = (f: FuenteIncidencia) => !c.fuente || c.fuente === f;
  const partes = await Promise.all([
    quiere("TRABAJO") ? cargarTrabajos(db, ctx, c, ahora) : null,
    quiere("PAGO") ? cargarPagos(db, ctx, c, ahora) : null,
    quiere("EMAIL") ? cargarEmails(db, ctx, c) : null,
  ]);
  const filas = partes.flatMap(p => p?.filas ?? []).filter(f => (c.ids || f.tipo !== null) && ctx.ve(f));
  const acciones = filas.length ? await db.accionIncidencia.findMany({
    where: { OR: FUENTES.map(fuente => ({ fuente, entidadId: { in: filas.filter(f => f.fuente === fuente).map(f => f.id) } })) },
    select: { id: true, fuente: true, entidadId: true, accion: true, incidencia: true, nota: true, estadoFuente: true, marcaFuente: true, actorId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }) : [];
  const porFila = new Map<string, typeof acciones>();
  for (const a of acciones) porFila.set(`${a.fuente}:${a.entidadId}`, [...porFila.get(`${a.fuente}:${a.entidadId}`) ?? [], a]);
  const incidencias = filas.map((f): Incidencia & { historial: typeof acciones } => {
    const historial = porFila.get(`${f.fuente}:${f.id}`) ?? [];
    const estado = estadoIncidencia(f.desde, historial.map(a => ({ accion: a.accion, marcaFuente: a.marcaFuente, fecha: a.createdAt })));
    return { ...f, estado, acciones: accionesPermitidas({ tipo: f.tipo, estado, tipoTrabajo: f.trabajo?.tipo, estadoTrabajo: f.fuente === "TRABAJO" ? f.estadoFuente : null }), historial };
  });
  return { incidencias, truncado: partes.some(p => p?.truncado) };
}

// ─── Lectura ───────────────────────────────────────────────────────────────────

const ORDEN: Record<EstadoIncidencia, number> = { ABIERTA: 0, EN_SEGUIMIENTO: 1, RESUELTA: 2 };
export type FiltroEstado = "pendientes" | "abiertas" | "resueltas" | "todas";
export type FiltrosIncidencias = { fuente?: FuenteIncidencia; sedeId?: string | "sin-sede"; estado?: FiltroEstado };

/**
 * Bandeja del actor. `sedeId` filtra dentro del alcance y rechaza (no amplía) una sede ajena;
 * "sin-sede" (trabajos de la organización o del sistema) es solo para el alcance de organización.
 */
export async function listarIncidencias(db: Database, actorId: string, organizacionId: string, filtros: FiltrosIncidencias = {}, ahora = new Date()) {
  if (filtros.fuente !== undefined && !FUENTES.includes(filtros.fuente)) throw new DatosInvalidos("Tipo de incidencia inválido");
  if (filtros.sedeId !== undefined && filtros.sedeId !== "sin-sede") exigirIds(filtros.sedeId);
  const ctx = await alcance(db, actorId, organizacionId);
  if (filtros.sedeId === "sin-sede" && !ctx.organizacional) throw new AccesoDenegado();
  if (filtros.sedeId !== undefined && filtros.sedeId !== "sin-sede" && !ctx.sedes.some(s => s.id === filtros.sedeId)) throw new AccesoDenegado();
  const { incidencias, truncado } = await cargar(db, ctx, { fuente: filtros.fuente }, ahora);
  const estado = filtros.estado ?? "pendientes";
  const lista = incidencias
    .filter(i => filtros.sedeId === undefined || (filtros.sedeId === "sin-sede" ? i.sedeId === null : i.sedeId === filtros.sedeId))
    .filter(i => estado === "todas" || (estado === "pendientes" ? i.estado !== "RESUELTA" : estado === "abiertas" ? i.estado === "ABIERTA" : i.estado === "RESUELTA"))
    .sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || b.desde.getTime() - a.desde.getTime() || a.id.localeCompare(b.id))
    .map(({ historial, ...i }) => ({ ...i, ultimaAccion: historial.at(-1) ? { accion: historial.at(-1)!.accion, fecha: historial.at(-1)!.createdAt } : null }));
  return { incidencias: lista, sedes: ctx.sedes.map(s => ({ id: s.id, nombre: s.nombre, activo: s.activo })), organizacional: ctx.organizacional, truncado };
}

/** Incidencias sin revisar (ABIERTA) para el aviso del panel. null si el actor no tiene acceso a la bandeja. */
export async function contarIncidenciasAbiertas(db: Database, actorId: string, organizacionId: string, ahora = new Date()): Promise<number | null> {
  let ctx: Alcance;
  try { ctx = await alcance(db, actorId, organizacionId); }
  catch (e) { if (e instanceof AccesoDenegado) return null; throw e; }
  const { incidencias } = await cargar(db, ctx, {}, ahora);
  return incidencias.filter(i => i.estado === "ABIERTA").length;
}

/** Ficha: la fuente (aunque ya no tenga incidencia vigente), el historial completo y lo relacionado. */
export async function detalleIncidencia(db: Database, actorId: string, organizacionId: string, fuente: string, id: string, ahora = new Date()) {
  if (!FUENTES.includes(fuente as FuenteIncidencia)) throw new AccesoDenegado();
  exigirIds(id);
  const ctx = await alcance(db, actorId, organizacionId);
  const { incidencias } = await cargar(db, ctx, { fuente: fuente as FuenteIncidencia, ids: [id] }, ahora);
  const inc = incidencias[0];
  if (!inc) throw new AccesoDenegado();
  const actores = await db.usuario.findMany({ where: { id: { in: [...new Set(inc.historial.map(a => a.actorId))] } }, select: { id: true, nombre: true } });
  const nombre = new Map(actores.map(u => [u.id, u.nombre]));
  // Trabajo de email ↔ su evidencia: comparten la clave (doc 24).
  const clave = inc.trabajo?.clave ?? inc.email?.clave;
  const envio = inc.trabajo && clave?.startsWith("email.") ? await db.envioEmail.findUnique({ where: { clave }, select: { id: true, estado: true, destinatario: true, motivo: true, proveedorId: true } }) : null;
  const trabajo = inc.email && clave ? await db.job.findUnique({ where: { clave }, select: { id: true, estado: true } }) : null;
  const { historial, ...resto } = inc;
  return {
    incidencia: resto,
    historial: historial.map(a => ({
      id: a.id, accion: a.accion, incidencia: a.incidencia, nota: a.nota, estadoFuente: a.estadoFuente, fecha: a.createdAt,
      actor: nombre.get(a.actorId) ?? "Usuario",
      // Acción sobre una ocurrencia anterior (p. ej. antes de que el trabajo reintentado volviera a fallar).
      anterior: a.marcaFuente.getTime() < inc.desde.getTime(),
    })),
    envio: envio && { id: envio.id, estado: envio.estado, destinatario: envio.destinatario, motivo: envio.motivo, conIdProveedor: !!envio.proveedorId },
    trabajo,
  };
}

// ─── Acciones ──────────────────────────────────────────────────────────────────

const MENSAJE: Record<TipoAccion, string> = {
  REVISADA: "La incidencia ya fue revisada o resuelta",
  RESUELTA: "La incidencia ya está resuelta",
  REABIERTA: "Solo se reabre una incidencia resuelta",
  REINTENTADA: "Solo se reintenta un trabajo fallido de un tipo que admite reintento",
  DEVOLUCION_GESTIONADA: "Solo aplica a pagos a devolver o sin imputar que no estén resueltos",
};

/**
 * Registra una acción con nota obligatoria. Bloquea la fila de la fuente para serializar con otra
 * acción simultánea (y con el worker, que la saltea mientras tanto). Reintentar rearma el mismo
 * trabajo: mismo id y clave, intentos en cero; el manejador es idempotente (doc 21). Nunca borra.
 */
export async function registrarAccionIncidencia(db: Database, actorId: string, organizacionId: string, datos: { fuente: string; id: string; accion: string; nota: string }, ahora = new Date()) {
  if (!FUENTES.includes(datos.fuente as FuenteIncidencia)) throw new AccesoDenegado();
  exigirIds(datos.id);
  if (!ACCIONES.includes(datos.accion as TipoAccion)) throw new DatosInvalidos("Acción inválida");
  const error = validarNota(datos.nota);
  if (error) throw new DatosInvalidos(error);
  const fuente = datos.fuente as FuenteIncidencia, accion = datos.accion as TipoAccion, nota = normalizarNota(datos.nota);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${ENTIDAD[fuente]}"`)} WHERE id = ${datos.id}::uuid FOR UPDATE`;
    const ctx = await alcance(tx, actorId, organizacionId);
    const { incidencias } = await cargar(tx, ctx, { fuente, ids: [datos.id] }, ahora);
    const inc = incidencias[0];
    if (!inc) throw new AccesoDenegado();
    if (!inc.acciones.includes(accion)) throw new DatosInvalidos(inc.tipo === null ? "No hay una incidencia vigente: la fuente ya se normalizó" : MENSAJE[accion]);
    if (accion === "REINTENTADA") {
      const { count } = await tx.job.updateMany({ where: { id: inc.id, estado: "FALLIDO" }, data: { estado: "PENDIENTE", intentos: 0, proximoIntento: ahora, leaseHasta: null, leaseDe: null } });
      if (count !== 1) throw new DatosInvalidos(MENSAJE.REINTENTADA);
    }
    const registro = await tx.accionIncidencia.create({ data: {
      organizacionId, fuente, entidadId: inc.id, incidencia: inc.tipo!, sedeId: inc.sedeId, accion, nota,
      estadoFuente: inc.estadoFuente, marcaFuente: inc.desde, actorId, createdAt: ahora,
    }, select: { id: true } });
    await auditar(tx, organizacionId, actorId, `incidencia.${accion.toLowerCase()}`, ENTIDAD[fuente], inc.id, { incidencia: inc.tipo, sedeId: inc.sedeId, nota });
    return registro;
  });
}
