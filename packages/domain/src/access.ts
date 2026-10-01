export type Rol = "MASTER_FRANQUICIADOR" | "FRANQUICIADO" | "ADMIN_SEDE" | "RECEPCIONISTA" | "PROFESIONAL";
export type Permiso = "sede:leer" | "sede:administrar" | "sede:crear" | "sede:credenciales" | "franquiciado:administrar" | "organizacion:configurar" | "usuario:leer" | "usuario:administrar" | "cliente:leer" | "cliente:editar" | "consentimiento:administrar" | "catalogo:administrar" | "catalogo:precios" | "profesional:administrar";
export type Asignacion = {
  rol: Rol;
  alcance: "ORGANIZACION" | "FRANQUICIADO" | "SEDE" | "PROPIO";
  franquiciadoId: string | null;
  sedeId: string | null;
};
const permisos: Record<Rol, readonly Permiso[]> = {
  MASTER_FRANQUICIADOR: ["sede:leer", "sede:administrar", "sede:crear", "sede:credenciales", "franquiciado:administrar", "organizacion:configurar", "usuario:leer", "usuario:administrar", "cliente:leer", "cliente:editar", "consentimiento:administrar", "catalogo:administrar", "catalogo:precios", "profesional:administrar"],
  // Credenciales de proveedores: solo quien es dueño comercial de la sede (o el master), no la operación diaria.
  FRANQUICIADO: ["sede:leer", "sede:administrar", "sede:crear", "sede:credenciales", "usuario:leer", "usuario:administrar", "cliente:leer", "cliente:editar", "catalogo:precios", "profesional:administrar"],
  ADMIN_SEDE: ["sede:leer", "sede:administrar", "usuario:leer", "cliente:leer", "cliente:editar", "catalogo:precios", "profesional:administrar"],
  RECEPCIONISTA: ["sede:leer", "cliente:leer", "cliente:editar"],
  PROFESIONAL: [],
};
export function asignacionValida(a: Asignacion): boolean {
  switch (a.rol) {
    case "MASTER_FRANQUICIADOR": return a.alcance === "ORGANIZACION" && a.franquiciadoId === null && a.sedeId === null;
    case "FRANQUICIADO": return a.alcance === "FRANQUICIADO" && !!a.franquiciadoId && a.sedeId === null;
    case "ADMIN_SEDE":
    case "RECEPCIONISTA": return a.alcance === "SEDE" && !!a.sedeId && a.franquiciadoId === null;
    case "PROFESIONAL": return a.alcance === "PROPIO" && a.franquiciadoId === null && a.sedeId === null;
    default: return false;
  }
}
export function tienePermiso(a: Asignacion, permiso: Permiso): boolean {
  return asignacionValida(a) && (permisos[a.rol]?.includes(permiso) ?? false);
}
export class AccesoDenegado extends Error {
  constructor() { super("Acceso denegado"); this.name = "AccesoDenegado"; }
}

/** Resuelve a qué franquiciado pertenece una sede de la organización (undefined si no es de ella). */
export type FranquiciadoDeSede = (sedeId: string) => string | undefined;

/** ¿El alcance de la asignación del actor contiene la sede indicada? */
export function cubreSede(actor: Asignacion, sedeId: string, franquiciadoDe: FranquiciadoDeSede): boolean {
  if (!asignacionValida(actor)) return false;
  const franquiciado = franquiciadoDe(sedeId);
  if (franquiciado === undefined) return false;
  if (actor.alcance === "ORGANIZACION") return true;
  if (actor.alcance === "FRANQUICIADO") return actor.franquiciadoId === franquiciado;
  if (actor.alcance === "SEDE") return actor.sedeId === sedeId;
  return false;
}

/**
 * Delegación de roles. Nadie concede más de lo que alcanza:
 * - MASTER_FRANQUICIADOR concede cualquier rol de su organización.
 * - FRANQUICIADO concede ADMIN_SEDE y RECEPCIONISTA solo en sedes propias.
 * - PROFESIONAL tiene alcance PROPIO, sin sede todavía: solo el master lo concede hasta que
 *   exista ProfesionalSede (C03); si no, un franquiciado podría revocar profesionales de otro.
 * - ADMIN_SEDE y RECEPCIONISTA no conceden roles.
 * La misma regla rige para revocar.
 */
export function puedeOtorgar(actores: readonly Asignacion[], objetivo: Asignacion, franquiciadoDe: FranquiciadoDeSede): boolean {
  if (!asignacionValida(objetivo)) return false;
  if (objetivo.alcance === "SEDE" && franquiciadoDe(objetivo.sedeId!) === undefined) return false;
  return actores.some(a => {
    if (!tienePermiso(a, "usuario:administrar")) return false;
    if (a.rol === "MASTER_FRANQUICIADOR") return true;
    if (a.rol === "FRANQUICIADO") return (objetivo.rol === "ADMIN_SEDE" || objetivo.rol === "RECEPCIONISTA") && cubreSede(a, objetivo.sedeId!, franquiciadoDe);
    return false;
  });
}

/**
 * Un usuario solo puede administrarse (desactivar, invitar) si TODAS sus asignaciones están
 * dentro de lo que el actor puede conceder. Sin asignaciones, solo el master lo administra.
 */
export function administraUsuario(actores: readonly Asignacion[], objetivo: readonly Asignacion[], franquiciadoDe: FranquiciadoDeSede): boolean {
  if (!objetivo.length) return actores.some(a => a.rol === "MASTER_FRANQUICIADOR" && tienePermiso(a, "usuario:administrar"));
  return objetivo.every(o => puedeOtorgar(actores, o, franquiciadoDe));
}

/** Visibilidad de un usuario en listados: alguna de sus asignaciones cae en el alcance de lectura del actor. */
export function veUsuario(actores: readonly Asignacion[], objetivo: readonly Asignacion[], franquiciadoDe: FranquiciadoDeSede): boolean {
  return actores.some(a => {
    if (!tienePermiso(a, "usuario:leer")) return false;
    if (a.alcance === "ORGANIZACION") return true;
    return objetivo.some(o => {
      if (o.alcance === "SEDE") return cubreSede(a, o.sedeId!, franquiciadoDe);
      if (o.alcance === "FRANQUICIADO") return a.alcance === "FRANQUICIADO" && a.franquiciadoId === o.franquiciadoId;
      return false;
    });
  });
}

/** Crear sedes o cambiar su estado exige alcance sobre el franquiciado propietario. */
export function puedeCrearSede(actores: readonly Asignacion[], franquiciadoId: string): boolean {
  return actores.some(a => tienePermiso(a, "sede:crear") && (a.alcance === "ORGANIZACION" || a.franquiciadoId === franquiciadoId));
}
