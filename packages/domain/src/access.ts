export type Rol = "MASTER_FRANQUICIADOR" | "FRANQUICIADO" | "ADMIN_SEDE" | "RECEPCIONISTA" | "PROFESIONAL";
export type Permiso = "sede:leer" | "sede:administrar" | "usuario:administrar";
export type Asignacion = {
  rol: Rol;
  alcance: "ORGANIZACION" | "FRANQUICIADO" | "SEDE" | "PROPIO";
  franquiciadoId: string | null;
  sedeId: string | null;
};
const permisos: Record<Rol, readonly Permiso[]> = {
  MASTER_FRANQUICIADOR: ["sede:leer", "sede:administrar", "usuario:administrar"],
  FRANQUICIADO: ["sede:leer", "sede:administrar", "usuario:administrar"],
  ADMIN_SEDE: ["sede:leer", "sede:administrar"],
  RECEPCIONISTA: ["sede:leer"],
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
