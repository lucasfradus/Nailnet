import type { opcionesDeRol } from "@nailnet/database/usuarios";
import { ROLES } from "@/lib/etiquetas";

export type OpcionRol = Awaited<ReturnType<typeof opcionesDeRol>>[number];
type AsignacionVista = { rol: string; alcance: string; sedeId: string | null; franquiciadoId: string | null; sede: string | null; franquiciado: string | null };

/** Mismo formato que lee `leerAsignacion` en las acciones: rol|alcance|franquiciado|sede. */
export const valorRol = (a: Pick<AsignacionVista, "rol" | "alcance" | "sedeId" | "franquiciadoId">) => [a.rol, a.alcance, a.franquiciadoId ?? "", a.sedeId ?? ""].join("|");

export const etiquetaRol = (a: Pick<AsignacionVista, "rol" | "sede" | "franquiciado">) =>
  `${ROLES[a.rol] ?? a.rol}${a.sede ? ` · ${a.sede}` : a.franquiciado ? ` · ${a.franquiciado}` : ""}`;

export function SelectorRol({ opciones, valor, etiqueta = "Rol" }: { opciones: OpcionRol[]; valor?: string; etiqueta?: string }) {
  return <select name="asignacion" aria-label={etiqueta} defaultValue={valor}>
    {opciones.map(o => <option key={valorRol(o.asignacion)} value={valorRol(o.asignacion)}>{o.etiqueta}</option>)}
  </select>;
}
