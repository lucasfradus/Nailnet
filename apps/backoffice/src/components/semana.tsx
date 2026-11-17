import { formatearRangos, type Rango } from "@nailnet/domain/agenda";
import { EditorSemana } from "./editor-semana";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];

/** Editor de semana: por día, si trabaja/abre y en qué tramos (los cortes son pausas). */
export function CamposSemana({ semana }: { semana: Partial<Record<number, Rango[]>> }) {
  return <EditorSemana semana={semana} />;
}
export function textoSemana(semana: Partial<Record<number, Rango[]>>) {
  const dias = ORDEN.filter(d => semana[d]?.length);
  return dias.length ? dias.map(d => `${DIAS[d]!.slice(0, 3)} ${formatearRangos(semana[d]!)}`).join(" · ") : "Sin horario cargado";
}
