"use client";
import { useState } from "react";
import { aHora, aMinutos, formatearRangos, fueraDe, type Rango } from "@nailnet/domain/agenda";

type Semana = Partial<Record<number, Rango[]>>;
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const POR_DEFECTO: Rango[] = [{ inicio: 540, fin: 1080 }];

/**
 * Editor visual de una semana: por día, si atiende y uno o más rangos desde/hasta (los cortes son
 * pausas). Envía `dia0`…`dia6` con el formato «09:00-13:00, 14:00-20:00» que validan las acciones.
 * Con `limite` (horario de la sede) sugiere esos rangos y marca lo que queda afuera.
 */
export function EditorSemana({ semana, limite, verbo = "Trabaja" }: { semana: Semana; limite?: Semana; verbo?: string }) {
  const [dias, setDias] = useState<Semana>(() => Object.fromEntries(ORDEN.map(d => [d, semana[d] ?? []])));
  const sugerido = (d: number) => limite?.[d]?.length ? limite[d]! : POR_DEFECTO;
  const cambiar = (d: number, rangos: Rango[]) => setDias(s => ({ ...s, [d]: rangos }));
  const editar = (d: number, i: number, campo: keyof Rango, valor: string) => {
    const m = aMinutos(valor);
    if (m !== null) cambiar(d, dias[d]!.map((r, k) => k === i ? { ...r, [campo]: m } : r));
  };
  // Parte el último rango con una hora de pausa en el medio (redondeado a la media hora).
  const pausa = (d: number) => {
    const rs = dias[d]!, u = rs.at(-1)!;
    if (u.fin - u.inicio < 180) return;
    const corte = Math.round((u.inicio + u.fin) / 2 / 30) * 30 - 30;
    cambiar(d, [...rs.slice(0, -1), { inicio: u.inicio, fin: corte }, { inicio: corte + 60, fin: u.fin }]);
  };
  const copiarATodos = (origen: number) => setDias(s => Object.fromEntries(ORDEN.map(d =>
    [d, d === origen || (limite && !limite[d]?.length) ? s[d] ?? [] : s[origen]!.map(r => ({ ...r }))])));

  return <div className="editor-semana">
    {limite && <div className="editor-semana-acciones">
      <button type="button" className="secundario" onClick={() => setDias(Object.fromEntries(ORDEN.map(d => [d, (limite[d] ?? []).map(r => ({ ...r }))])))}>Igual al horario de la sede</button>
      <span className="ayuda">La jornada tiene que caer dentro del horario de la sede.</span>
    </div>}
    {ORDEN.map(d => {
      const rangos = dias[d] ?? [], activo = rangos.length > 0;
      const fuera = limite ? fueraDe(rangos, limite[d] ?? []) : [];
      return <div key={d} className={activo ? "dia-editor" : "dia-editor inactivo"}>
        <input type="hidden" name={`dia${d}`} value={formatearRangos(rangos)} />
        <label className="check dia-nombre"><input type="checkbox" checked={activo} onChange={e => cambiar(d, e.target.checked ? sugerido(d).map(r => ({ ...r })) : [])} aria-label={`${verbo} el ${DIAS[d]}`} />{DIAS[d]}</label>
        <div className="dia-rangos">
          {!activo && <span className="ayuda">{limite && !limite[d]?.length ? "La sede no atiende" : `No ${verbo.toLowerCase()}`}</span>}
          {rangos.map((r, i) => <span key={i} className="rango">
            <input type="time" step={300} value={aHora(r.inicio)} onChange={e => editar(d, i, "inicio", e.target.value)} aria-label={`${DIAS[d]}, desde`} />
            <span aria-hidden="true">–</span>
            <input type="time" step={300} value={aHora(r.fin)} onChange={e => editar(d, i, "fin", e.target.value)} aria-label={`${DIAS[d]}, hasta`} />
            {rangos.length > 1 && <button type="button" className="quitar" onClick={() => cambiar(d, rangos.filter((_, k) => k !== i))} aria-label="Quitar rango">×</button>}
          </span>)}
          {activo && rangos.at(-1)!.fin - rangos.at(-1)!.inicio >= 180 && <button type="button" className="enlace" onClick={() => pausa(d)}>+ pausa</button>}
          {activo && <button type="button" className="enlace" onClick={() => copiarATodos(d)}>Copiar a todos</button>}
        </div>
        <div className="dia-nota">
          {limite && <span className="ayuda">Sede: {limite[d]?.length ? formatearRangos(limite[d]!) : "cerrada"}</span>}
          {fuera.length > 0 && <span className="alerta-texto">{formatearRangos(fuera)} fuera del horario de la sede</span>}
        </div>
      </div>;
    })}
  </div>;
}
