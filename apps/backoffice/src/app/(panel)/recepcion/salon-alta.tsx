"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { BuscadorServicio, type ServicioBuscable } from "@/components/buscador-servicio";
import { accionAgregarEspera, accionBuscarFichas, type Ficha } from "./acciones";
import { nombreCompleto, type Tablero } from "./comun";

/**
 * «Llegó sin turno»: nombre, teléfono opcional, hasta dos servicios y la profesional que pidió. Mientras se
 * escribe el nombre o el teléfono busca fichas (desde 3 letras, con una pausa entre teclas) para anotarla
 * con su ficha; si no, queda con solo el nombre y la ficha se completa al cobrar.
 */
export function AltaSinTurno({ tablero, sedeId, categorias, pedida, setPedida, nombreRef, pista, onAnotada }: {
  tablero: Tablero; sedeId: string; categorias: Record<string, string>; pedida: string; setPedida: (id: string) => void;
  nombreRef: React.RefObject<HTMLInputElement | null>; pista: (id: string) => string; onAnotada: (id: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [s0, setS0] = useState("");
  const [s1, setS1] = useState("");
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [consulta, setConsulta] = useState("");
  const [resultado, setResultado] = useState<{ consulta: string; fichas: Ficha[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const servicios: ServicioBuscable[] = tablero.servicios.map(s => ({ ...s, categoria: categorias[s.id] ?? "Servicios" }));

  useEffect(() => {
    const q = consulta.trim();
    if (ficha || q.length < 3) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const fichas = await accionBuscarFichas(q);
      if (vigente) setResultado({ consulta: q, fichas });
    }, 350);
    return () => { vigente = false; clearTimeout(t); };
  }, [consulta, ficha]);
  const sugeridas = !ficha && resultado && resultado.consulta === consulta.trim() ? resultado.fichas : null;

  const usar = (f: Ficha) => {
    setFicha(f);
    setNombre(nombreCompleto(f));
    if (f.telefono) setTelefono(f.telefono);
  };
  const anotar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!nombre.trim()) { setError("Indicá el nombre de la clienta"); return; }
    if (!s0 && !s1) { setError("Elegí al menos un servicio"); return; }
    const form = new FormData(ev.currentTarget);
    setError(null);
    iniciar(async () => {
      const r = await accionAgregarEspera(undefined, form);
      if (r.error || !r.id) { setError(r.error ?? "No se pudo anotar"); return; }
      setNombre(""); setTelefono(""); setS0(""); setS1(""); setFicha(null); setConsulta(""); setResultado(null); setPedida("");
      onAnotada(r.id);
    });
  };

  return <form className="salon-alta" onSubmit={anotar} aria-labelledby="t-alta" noValidate>
    <h2 className="salon-titulo" id="t-alta">Llegó sin turno</h2>
    <input type="hidden" name="sedeId" value={sedeId} />
    <input type="hidden" name="clienteId" value={ficha?.id ?? ""} />
    <label>Nombre<input ref={nombreRef} name="nombre" required maxLength={80} autoComplete="off" placeholder="Nombre de la clienta" value={nombre}
      onChange={e => { setNombre(e.target.value); setConsulta(e.target.value); }} /></label>
    <label><span>Teléfono <span className="opcional">(opcional)</span></span><input name="telefono" inputMode="tel" maxLength={40} autoComplete="off" value={telefono}
      onChange={e => { setTelefono(e.target.value); setConsulta(e.target.value); }} /></label>
    {ficha ? <div className="salon-ficha" role="status">
      <span><strong>Con ficha</strong> · <Link href={`/clientes/${ficha.id}`} target="_blank">{nombreCompleto(ficha)}</Link>{ficha.telefono ? ` · ${ficha.telefono}` : ""}</span>
      <button type="button" className="secundario" onClick={() => setFicha(null)}>Quitar</button>
    </div> : sugeridas && (sugeridas.length ? <div className="salon-sugeridas">
      <p className="ayuda">¿Ya tiene ficha?</p>
      <ul>{sugeridas.map(f => <li key={f.id}><button type="button" className="secundario" onClick={() => usar(f)}>
        <span>{nombreCompleto(f)}</span><small>{[f.telefono, f.email].filter(Boolean).join(" · ") || "Sin contacto"}</small>
      </button></li>)}</ul>
    </div> : <p className="ayuda">Ninguna ficha coincide: se anota sin ficha.</p>)}
    <BuscadorServicio id="s_0" servicios={servicios} valor={s0} placeholder="Servicio…" pista={pista} onElegir={setS0} />
    <BuscadorServicio id="s_1" servicios={servicios.filter(s => s.id !== s0)} valor={s1} placeholder="+ Otro servicio (opcional)" pista={pista} onElegir={setS1} />
    <label><span>Pidió a <span className="opcional">(opcional)</span></span>
      <select name="profesionalId" value={pedida} onChange={e => setPedida(e.target.value)}>
        <option value="">Cualquier profesional</option>
        {tablero.profesionales.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
    </label>
    <p className="ayuda">Hasta 2 servicios. Con dos, se hacen a la vez con dos profesionales.</p>
    <button disabled={pendiente}>{pendiente ? "Anotando…" : "Anotar y elegir profesional"}</button>
    {error && <p className="alerta error" role="alert">{error}</p>}
  </form>;
}
