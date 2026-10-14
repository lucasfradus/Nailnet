export type Rol = "MASTER_FRANQUICIADOR" | "FRANQUICIADO" | "ADMIN_SEDE" | "RECEPCIONISTA" | "PROFESIONAL";
export type Permiso = "sede:leer" | "sede:administrar" | "sede:crear" | "sede:credenciales" | "franquiciado:administrar" | "organizacion:configurar" | "usuario:leer" | "usuario:administrar" | "cliente:leer" | "cliente:editar" | "consentimiento:administrar" | "catalogo:administrar" | "catalogo:precios" | "profesional:administrar" | "reserva:gestionar"
  // Incidencias (M04): bandeja de trabajos, pagos y emails con problemas, y acciones sobre ellos.
  | "incidencia:gestionar"
  // Stock (O03): productos globales; saldos y movimientos por sede.
  | "producto:administrar" | "stock:leer" | "stock:consumir" | "stock:gestionar";
export type Asignacion = {
  rol: Rol;
  alcance: "ORGANIZACION" | "FRANQUICIADO" | "SEDE" | "PROPIO";
  franquiciadoId: string | null;
  sedeId: string | null;
};
const permisos: Record<Rol, readonly Permiso[]> = {
  MASTER_FRANQUICIADOR: ["sede:leer", "sede:administrar", "sede:crear", "sede:credenciales", "franquiciado:administrar", "organizacion:configurar", "usuario:leer", "usuario:administrar", "cliente:leer", "cliente:editar", "consentimiento:administrar", "catalogo:administrar", "catalogo:precios", "profesional:administrar", "reserva:gestionar", "producto:administrar", "stock:leer", "stock:consumir", "stock:gestionar"],
  // Credenciales de proveedores: solo quien es dueño comercial de la sede (o el master), no la operación diaria.
  FRANQUICIADO: ["sede:leer", "sede:administrar", "sede:crear", "sede:credenciales", "usuario:leer", "usuario:administrar", "cliente:leer", "cliente:editar", "catalogo:precios", "profesional:administrar", "reserva:gestionar", "stock:leer", "stock:consumir", "stock:gestionar"],
  ADMIN_SEDE: ["sede:leer", "sede:administrar", "usuario:leer", "cliente:leer", "cliente:editar", "catalogo:precios", "profesional:administrar", "reserva:gestionar", "stock:leer", "stock:consumir", "stock:gestionar"],
  // Stock: recepción ve saldos y registra consumo interno (y ventas, con O01). Compras, ajustes y
  // transferencias quedan para administración de sede, franquiciado o master.
  RECEPCIONISTA: ["sede:leer", "cliente:leer", "cliente:editar", "reserva:gestionar", "stock:leer", "stock:consumir"],
  PROFESIONAL: [],
};
// Incidencias (M04, doc 28): master, franquiciado y administración de sede, cada uno en su alcance.
// Recepción y profesional no: es revisión de dinero y de la cola, no operación del día. Va aparte de
// la tabla principal para que sumar permisos de otros módulos no la toque.
const permisosIncidencias: Partial<Record<Rol, readonly Permiso[]>> = {
  MASTER_FRANQUICIADOR: ["incidencia:gestionar"], FRANQUICIADO: ["incidencia:gestionar"], ADMIN_SEDE: ["incidencia:gestionar"],
};
/**
 * O04 · Gastos de sede. Tabla propia para no mezclar el módulo con los permisos de estructura.
 * Recepción no ve ni registra gastos hasta definir su papel en la caja (O02); ver 25-gastos.md.
 * Las categorías globales (sin sede) son solo del alcance de organización: ver puedeAdministrarCategoriaGasto.
 */
export type PermisoGasto = "gasto:leer" | "gasto:registrar" | "gasto:anular" | "gasto:categorias";
const GASTOS_COMPLETO: readonly PermisoGasto[] = ["gasto:leer", "gasto:registrar", "gasto:anular", "gasto:categorias"];
const permisosGasto: Record<Rol, readonly PermisoGasto[]> = {
  MASTER_FRANQUICIADOR: GASTOS_COMPLETO,
  FRANQUICIADO: GASTOS_COMPLETO,
  ADMIN_SEDE: GASTOS_COMPLETO,
  RECEPCIONISTA: [],
  PROFESIONAL: [],
};
/**
 * O01/O02 · Ventas y caja. Tabla propia, como gastos. Recepción registra ventas, cobra y opera la caja
 * de sus sedes (abrir, entradas/salidas, cerrar), pero no anula ventas: la anulación devuelve dinero y
 * stock, así que queda para administración de sede, franquiciado o master. Ver 27-ventas-caja.md.
 */
export type PermisoVenta = "venta:leer" | "venta:registrar" | "venta:anular" | "caja:leer" | "caja:operar";
const VENTAS_COMPLETO: readonly PermisoVenta[] = ["venta:leer", "venta:registrar", "venta:anular", "caja:leer", "caja:operar"];
const permisosVenta: Record<Rol, readonly PermisoVenta[]> = {
  MASTER_FRANQUICIADOR: VENTAS_COMPLETO,
  FRANQUICIADO: VENTAS_COMPLETO,
  ADMIN_SEDE: VENTAS_COMPLETO,
  RECEPCIONISTA: ["venta:leer", "venta:registrar", "caja:leer", "caja:operar"],
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
export function tienePermiso(a: Asignacion, permiso: Permiso | PermisoGasto | PermisoVenta): boolean {
  if (!asignacionValida(a)) return false;
  if (permiso.startsWith("gasto:")) return permisosGasto[a.rol]?.includes(permiso as PermisoGasto) ?? false;
  if (permiso.startsWith("venta:") || permiso.startsWith("caja:")) return permisosVenta[a.rol]?.includes(permiso as PermisoVenta) ?? false;
  if (permisosIncidencias[a.rol]?.includes(permiso as Permiso)) return true;
  return permisos[a.rol]?.includes(permiso as Permiso) ?? false;
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
