import { emailRecuperacion, emailReservaCancelada, emailReservaConfirmada, emailReservaReprogramada, type DatosEmailReserva, type MensajeEmail } from "@nailnet/domain/emails";
import { RANGO_ENVIO, type EstadoEntrega } from "@nailnet/domain/resend";
import { cifrar, descifrar, type Llavero } from "@nailnet/domain/secretos";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";
import { llaveroEntorno } from "./configuracion.ts";
import { ErrorPermanente, encolarJob, resumenError, type JobTomado } from "./jobs.ts";

type Tx = Prisma.TransactionClient;

/**
 * Emails transaccionales (P03). Ver docs/24-emails.md.
 *
 * - Se encolan en la misma transacción que el evento (outbox): si el cambio se revierte, no sale ningún
 *   email; si confirma, el trabajo existe aunque el proceso se caiga.
 * - La clave del trabajo es también la clave de idempotencia del proveedor y la de la evidencia
 *   (EnvioEmail): un mismo evento no genera dos emails, aunque el trabajo se ejecute dos veces.
 * - El payload lleva referencias. Los datos se leen al enviar: si la reserva cambió mientras tanto
 *   (se canceló, ya pasó), el email se omite y queda registrado por qué.
 * - El enlace de recuperación es un secreto: viaja cifrado con el llavero del servidor (doc 11).
 */
export const TIPO_EMAIL = {
  confirmada: "email.reserva_confirmada",
  cancelada: "email.reserva_cancelada",
  reprogramada: "email.reserva_reprogramada",
  recuperacion: "email.recuperacion",
} as const;
export const TIPOS_EMAIL: readonly string[] = Object.values(TIPO_EMAIL);

/** Lo que este módulo necesita para enviar. Lo arma el worker (Resend o transporte falso); las pruebas usan uno propio. */
export type TransporteEmail = {
  readonly nombre: "resend" | "simulado";
  enviar(m: { para: string; asunto: string; html: string; texto: string; claveIdempotencia: string; etiquetas?: Record<string, string> }, signal?: AbortSignal): Promise<{ id: string }>;
};

// ─── Encolar ─────────────────────────────────────────────────────────────────

type EventoReserva = { organizacionId: string; reservaId: string; tipo: string; estadoNuevo: string; detalle?: Prisma.InputJsonValue };

/**
 * Decide si un evento de reserva lleva email y lo encola. Lo llama `registrarEvento`, dentro de la
 * transacción del cambio:
 * - confirmada: reserva creada ya confirmada, o pendiente que se confirmó (seña aprobada);
 * - cancelada;
 * - reprogramada: un solo email con el horario nuevo (la reserva nueva no manda otra confirmación).
 * Sin email del cliente no se encola nada.
 */
export async function encolarEmailReserva(tx: Tx, ev: EventoReserva) {
  const d = (ev.detalle && typeof ev.detalle === "object" && !Array.isArray(ev.detalle) ? ev.detalle : {}) as Record<string, unknown>;
  let tipo: string;
  let payload: { reservaId: string; anteriorId?: string };
  if (ev.tipo === "REPROGRAMADA" && typeof d.nuevaReservaId === "string") { tipo = TIPO_EMAIL.reprogramada; payload = { reservaId: d.nuevaReservaId, anteriorId: ev.reservaId }; }
  else if ((ev.tipo === "CREADA" && ev.estadoNuevo === "CONFIRMADA" && !d.reprogramadaDesde) || ev.tipo === "CONFIRMADA") { tipo = TIPO_EMAIL.confirmada; payload = { reservaId: ev.reservaId }; }
  else if (ev.tipo === "CANCELADA") { tipo = TIPO_EMAIL.cancelada; payload = { reservaId: ev.reservaId }; }
  else return null;
  const destino = await tx.reserva.findUnique({ where: { id: payload.reservaId }, select: { cliente: { select: { email: true } } } });
  if (!destino?.cliente?.email) return null;
  return encolarJob(tx, { tipo, clave: `${tipo}:${ev.reservaId}`, payload, organizacionId: ev.organizacionId });
}

const contextoRecuperacion = (tokenId: string) => `email.recuperacion|${tokenId}`;

/**
 * Encola el email de recuperación, en la transacción que emite el token. El enlace (que contiene el
 * token) va cifrado en el payload; en la base no queda en claro en ningún lado. Pocos intentos: el
 * enlace vence a los 30 minutos y después no tiene sentido mandarlo.
 */
export async function encolarEmailRecuperacion(tx: Tx, datos: { usuarioId: string; tokenId: string; enlace: string; llavero: Llavero }) {
  return encolarJob(tx, {
    tipo: TIPO_EMAIL.recuperacion, clave: `${TIPO_EMAIL.recuperacion}:${datos.tokenId}`, maxIntentos: 5,
    payload: { tokenId: datos.tokenId, usuarioId: datos.usuarioId, enlace: cifrar(datos.llavero, datos.enlace, contextoRecuperacion(datos.tokenId)) },
  });
}

// ─── Enviar ──────────────────────────────────────────────────────────────────

