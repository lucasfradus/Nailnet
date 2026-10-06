/**
 * Contrato público v1 del portal (`/api/public/v1`). Sin dependencias: lo importan el portal y el
 * backend. Importes como cadenas decimales «12345.67»; instantes en ISO 8601 UTC. Las URLs de imágenes
 * son rutas relativas al origen de la API (`/api/public/v1/imagenes/{id}`), o null si no hay imagen.
 */
export type SedePublica = { id: string; nombre: string; timezone: string };
export type ServicioPublico = { id: string; nombre: string; categoria: string; descripcion: string | null; imagenUrl: string | null; duracionMinutos: number; precio: string; sena: string };
/** Términos vigentes que el invitado acepta al reservar (uno por clave, última versión). */
export type TerminoPublico = { clave: string; version: number; titulo: string; texto: string };
export type ProfesionalPublico = { id: string; nombre: string; fotoUrl: string | null };
export type TurnoPublico = { inicio: string; fin: string; items: { servicioId: string; profesionalId: string; profesional: string; inicio: string; fin: string }[] };

export type ItemSolicitado = { servicioId: string; profesionalId?: string | null };
export type ReservaPublicaSolicitud = {
  sedeId: string; fecha: string; inicio: string; items: ItemSolicitado[];
  cliente: { nombre: string; apellido?: string | null; email: string; telefono: string };
  aceptaTerminos: true;
};
export type EstadoReservaPublico = "PENDIENTE_PAGO" | "PAGO_EN_REVISION" | "CONFIRMADA" | "ATENDIDA" | "AUSENTE" | "CANCELADA" | "EXPIRADA";
export type ReservaPublicaRespuesta = {
  reservaId: string; estado: EstadoReservaPublico; expiraEn: string | null; sena: string;
  /** Token opaco para consultar la reserva. Se muestra una sola vez; guardarlo del lado del cliente. */
  token: string;
};
export type ReservaPublicaEstado = {
  estado: EstadoReservaPublico; expiraEn: string | null; sede: string; sena: string;
  items: { servicio: string; imagenUrl: string | null; profesional: string; fotoUrl: string | null; inicio: string; fin: string }[];
};
export type ErrorPublico = { error: { codigo: "INVALIDO" | "NO_DISPONIBLE" | "CONFLICTO_IDEMPOTENCIA" | "LIMITE" | "NO_ENCONTRADO" | "INTERNO"; mensaje: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esTexto = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Validación estructural del cuerpo. El backend vuelve a validar reglas de negocio y alcance. */
export function validarReservaPublica(cuerpo: unknown): { ok: true; valor: ReservaPublicaSolicitud } | { ok: false; mensaje: string } {
  if (!cuerpo || typeof cuerpo !== "object") return { ok: false, mensaje: "Cuerpo inválido" };
  const c = cuerpo as Record<string, unknown>;
  if (typeof c.sedeId !== "string" || !UUID.test(c.sedeId)) return { ok: false, mensaje: "sedeId inválido" };
  if (typeof c.fecha !== "string" || !FECHA.test(c.fecha)) return { ok: false, mensaje: "fecha inválida (AAAA-MM-DD)" };
  if (typeof c.inicio !== "string" || Number.isNaN(Date.parse(c.inicio))) return { ok: false, mensaje: "inicio inválido (ISO 8601)" };
  if (!Array.isArray(c.items) || c.items.length < 1 || c.items.length > 4) return { ok: false, mensaje: "Entre 1 y 4 servicios" };
  for (const i of c.items as Record<string, unknown>[]) {
    if (!i || typeof i.servicioId !== "string" || !UUID.test(i.servicioId)) return { ok: false, mensaje: "servicioId inválido" };
    if (i.profesionalId != null && (typeof i.profesionalId !== "string" || !UUID.test(i.profesionalId))) return { ok: false, mensaje: "profesionalId inválido" };
  }
  const cl = c.cliente as Record<string, unknown> | undefined;
  if (!cl || !esTexto(cl.nombre, 80)) return { ok: false, mensaje: "Nombre obligatorio" };
  if (cl.apellido != null && (typeof cl.apellido !== "string" || cl.apellido.length > 80)) return { ok: false, mensaje: "Apellido inválido" };
  if (typeof cl.email !== "string" || cl.email.length > 254 || !EMAIL.test(cl.email.trim())) return { ok: false, mensaje: "Email inválido" };
  if (!esTexto(cl.telefono, 30)) return { ok: false, mensaje: "Teléfono obligatorio" };
  if (c.aceptaTerminos !== true) return { ok: false, mensaje: "Hay que aceptar los términos" };
  return { ok: true, valor: {
    sedeId: c.sedeId, fecha: c.fecha, inicio: new Date(c.inicio).toISOString(),
    items: (c.items as ItemSolicitado[]).map(i => ({ servicioId: i.servicioId, profesionalId: i.profesionalId ?? null })),
    cliente: { nombre: cl.nombre.trim(), apellido: typeof cl.apellido === "string" ? cl.apellido.trim() || null : null, email: cl.email.trim(), telefono: (cl.telefono as string).trim() },
    aceptaTerminos: true,
  } };
}

/** Idempotency-Key: 16 a 100 caracteres seguros (p. ej. un UUID generado por el portal por intento de reserva). */
export function claveIdempotenciaValida(clave: string | null): clave is string {
  return !!clave && /^[A-Za-z0-9_-]{16,100}$/.test(clave);
}
