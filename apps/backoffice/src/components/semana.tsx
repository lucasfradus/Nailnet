import { formatearRangos, type Rango } from "@nailnet/domain/agenda";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];

/** Editor de semana: un campo por día con rangos «09:00-13:00, 14:00-20:00». Vacío = no trabaja/cerrado. */
export function CamposSemana({ semana }: { semana: Partial<Record<number, Rango[]>> }) {
  return <div className="semana">{ORDEN.map(d => <label key={d}>{DIAS[d]}
    <input name={`dia${d}`} defaultValue={formatearRangos(semana[d] ?? [])} placeholder="cerrado" pattern="[0-9:, -]*" aria-label={`Horario del ${DIAS[d]}`} />
  </label>)}</div>;
}
export function textoSemana(semana: Partial<Record<number, Rango[]>>) {
  const dias = ORDEN.filter(d => semana[d]?.length);
  return dias.length ? dias.map(d => `${DIAS[d]!.slice(0, 3)} ${formatearRangos(semana[d]!)}`).join(" · ") : "Sin horario cargado";
}