type Referencias = { organizacionId: string | null; reservaId?: string; usuarioId?: string };
type Armado = (Referencias & { para: string; mensaje: MensajeEmail }) | (Referencias & { omitir: string });

const texto = (v: unknown) => (typeof v === "string" && v ? v : null);

async function armarReserva(db: Database, job: Pick<JobTomado, "tipo" | "payload">, ahora: Date): Promise<Armado> {
  const p = (job.payload ?? {}) as Record<string, unknown>;
  const reservaId = texto(p.reservaId), anteriorId = texto(p.anteriorId);
  if (!reservaId || (job.tipo === TIPO_EMAIL.reprogramada && !anteriorId)) throw new ErrorPermanente("Payload de email inválido");
  const r = await db.reserva.findUnique({
    where: { id: reservaId },
    select: {
      organizacionId: true, estado: true,
      sede: { select: { nombre: true, timezone: true } },
      cliente: { select: { nombre: true, email: true } },
      items: { orderBy: { posicion: "asc" }, select: { inicio: true, servicio: { select: { nombre: true } }, profesional: { select: { nombre: true } } } },
    },
  });
  if (!r || !r.items.length) throw new ErrorPermanente("La reserva no existe");
  const ref: Referencias = { organizacionId: r.organizacionId, reservaId: anteriorId ?? reservaId };
  if (!r.cliente?.email) return { ...ref, omitir: "El cliente no tiene email" };
  if (r.items[0]!.inicio <= ahora) return { ...ref, omitir: "El turno ya empezó" };
  const esperado = job.tipo === TIPO_EMAIL.cancelada ? "CANCELADA" : "CONFIRMADA";
  // Una confirmación que llega tarde (el turno ya se canceló o se reprogramó) no se manda: el cliente
  // recibe el email del cambio, que es el que vale.
  if (r.estado !== esperado) return { ...ref, omitir: `La reserva ya no está ${esperado === "CANCELADA" ? "cancelada" : "confirmada"} (${r.estado})` };
  const org = await db.organizacion.findUniqueOrThrow({ where: { id: r.organizacionId }, select: { nombre: true } });
  const datos: DatosEmailReserva = {
    marca: org.nombre, sede: r.sede.nombre, timezone: r.sede.timezone, cliente: r.cliente.nombre,
    items: r.items.map(i => ({ servicio: i.servicio.nombre, profesional: i.profesional.nombre, inicio: i.inicio })),
  };
  let mensaje: MensajeEmail;
  if (job.tipo === TIPO_EMAIL.reprogramada) {
    const anterior = await db.reservaItem.findFirst({ where: { reservaId: anteriorId! }, orderBy: { posicion: "asc" }, select: { inicio: true } });
    if (!anterior) throw new ErrorPermanente("La reserva original no existe");
    mensaje = emailReservaReprogramada({ ...datos, anterior: anterior.inicio });
  } else mensaje = job.tipo === TIPO_EMAIL.cancelada ? emailReservaCancelada(datos) : emailReservaConfirmada(datos);
  return { ...ref, para: r.cliente.email, mensaje };
}

async function armarRecuperacion(db: Database, job: Pick<JobTomado, "payload">, ahora: Date, llavero: () => Llavero): Promise<Armado> {
  const p = (job.payload ?? {}) as Record<string, unknown>;
  const tokenId = texto(p.tokenId), cifrado = texto(p.enlace);
  if (!tokenId || !cifrado) throw new ErrorPermanente("Payload de email inválido");
  const t = await db.tokenRecuperacion.findUnique({
    where: { id: tokenId },
    select: { usadoEn: true, expiraEn: true, usuario: { select: { id: true, email: true, nombre: true, activo: true, membresias: { where: { activo: true, organizacion: { activo: true } }, orderBy: { createdAt: "asc" }, take: 1, select: { organizacion: { select: { id: true, nombre: true } } } } } } },
  });
  if (!t) throw new ErrorPermanente("El token de recuperación no existe");
  const org = t.usuario.membresias[0]?.organizacion ?? null;
  const ref: Referencias = { organizacionId: org?.id ?? null, usuarioId: t.usuario.id };
  // Usado, vencido o reemplazado por un pedido posterior (emitir uno nuevo consume los anteriores).
  if (t.usadoEn || t.expiraEn <= ahora) return { ...ref, omitir: "El enlace ya se usó, venció o fue reemplazado" };
  if (!t.usuario.activo || !org) return { ...ref, omitir: "Usuario deshabilitado" };
  const enlace = descifrar(llavero(), cifrado, contextoRecuperacion(tokenId));
  const minutos = Math.max(1, Math.floor((t.expiraEn.getTime() - ahora.getTime()) / 60_000));
  return { ...ref, para: t.usuario.email, mensaje: emailRecuperacion({ marca: org.nombre, nombre: t.usuario.nombre, enlace, minutos }) };
}

export type ResultadoEmail = { envioId: string; estado: string; proveedorId?: string | null; motivo?: string; repetido?: boolean };

