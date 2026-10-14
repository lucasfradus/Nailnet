import { cubreSede, tienePermiso, type Asignacion, type FranquiciadoDeSede } from "./access.ts";

/**
 * Incidencias operativas (M04, doc 28). Una incidencia no es una tabla propia: se deriva del estado de
 * su fuente (un trabajo de la cola, un pago, un email). Lo único que se guarda es lo que hace una
 * persona sobre ella (AccionIncidencia, solo inserción). Así nunca hay dos verdades: si la fuente sale
 * del estado problemático (el trabajo reintentado se completa, Mercado Pago informa el reembolso), la
 * incidencia deja de existir sola; si vuelve a fallar, reaparece como una ocurrencia nueva.
 *
 * Fuentes previstas: TRABAJO, PAGO y EMAIL hoy. COMPROBANTE se suma con Facturante (M02): alcanza con
 * agregar el valor al enum, su clasificador y su cargador en el repositorio.
 */
export type FuenteIncidencia = "TRABAJO" | "PAGO" | "EMAIL";
export const FUENTES: readonly FuenteIncidencia[] = ["TRABAJO", "PAGO", "EMAIL"];

export type TipoIncidencia =
  // Cola (doc 21): agotó intentos o error permanente; o quedó atrás (worker caído o trabado).
  | "TRABAJO_FALLIDO" | "TRABAJO_ATRASADO" | "TRABAJO_TRABADO"
  // Pagos (doc 23): cobrado sin turno que confirmar; seña aprobada de un turno cancelado o reprogramado;
  // estado intermedio que no se resolvió; reembolso o contracargo de una seña con el turno vigente.
  | "PAGO_A_DEVOLVER" | "PAGO_SIN_IMPUTAR" | "PAGO_AMBIGUO" | "PAGO_REEMBOLSADO_CON_TURNO"
  // Emails (doc 24): no salió, rebotó o el destinatario lo marcó como spam.
  | "EMAIL_FALLIDO" | "EMAIL_REBOTADO" | "EMAIL_QUEJA";

export type TipoAccion = "REVISADA" | "RESUELTA" | "REABIERTA" | "REINTENTADA" | "DEVOLUCION_GESTIONADA";
export const ACCIONES: readonly TipoAccion[] = ["REVISADA", "RESUELTA", "REABIERTA", "REINTENTADA", "DEVOLUCION_GESTIONADA"];

/** ABIERTA: nadie la miró. EN_SEGUIMIENTO: alguien la revisó o gestionó la devolución. RESUELTA: cerrada por una persona. */
export type EstadoIncidencia = "ABIERTA" | "EN_SEGUIMIENTO" | "RESUELTA";

export const POLITICA_INCIDENCIAS = {
  /** Mismo umbral que /ready del worker (doc 21): atrasado o lease vencido hace más de 5 minutos. */
  toleranciaColaMs: 5 * 60_000,
  /** Con binary_mode un pago no debería quedar en proceso; si sigue así media hora, alguien tiene que mirarlo. */
  pagoAmbiguoMs: 30 * 60_000,
  notaMinima: 5,
  notaMaxima: 1000,
} as const;

// ─── Clasificación de cada fuente ─────────────────────────────────────────────

export type DatosTrabajo = { estado: string; proximoIntento: Date; leaseHasta: Date | null };
export function clasificarTrabajo(j: DatosTrabajo, ahora: Date): TipoIncidencia | null {
  const limite = ahora.getTime() - POLITICA_INCIDENCIAS.toleranciaColaMs;
  if (j.estado === "FALLIDO") return "TRABAJO_FALLIDO";
  if (j.estado === "PENDIENTE" && j.proximoIntento.getTime() <= limite) return "TRABAJO_ATRASADO";
  if (j.estado === "EN_PROCESO" && j.leaseHasta !== null && j.leaseHasta.getTime() <= limite) return "TRABAJO_TRABADO";
  return null;
}

/** Turno que sigue ocupando el horario (o ya se atendió): la seña está imputada a algo vivo. */
const TURNO_VIGENTE = ["PENDIENTE_PAGO", "PAGO_EN_REVISION", "CONFIRMADA", "ATENDIDA", "AUSENTE"];

export type DatosPago = {
  estado: string; motivo: string | null; actualizado: Date;
  reserva: { estado: string };
  /** Hay otro pago APROBADO para la misma reserva (este fue un duplicado). */
  otroAprobado: boolean;
};
export function clasificarPago(p: DatosPago, ahora: Date): TipoIncidencia | null {
  switch (p.estado) {
    case "A_DEVOLVER": return "PAGO_A_DEVOLVER";
    case "EN_PROCESO": return ahora.getTime() - p.actualizado.getTime() >= POLITICA_INCIDENCIAS.pagoAmbiguoMs ? "PAGO_AMBIGUO" : null;
    // Cancelar o reprogramar un turno pagado no toca su pago (doc 23): la seña queda sin destino.
    case "APROBADO": return ["CANCELADA", "EXPIRADA"].includes(p.reserva.estado) ? "PAGO_SIN_IMPUTAR" : null;
    // Un reembolso de algo que estaba A_DEVOLVER conserva el motivo: es la devolución esperada. Sin
    // motivo era la seña de un turno; si el turno sigue vigente, el reembolso o contracargo lo deja impago.
    case "REEMBOLSADO": return p.motivo === null && !p.otroAprobado && TURNO_VIGENTE.includes(p.reserva.estado) ? "PAGO_REEMBOLSADO_CON_TURNO" : null;
    default: return null;
  }
}

