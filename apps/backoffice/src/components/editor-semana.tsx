"use client";
import { useState } from "react";
import { aHora, aMinutos, type Rango } from "@nailnet/domain/agenda";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const POR_DEFECTO: Tramo[] = [{ desde: "09:00", hasta: "18:00" }];

/** Un tramo trabajado tal como está en los inputs; «00:00» como fin significa medianoche (24:00). */
type Tramo = { desde: string; hasta: string };
type Semana = Record<number, Tramo[]>;

const minutos = (hhmm: string, esFin: boolean) => esFin && hhmm === "00:00" ? 1440 : aMinutos(hhmm);
const hora = (m: number) => m >= 1440 ? "00:00" : aHora(m);
const texto = (tramos: Tramo[]) => tramos.map(t => `${t.desde}-${t.hasta === "00:00" ? "24:00" : t.hasta}`).join(", ");

function error(tramos: Tramo[]): string | null {
  const rangos: Rango[] = [];
  for (const t of tramos) {
    const inicio = minutos(t.desde, false), fin = minutos(t.hasta, true);
    if (inicio === null || fin === null) return "Completá las horas";
    if (inicio >= fin) return `${t.desde} a ${t.hasta} termina antes de empezar`;
    rangos.push({ inicio, fin });
  }
  rangos.sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < rangos.length; i++) if (rangos[i]!.inicio < rangos[i - 1]!.fin) return "Los horarios se superponen";
  return null;
}

/** Corta el último tramo con una pausa de una hora a mitad de jornada (o agrega uno nuevo si es corto). */
function conPausa(tramos: Tramo[]): Tramo[] {
  const ultimo = tramos.at(-1)!;
  const inicio = minutos(ultimo.desde, false), fin = minutos(ultimo.hasta, true);
  if (inicio === null || fin === null) return [...tramos, { desde: "", hasta: "" }];
  if (fin - inicio >= 150) {
    const corte = Math.round((inicio + fin) / 120) * 60;
    return [...tramos.slice(0, -1), { desde: ultimo.desde, hasta: hora(corte) }, { desde: hora(corte + 60), hasta: ultimo.hasta }];
  }
  if (fin + 90 > 1440) return [...tramos, { desde: "", hasta: "" }];
  return [...tramos, { desde: hora(fin + 30), hasta: hora(Math.min(fin + 150, 1440)) }];
}

/**
 * Editor de semana: por día, si trabaja y en qué tramos. Los cortes entre tramos son pausas.
 * Envía `dia0`…`dia6` con el formato «09:00-13:00, 14:00-20:00» que espera `semanaDesdeTextos`.
 */
export function EditorSemana({ semana: inicial }: { semana: Partial<Record<number, Rango[]>> }) {
  const [semana, setSemana] = useState<Semana>(() => Object.fromEntries(ORDEN.map(d =>
    [d, [...(inicial[d] ?? [])].sort((a, b) => a.inicio - b.inicio).map(r => ({ desde: hora(r.inicio), hasta: hora(r.fin) }))])));
  const cambiar = (d: number, tramos: Tramo[]) => setSemana(s => ({ ...s, [d]: tramos }));
  const activos = ORDEN.filter(d => semana[d]!.length);

  function alternar(d: number, trabaja: boolean) {
    if (!trabaja) return cambiar(d, []);
    // Copia el día trabajado más cercano hacia atrás: marcar martes después de cargar el lunes repite el lunes.
    const i = ORDEN.indexOf(d);
    const previo = [...ORDEN.slice(0, i).reverse(), ...ORDEN.slice(i + 1).reverse()].find(x => semana[x]!.length);
    cambiar(d, previo === undefined ? POR_DEFECTO : semana[previo]!.map(t => ({ ...t })));
  }
  const copiarATodos = (d: number) => setSemana(s => ({ ...s, ...Object.fromEntries(activos.filter(x => x !== d).map(x => [x, s[d]!.map(t => ({ ...t }))])) }));

  return <div className="editor-semana">
    {ORDEN.map(d => {
      const tramos = semana[d]!, problema = tramos.length ? error(tramos) : null;
      return <div key={d} className={tramos.length ? "dia-semana" : "dia-semana libre"}>
        <input type="hidden" name={`dia${d}`} value={texto(tramos)} />
        <label className="check dia-nombre"><input type="checkbox" checked={tramos.length > 0} onChange={e => alternar(d, e.target.checked)} />{DIAS[d]}</label>
        {tramos.length ? <div className="tramos"><div className="lista-tramos">
          {tramos.map((t, i) => <div key={i} className="tramo-con-pausa">
            {i > 0 && <span className="pausa">pausa{tramos[i - 1]!.hasta && t.desde ? ` de ${tramos[i - 1]!.hasta} a ${t.desde}` : ""}</span>}
            <span className="tramo"><input type="time" step={300} value={t.desde} required aria-label={`${DIAS[d]}: desde (tramo ${i + 1})`}
              onChange={e => cambiar(d, tramos.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))} />
            <span className="a">a</span>
            <input type="time" step={300} value={t.hasta} required aria-label={`${DIAS[d]}: hasta (tramo ${i + 1})`}
              onChange={e => cambiar(d, tramos.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))} />
            {i > 0 && <button type="button" className="enlace" aria-label={`Quitar tramo ${i + 1} del ${DIAS[d]}`} title="Quitar este tramo"
              onClick={() => cambiar(d, tramos.filter((_, j) => j !== i))}>×</button>}
          </span></div>)}
          </div><div className="acciones-tramos"><button type="button" className="enlace" onClick={() => cambiar(d, conPausa(tramos))} title="Corta la jornada en dos (almuerzo, horario partido)">+ Pausa</button>
          {activos.length > 1 && <button type="button" className="enlace" onClick={() => copiarATodos(d)} title="Aplica este horario a todos los días marcados">Copiar a los demás días</button>}
          </div>
          {problema && <span className="alerta-texto" role="alert">{problema}</span>}
        </div> :<span className="ayuda">No trabaja</span>}
      </div>;
    })}
  </div>;
}