/**
 * Manejador de los trabajos `email.*`. Idempotente: si la evidencia ya registra el envío aceptado (el
 * trabajo se repite tras un lease vencido), no vuelve a enviar. Cada intento queda en EnvioEmail:
 * destinatario, asunto, intentos, último error y, al aceptarse, el id del proveedor.
 *
 * Errores: los transitorios se relanzan tal cual (la cola reintenta con espera creciente); los
 * permanentes llegan como ErrorPermanente (el worker traduce los del proveedor) y el envío queda FALLIDO.
 */
export async function procesarEmail(db: Database, transporte: TransporteEmail, job: Pick<JobTomado, "tipo" | "clave" | "payload" | "intentos" | "maxIntentos">, contexto: { ahora?: Date; llavero?: () => Llavero; signal?: AbortSignal } = {}): Promise<ResultadoEmail> {
  const ahora = contexto.ahora ?? new Date();
  const previo = await db.envioEmail.findUnique({ where: { clave: job.clave }, select: { id: true, estado: true, proveedorId: true, motivo: true } });
  // Ya aceptado por el proveedor (tiene id) u omitido: no se manda de nuevo. Un FALLIDO propio, sin id,
  // sí se reintenta si alguien rearma el trabajo (p. ej. después de verificar el dominio).
  if (previo && (previo.proveedorId || previo.estado === "OMITIDO")) return { envioId: previo.id, estado: previo.estado, proveedorId: previo.proveedorId, repetido: true };

  let armado: Armado;
  if (job.tipo === TIPO_EMAIL.recuperacion) armado = await armarRecuperacion(db, job, ahora, contexto.llavero ?? llaveroEntorno);
  else if (TIPOS_EMAIL.includes(job.tipo)) armado = await armarReserva(db, job, ahora);
  else throw new ErrorPermanente(`Tipo de email desconocido: ${job.tipo}`);

  const refs = { tipo: job.tipo, organizacionId: armado.organizacionId, reservaId: armado.reservaId ?? null, usuarioId: armado.usuarioId ?? null };
  if ("omitir" in armado) {
    const fila = await db.envioEmail.upsert({ where: { clave: job.clave }, create: { clave: job.clave, ...refs, estado: "OMITIDO", motivo: armado.omitir }, update: { estado: "OMITIDO", motivo: armado.omitir } });
    return { envioId: fila.id, estado: "OMITIDO", motivo: armado.omitir };
  }

  const datos = { destinatario: armado.para.slice(0, 320), asunto: armado.mensaje.asunto, proveedor: transporte.nombre };
  const fila = await db.envioEmail.upsert({
    where: { clave: job.clave },
    create: { clave: job.clave, ...refs, ...datos, estado: "PENDIENTE", intentos: 1 },
    update: { ...datos, intentos: { increment: 1 } },
    select: { id: true },
  });
  try {
    const { id } = await transporte.enviar({ para: armado.para, ...armado.mensaje, claveIdempotencia: job.clave, etiquetas: { tipo: job.tipo.replace(/^email\./, "") } }, contexto.signal);
    const estado = transporte.nombre === "simulado" ? "SIMULADO" : "ENVIADO";
    await db.envioEmail.update({ where: { id: fila.id }, data: { estado, proveedorId: id, enviadoEn: new Date(), ultimoError: null } });
    return { envioId: fila.id, estado, proveedorId: id };
  } catch (e) {
    const definitivo = e instanceof ErrorPermanente || job.intentos >= job.maxIntentos;
    await db.envioEmail.update({ where: { id: fila.id }, data: { estado: definitivo ? "FALLIDO" : "PENDIENTE", ultimoError: resumenError(e) } });
    throw e;
  }
}

// ─── Entrega (webhook del proveedor) ─────────────────────────────────────────

/**
 * Aplica un evento de entrega informado por el proveedor (entregado, demorado, rebotado, queja). Solo
 * avanza el estado: eventos repetidos o desordenados no lo hacen retroceder. Un id desconocido se
 * ignora (puede ser un email de otro ambiente que comparte la cuenta de Resend).
 */
export async function registrarEntregaEmail(db: Database, evento: { proveedorId: string; estado: EstadoEntrega; fecha: Date; motivo?: string | null }): Promise<"ACTUALIZADO" | "SIN_CAMBIO" | "DESCONOCIDO"> {
  for (let intento = 0; intento < 3; intento++) {
    const fila = await db.envioEmail.findUnique({ where: { proveedorId: evento.proveedorId.slice(0, 200) }, select: { id: true, estado: true } });
    if (!fila) return "DESCONOCIDO";
    if (RANGO_ENVIO[evento.estado]! <= RANGO_ENVIO[fila.estado]!) return "SIN_CAMBIO";
    const motivo = evento.motivo?.replace(/[\u0000-\u001f]+/g, " ").slice(0, 500) || null;
    // Condicional sobre el estado leído: dos eventos simultáneos no se pisan.
    const { count } = await db.envioEmail.updateMany({ where: { id: fila.id, estado: fila.estado }, data: { estado: evento.estado, eventoEn: evento.fecha, ...(motivo ? { motivo } : {}) } });
    if (count) return "ACTUALIZADO";
  }
  return "SIN_CAMBIO";
}
