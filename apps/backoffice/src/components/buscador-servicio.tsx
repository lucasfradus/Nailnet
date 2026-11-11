"use client";
import { useEffect, useMemo, useState } from "react";

export type ServicioBuscable = { id: string; nombre: string; categoria: string; duracionMinutos: number };

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Combo con búsqueda para un catálogo largo: filtra por nombre o categoría mientras se escribe, sin
 * importar tildes ni el orden de las palabras. Flechas y Enter para elegir; Escape cierra.
 */
export function BuscadorServicio({ id, servicios, valor, placeholder, pista, onElegir }: {
  id: string; servicios: ServicioBuscable[]; valor: string; placeholder: string; pista?: (id: string) => string; onElegir: (id: string) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const elegido = servicios.find(s => s.id === valor);
  const resultados = useMemo(() => {
    const palabras = normalizar(texto ?? "").split(/\s+/).filter(Boolean);
    return servicios.filter(s => { const t = normalizar(`${s.nombre} ${s.categoria}`); return palabras.every(p => t.includes(p)); });
  }, [servicios, texto]);
  useEffect(() => { if (abierto) document.getElementById(`${id}-op-${activo}`)?.scrollIntoView({ block: "nearest" }); }, [id, abierto, activo]);

  const elegir = (s: ServicioBuscable | null) => { setTexto(null); setAbierto(false); onElegir(s?.id ?? ""); };
  const teclas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!abierto) { setAbierto(true); return; }
      setActivo(a => Math.max(0, Math.min(resultados.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && abierto) {
      e.preventDefault(); // sin esto, Enter manda el formulario
      if (resultados[activo]) elegir(resultados[activo]);
    } else if (e.key === "Escape" && abierto) {
      e.preventDefault(); setTexto(null); setAbierto(false);
    }
  };

  return <div className="buscador">
    <input type="hidden" name={id} value={valor} />
    <input role="combobox" aria-label={placeholder} aria-expanded={abierto} aria-controls={`${id}-lista`} aria-autocomplete="list"
      aria-activedescendant={abierto && resultados[activo] ? `${id}-op-${activo}` : undefined} autoComplete="off" placeholder={placeholder}
      value={texto ?? (elegido ? `${elegido.nombre} · ${elegido.duracionMinutos} min` : "")}
      onChange={e => { setTexto(e.target.value); setActivo(0); setAbierto(true); }}
      onFocus={e => { e.target.select(); setActivo(Math.max(0, resultados.findIndex(s => s.id === valor))); setAbierto(true); }}
      onBlur={() => { if (texto === "") elegir(null); else { setTexto(null); setAbierto(false); } }}
      onKeyDown={teclas} />
    {elegido && <button type="button" className="buscador-limpiar" aria-label="Quitar servicio" onMouseDown={e => e.preventDefault()} onClick={() => elegir(null)}>×</button>}
    {abierto && <ul role="listbox" id={`${id}-lista`} className="buscador-lista">
      {!resultados.length && <li className="buscador-vacio">Ningún servicio coincide con «{texto}»</li>}
      {resultados.map((s, n) => <li key={s.id} role="presentation">
        {(n === 0 || resultados[n - 1]!.categoria !== s.categoria) && <p className="buscador-grupo">{s.categoria}</p>}
        <div role="option" id={`${id}-op-${n}`} aria-selected={n === activo} className="buscador-opcion"
          onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActivo(n)} onClick={() => elegir(s)}>
          <span>{s.nombre}</span><small>{s.duracionMinutos} min{pista ? ` · ${pista(s.id)}` : ""}</small>
        </div>
      </li>)}
    </ul>}
  </div>;
}
