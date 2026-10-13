import { formatearRangos, type Rango } from "@nailnet/domain/agenda";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];

/** Resumen de una semana en una línea; para editarla, ver `EditorSemana`. */
export function textoSemana(semana: Partial<Record<number, Rango[]>>) {
  const dias = ORDEN.filter(d => semana[d]?.length);
  return dias.length ? dias.map(d => `${DIAS[d]!.slice(0, 3)} ${formatearRangos(semana[d]!)}`).join(" · ") : "Sin horario cargado";
}