export function clasificarEmail(estado: string): TipoIncidencia | null {
  if (estado === "FALLIDO") return "EMAIL_FALLIDO";
  if (estado === "REBOTADO") return "EMAIL_REBOTADO";
  if (estado === "QUEJA") return "EMAIL_QUEJA";
  // OMITIDO no es una falla: el sistema decidió no mandarlo y dejó el motivo (doc 24).
  return null;
}

// ─── Estado derivado de las acciones ──────────────────────────────────────────

export type AccionRegistrada = { accion: TipoAccion; marcaFuente: Date; fecha: Date };

/**
 * Estado de la ocurrencia actual. `marca` es el momento del último cambio de la fuente: las acciones
 * tomadas antes de esa marca eran sobre una ocurrencia anterior (p. ej. un trabajo reintentado que
 * volvió a fallar) y no cuentan, aunque siguen en el historial.
 */
export function estadoIncidencia(marca: Date, acciones: readonly AccionRegistrada[]): EstadoIncidencia {
  let estado: EstadoIncidencia = "ABIERTA";
  const vigentes = acciones.filter(a => a.marcaFuente.getTime() >= marca.getTime()).sort((x, y) => x.fecha.getTime() - y.fecha.getTime());
  for (const a of vigentes) {
    if (a.accion === "REVISADA" || a.accion === "DEVOLUCION_GESTIONADA") { if (estado !== "RESUELTA") estado = "EN_SEGUIMIENTO"; }
    else if (a.accion === "RESUELTA") estado = "RESUELTA";
    else if (a.accion === "REABIERTA") estado = "ABIERTA";
  }
  return estado;
}

// ─── Qué se puede hacer ────────────────────────────────────────────────────────

/**
 * Tipos de trabajo cuyo manejador es idempotente y se puede rearmar a mano (doc 21: "cada manejador
 * debe ser idempotente"). Emails: con id de Resend no se reenvía y Resend deduplica 24 h por clave.
 * Pagos: se vuelve a consultar el estado en la API y aplicarlo no duplica. Un tipo nuevo no se
 * reintenta desde el panel hasta revisarlo y sumarlo acá.
 */
const REINTENTABLES = new Set([
  "pagos.mercadopago", "mantenimiento.limpieza", "mercadopago.renovacion",
  "email.reserva_confirmada", "email.reserva_cancelada", "email.reserva_reprogramada", "email.recuperacion",
]);
export const reintentable = (tipoTrabajo: string) => REINTENTABLES.has(tipoTrabajo);

export function accionesPermitidas(i: { tipo: TipoIncidencia | null; estado: EstadoIncidencia; tipoTrabajo?: string | null; estadoTrabajo?: string | null }): TipoAccion[] {
  // Sin incidencia vigente (la fuente ya se normalizó) solo queda el historial.
  if (i.tipo === null) return [];
  const r: TipoAccion[] = [];
  if (i.estado === "ABIERTA") r.push("REVISADA");
  if (i.estado !== "RESUELTA") r.push("RESUELTA"); else r.push("REABIERTA");
  if (i.tipo === "TRABAJO_FALLIDO" && i.estadoTrabajo === "FALLIDO" && !!i.tipoTrabajo && reintentable(i.tipoTrabajo)) r.push("REINTENTADA");
  // Registrar que la devolución se gestionó fuera del sistema. No la da por completa: eso lo confirma
  // Mercado Pago (REEMBOLSADO) o una persona al resolver (M01 y D5 pendientes).
  if ((i.tipo === "PAGO_A_DEVOLVER" || i.tipo === "PAGO_SIN_IMPUTAR") && i.estado !== "RESUELTA") r.push("DEVOLUCION_GESTIONADA");
  return r;
}

/** Nota obligatoria en toda acción: qué se vio o qué se hizo. Devuelve el error o null. */
export function validarNota(nota: string | null | undefined): string | null {
  const t = (nota ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (t.length < POLITICA_INCIDENCIAS.notaMinima) return `La nota es obligatoria (al menos ${POLITICA_INCIDENCIAS.notaMinima} caracteres): qué se revisó o qué se hizo`;
  if (t.length > POLITICA_INCIDENCIAS.notaMaxima) return `La nota admite hasta ${POLITICA_INCIDENCIAS.notaMaxima} caracteres`;
  return null;
}
export const normalizarNota = (nota: string) => nota.normalize("NFC").trim().replace(/\s+/g, " ");

// ─── Alcance ───────────────────────────────────────────────────────────────────

/**
 * ¿El actor ve (y opera) esta incidencia? Mismo mecanismo de alcance que el resto (access.ts):
 * - con sede: quien tenga el permiso sobre esa sede (master, franquiciado de la sede, admin de la sede);
 * - sin sede (trabajo de la organización que no apunta a una sede) o sin organización (tareas del
 *   sistema, recuperación de contraseña): solo el alcance de organización, es decir el master.
 * Recepción y profesional no tienen el permiso.
 */
export function alcanzaIncidencia(actores: readonly Asignacion[], incidencia: { organizacionId: string | null; sedeId: string | null }, franquiciadoDe: FranquiciadoDeSede): boolean {
  return actores.some(a => {
    if (!tienePermiso(a, "incidencia:gestionar")) return false;
    if (incidencia.organizacionId === null || incidencia.sedeId === null) return a.alcance === "ORGANIZACION";
    return cubreSede(a, incidencia.sedeId, franquiciadoDe);
  });
}

/** Referencias que un trabajo lleva en su payload (solo ids, doc 21). Nunca se muestra el payload. */
export function referenciasTrabajo(payload: unknown): { sedeId: string | null; reservaId: string | null } {
  const p = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
  return { sedeId: uuid(p.sedeId), reservaId: uuid(p.anteriorId) ?? uuid(p.reservaId) };
}
