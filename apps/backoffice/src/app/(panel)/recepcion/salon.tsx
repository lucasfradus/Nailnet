"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { BuscadorServicio, type ServicioBuscable } from "@/components/buscador-servicio";
import { Formulario } from "@/components/formulario";
import { accionAgregarEspera, accionBuscarFichas, accionLlegada, accionSalida, accionSeFue, accionSentar, accionTermino, type Ficha } from "./acciones";
import { NombreClienta, nombreCompleto, repartir, type Tablero } from "./comun";

type Profesional = Tablero["profesionales"][number];
type Espera = Tablero["esperas"][number];
/** Clienta elegida para sentar: qué profesional va con cada servicio y a qué servicio le toca la próxima. */
type Seleccion = { esperaId: string; elegidas: Record<string, string>; activo: string | null };
type Evaluacion = { puede: true } | { puede: false; motivo: string | null; pisa?: boolean };

/** «Llegó» vale desde una hora antes del turno (lo valida `marcarLlegada`): antes no se ofrece. */
const ANTICIPO_LLEGADA_MS = 3_600_000;
/** La franja de cada tarjeta muestra las próximas dos horas (la misma ventana que `agenda` en el tablero). */
const VENTANA_MS = 2 * 3_600_000;
const MIN = 60_000;

/**
 * Tablero del salón (Manos y pies, y las sedes con un solo universo; doc 31, etapa 2). A la izquierda,
 * quién entra: el alta de la clienta sin turno, la lista de espera y los turnos por llegar. A la derecha, el
 * salón: libres (la que espera hace más, primero) y atendiendo (la que termina antes, primero), cada una
 * con la franja de sus próximas dos horas.
 *
 * Para sentar: se toca una clienta en espera y se resaltan las profesionales que pueden empezar ahora cada
 * servicio que pidió (en el local, sin atención, lo hacen y les entra antes de su próximo turno). Un toque
 * en la profesional la sienta; con dos servicios, se elige una por servicio. Las que pisarían un turno se
 * muestran con el motivo y no se pueden elegir (la etapa 3 lo habilita). El servidor decide (`sentarEspera`).
 */
export function TableroSalon({ tablero, ahora, sedeId, categorias, porCobrar, noLlegaron }: {
  tablero: Tablero; ahora: number; sedeId: string; categorias: Record<string, string>; porCobrar: ReactNode; noLlegaron: ReactNode;
}) {
  const tz = tablero.timezone;
  const hora = (d: Date | number) => new Date(d).toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const { presentes, libres, atendiendo } = repartir(tablero);
  const servicios = new Map(tablero.servicios.map(s => [s.id, s]));
  const nombreServicio = (id: string) => servicios.get(id)?.nombre ?? "Servicio";
  const desde = (p: Profesional) => p.libreDesde?.getTime() ?? ahora;
  const ordenLibres = [...libres].sort((a, b) => desde(a) - desde(b));
  const ordenAtendiendo = [...atendiendo].sort((a, b) => a.atencion!.finEstimado.getTime() - b.atencion!.finEstimado.getTime());

  const [sel, setSel] = useState<Seleccion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedida, setPedida] = useState("");
  const [pendiente, iniciar] = useTransition();
  const nombreRef = useRef<HTMLInputElement>(null);

  // La selección sobrevive a la actualización automática; si la clienta ya no está (la sentó otra
  // recepcionista o se fue), no hay nada elegido.
  const espera = sel ? tablero.esperas.find(e => e.id === sel.esperaId) ?? null : null;
  const elegidas = espera ? Object.fromEntries(Object.entries(sel!.elegidas).filter(([s]) => espera.servicioIds.includes(s))) : {};
  const faltan = espera ? espera.servicioIds.filter(s => !elegidas[s]) : [];
  const activo = espera ? (sel!.activo && faltan.includes(sel!.activo) ? sel!.activo : faltan[0] ?? null) : null;

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 8000);
    return () => clearTimeout(t);
  }, [aviso]);
  useEffect(() => {
    if (!espera) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) { setSel(null); setError(null); } };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [espera]);

  /** Si la profesional puede empezar ahora este servicio y, si no, por qué. Misma cuenta que «Atender ahora». */
  const evaluar = (p: Profesional, servicioId: string): Evaluacion => {
    const s = servicios.get(servicioId);
    if (p.atencion) return { puede: false, motivo: null };
    if (!s || !p.servicioIds.includes(servicioId)) return { puede: false, motivo: `no hace ${s?.nombre ?? "este servicio"}` };
    if (p.proximo && ahora + s.duracionMinutos * MIN > p.proximo.ocupaDesde.getTime())
      return { puede: false, pisa: true, motivo: `tiene turno a las ${hora(p.proximo.inicio)}${p.proximo.otraSede ? " en otra sede" : ""}` };
    return { puede: true };
  };
  const pueden = (servicioId: string) => libres.filter(p => evaluar(p, servicioId).puede);

  const elegirEspera = (e: Espera) => {
    setError(null);
    setSel(s => s?.esperaId === e.id ? null : { esperaId: e.id, elegidas: {}, activo: null });
  };

  const sentar = (e: Espera, asignadas: Record<string, string>) => {
    const items = e.servicioIds.filter(s => asignadas[s]).map(s => ({ servicioId: s, profesionalId: asignadas[s]! }));
    const form = new FormData();
    form.set("esperaId", e.id);
    items.forEach((i, n) => { form.set(`s_${n}`, i.servicioId); form.set(`p_${n}`, i.profesionalId); });
    setError(null); setAviso(null);
    iniciar(async () => {
      const r = await accionSentar(undefined, form);
      if (r.error) {
        setError(r.error);
        // Con un servicio, la clienta sigue elegida para tocar otra profesional; con dos, se conserva lo elegido.
        setSel({ esperaId: e.id, elegidas: e.servicioIds.length > 1 ? asignadas : {}, activo: null });
        return;
      }
      const quien = items.map(i => `${tablero.profesionales.find(p => p.id === i.profesionalId)?.nombre ?? "?"} (${nombreServicio(i.servicioId)})`).join(" y ");
      const resto = e.servicioIds.filter(s => !asignadas[s]);
      setAviso(`${e.nombre} se sentó con ${quien}${resto.length ? `. Sigue esperando para ${resto.map(nombreServicio).join(" y ")}` : ""}.`);
      // Si quedó un servicio sin sentar, sigue elegida para ese.
      setSel(resto.length ? { esperaId: e.id, elegidas: {}, activo: null } : null);
    });
  };

  /** Toque (o soltar la tarjeta) en una profesional con una clienta elegida. */
  const elegirProfesional = (p: Profesional) => {
    if (!espera || pendiente) return;
    const ya = Object.entries(elegidas).find(([, id]) => id === p.id)?.[0];
    if (ya) { setSel({ esperaId: espera.id, elegidas: Object.fromEntries(Object.entries(elegidas).filter(([s]) => s !== ya)), activo: ya }); return; }
    if (!activo || !evaluar(p, activo).puede) return;
    const asignadas = { ...elegidas, [activo]: p.id };
    // Al completar, se sienta; si falta otro servicio, se pasa a elegir su profesional.
    if (espera.servicioIds.every(s => asignadas[s])) sentar(espera, asignadas);
    else setSel({ esperaId: espera.id, elegidas: asignadas, activo: espera.servicioIds.find(s => !asignadas[s]) ?? null });
  };

  const atender = (p: Profesional) => {
    setSel(null); setError(null);
    setPedida(p.id);
    nombreRef.current?.focus();
    nombreRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  /** Botón y aviso de una profesional libre mientras hay una clienta elegida. */
  const opcion = (p: Profesional) => {
    if (!espera) return null;
    const para = Object.entries(elegidas).find(([, id]) => id === p.id)?.[0];
    const pidio = espera.profesionalId === p.id ? <p className="puesto-nota">Es la que pidió</p> : null;
    if (para) return { clase: "elegida", nodo: <>
      <button type="button" aria-pressed="true" disabled={pendiente} onClick={() => elegirProfesional(p)}>Elegida para {nombreServicio(para)}</button>{pidio}
    </> };
    if (!activo) return { clase: "", nodo: null };
    const ev = evaluar(p, activo);
    if (ev.puede) {
      const completa = espera.servicioIds.filter(s => !elegidas[s]).length === 1;
      return { clase: "puede", nodo: <>
        <button type="button" aria-pressed="false" disabled={pendiente} onClick={() => elegirProfesional(p)}>{completa ? "Sentar acá" : `Elegir para ${nombreServicio(activo)}`}</button>{pidio}
      </> };
    }
    return { clase: ev.pisa ? "pisa" : "apagada", nodo: <p className="puesto-motivo">{ev.motivo ? `No puede: ${ev.motivo}` : "No puede ahora"}</p> };
  };

  const arrastrar = (e: Espera) => (ev: React.DragEvent) => {
    try { ev.dataTransfer.setData("text/plain", e.id); ev.dataTransfer.effectAllowed = "move"; } catch { /* sin dataTransfer */ }
    // Después del arranque del arrastre: si se cambia el DOM antes, el navegador lo cancela.
    if (sel?.esperaId !== e.id) setTimeout(() => { setError(null); setSel({ esperaId: e.id, elegidas: {}, activo: null }); }, 0);
  };
  const soltar = (p: Profesional) => ({
    onDragOver: (ev: React.DragEvent) => { if (espera && activo && evaluar(p, activo).puede) ev.preventDefault(); },
    onDrop: (ev: React.DragEvent) => { ev.preventDefault(); elegirProfesional(p); },
  });

  const franja = (p: Profesional, demorada: boolean) => <div className="agenda-franja" aria-hidden="true">
    {p.agenda.map((g, n) => {
      const izq = Math.max(0, (g.desde.getTime() - ahora) / VENTANA_MS);
      // Una atención pasada del estimado queda como un tramo vacío en «ahora»: se ve como una marca corta.
      const ancho = Math.max(g.tipo === "atencion" ? 0.04 : 0.02, (g.hasta.getTime() - g.desde.getTime()) / VENTANA_MS);
      return <span key={n} className={g.tipo === "atencion" ? (demorada ? "atencion demorada" : "atencion") : "turno"} style={{ left: `${izq * 100}%`, width: `${Math.min(1 - izq, ancho) * 100}%` }} />;
    })}
  </div>;

  return <div className="salon">
    <aside className="salon-entrada" aria-label="Quién entra">
      <AltaSinTurno tablero={tablero} sedeId={sedeId} categorias={categorias} pedida={pedida} setPedida={setPedida} nombreRef={nombreRef}
        pista={id => { const n = pueden(id).length; return n ? `${n} libre${n > 1 ? "s" : ""}` : "nadie libre"; }}
        onAnotada={id => { setError(null); setSel({ esperaId: id, elegidas: {}, activo: null }); }} />

      <section aria-labelledby="t-espera">
        <h2 className="salon-titulo" id="t-espera">En espera <span>{tablero.esperas.length}</span></h2>
        {tablero.esperas.length > 0 && <p className="ayuda">Tocá una clienta y después una profesional resaltada, o arrastrala a su tarjeta.</p>}
        {!tablero.esperas.length && <p className="salon-vacio">Nadie esperando.</p>}
        {tablero.esperas.map(e => {
          const elegida = espera?.id === e.id;
          const minutos = Math.max(0, Math.round((ahora - e.llegada.getTime()) / MIN));
          const pidio = e.profesionalId ? tablero.profesionales.find(p => p.id === e.profesionalId) : null;
          return <div key={e.id} className={elegida ? "espera elegida" : "espera"} draggable onDragStart={arrastrar(e)}>
            <div className="espera-cabecera">
              <h3>{e.cliente ? <Link href={`/clientes/${e.cliente.id}`}>{e.nombre}</Link> : <>{e.nombre} <span className="tag sin-ficha">Sin ficha</span></>}</h3>
              <span className="ayuda">{minutos ? `espera hace ${minutos} min` : "recién llega"}</span>
            </div>
            <button type="button" className="espera-elegir" aria-pressed={elegida} onClick={() => elegirEspera(e)} aria-label={`${elegida ? "Dejar de elegir" : "Elegir"} a ${e.nombre} para sentarla`}>
              <span className="espera-pide">{e.servicioIds.map(nombreServicio).join(" + ")}</span>
              {(pidio || e.notas) && <span className="espera-nota">{[pidio ? `Pidió a ${pidio.nombre}` : "", e.notas ?? ""].filter(Boolean).join(" · ")}</span>}
              {e.servicioIds.map(s => { const ps = pueden(s); return <span key={s} className="ayuda">
                {e.servicioIds.length > 1 ? `${nombreServicio(s)}: ` : ""}{ps.length ? `pueden ahora ${ps.map(p => p.nombre).join(", ")}` : "nadie libre ahora"}
              </span>; })}
            </button>
            <Formulario accion={accionSeFue} boton="Se fue" className="en-linea" secundario confirmar={`¿${e.nombre} se fue sin atenderse?`}><input type="hidden" name="esperaId" value={e.id} /></Formulario>
          </div>;
        })}
      </section>

      <section aria-labelledby="t-turnos">
        <h2 className="salon-titulo" id="t-turnos">Turnos por llegar <span>{tablero.porLlegar.length}</span></h2>
        {!tablero.porLlegar.length ? <p className="salon-vacio">No hay turnos reservados en las próximas dos horas.</p> : <div className="tabla">{tablero.porLlegar.map(r => {
          const tarde = Math.floor((ahora - r.inicio.getTime()) / MIN);
          return <article key={r.reservaId} className="fila">
            <div className="fila-cabecera"><h2><span className="salon-hora">{hora(r.inicio)}</span> <NombreClienta cliente={r.cliente} provisional={r.clienteProvisional} /></h2>
              {r.inicio.getTime() - ahora <= ANTICIPO_LLEGADA_MS && <Formulario accion={accionLlegada} boton="Llegó" className="en-linea" secundario><input type="hidden" name="reservaId" value={r.reservaId} /></Formulario>}</div>
            <p>{r.servicios.join(" · ")}{tarde > 0 && <> <span className="tag estado-pendiente">{tarde} min tarde</span></>}</p>
          </article>;
        })}</div>}
      </section>
    </aside>

    <div className="salon-local">
      {espera && <div className="salon-sentando" role="region" aria-label="Sentar clienta">
        <div className="salon-sentando-texto">
          <strong>Sentando a {espera.nombre}{espera.servicioIds.length === 1 ? ` · ${nombreServicio(espera.servicioIds[0]!)}` : ""}</strong>
          <span>{espera.servicioIds.length === 1
            ? "Tocá una profesional resaltada, o arrastrá la tarjeta de la clienta a la suya."
            : "Elegí una profesional para cada servicio: se sientan juntas al completar. También podés sentar solo uno y dejar el otro esperando."}</span>
          {espera.servicioIds.length > 1 && <div className="en-linea">
            {espera.servicioIds.map(s => { const pro = tablero.profesionales.find(p => p.id === elegidas[s]); return <button key={s} type="button" className="secundario" aria-pressed={activo === s}
              onClick={() => setSel({ esperaId: espera.id, elegidas, activo: s })} disabled={!!pro || pendiente}>{nombreServicio(s)}: {pro ? pro.nombre : "elegí profesional"}</button>; })}
            {Object.keys(elegidas).length > 0 && <button type="button" disabled={pendiente} onClick={() => sentar(espera, elegidas)}>
              {faltan.length ? `Sentar solo ${Object.keys(elegidas).map(nombreServicio).join(" y ")}` : "Sentar"}</button>}
          </div>}
          {pendiente && <span role="status">Sentando…</span>}
          {error && <p className="alerta error" role="alert">{error}</p>}
        </div>
        <button type="button" className="secundario" onClick={() => { setSel(null); setError(null); }}>Cancelar</button>
      </div>}
      {aviso && <p className="alerta ok" role="status">{aviso}</p>}

      <div className="contadores">
        <p><strong>{libres.length}</strong>libres</p>
        <p><strong>{atendiendo.length}</strong>atendiendo</p>
        <p><strong>{tablero.esperas.length}</strong>en espera</p>
        <p><strong>{tablero.porLlegar.length}</strong>turnos por llegar</p>
        <p><strong>{tablero.porCobrar.length}</strong>por cobrar</p>
      </div>
      <p className="leyenda-franja">Franja de cada tarjeta: próximas 2 horas · <span className="muestra atencion" /> en atención · <span className="muestra turno" /> turno reservado</p>

      <section aria-labelledby="t-libres">
        <h2 className="salon-titulo" id="t-libres">Libres <small>La que espera hace más, primero</small></h2>
        {!ordenLibres.length && <p className="salon-vacio">{presentes.length ? "No hay nadie libre ahora." : "Todavía no marcaste la entrada de ninguna profesional (abajo, en «No llegaron»)."}</p>}
        <div className="tablero">{ordenLibres.map(p => {
          const o = opcion(p);
          const minutos = p.libreDesde ? Math.max(0, Math.round((ahora - p.libreDesde.getTime()) / MIN)) : null;
          return <article key={p.id} className={`puesto libre ${o?.clase ?? ""}`} {...soltar(p)}>
            <div className="fila-cabecera"><h2>{p.nombre}</h2>{!espera && <button type="button" onClick={() => atender(p)}>Atender</button>}</div>
            <p className="puesto-estado">{minutos === null ? "Libre" : minutos ? `Libre hace ${minutos} min` : "Libre recién"}</p>
            <p>{p.proximo ? `Turno ${hora(p.proximo.inicio)} · ${p.proximo.servicio}${p.proximo.otraSede ? " en otra sede" : ""}` : "Sin turnos próximos"}</p>
            {franja(p, false)}
            {o?.nodo && <div className="puesto-opcion">{o.nodo}</div>}
            {!espera && p.presencia && <div className="acciones">
              <Formulario accion={accionSalida} boton="Salida" className="en-linea" secundario confirmar={`¿Marcar la salida de ${p.nombre}?`}><input type="hidden" name="presenciaId" value={p.presencia.id} /></Formulario>
            </div>}
          </article>;
        })}</div>
      </section>

      <section aria-labelledby="t-atendiendo">
        <h2 className="salon-titulo" id="t-atendiendo">Atendiendo <small>La que termina antes, primero</small></h2>
        {!ordenAtendiendo.length && <p className="salon-vacio">Nadie está atendiendo.</p>}
        <div className="tablero">{ordenAtendiendo.map(p => {
          const a = p.atencion!;
          const fin = a.finEstimado.getTime();
          const demorada = ahora > fin;
          const pisa = p.proximo && p.proximo.ocupaDesde.getTime() < Math.max(fin, ahora);
          return <article key={p.id} className={`puesto ${demorada ? "demorada" : "ocupada"}${espera ? " apagada" : ""}`}>
            <div className="fila-cabecera"><h2>{p.nombre}</h2><span className={`tag ${demorada ? "estado-pendiente" : "estado-pendiente_pago"}`}>{demorada ? "Demorada" : "Atendiendo"}</span></div>
            <p className="puesto-clienta"><NombreClienta cliente={a.cliente} provisional={a.clienteProvisional} /> · {a.servicios.join(", ")}</p>
            <p className={demorada ? "puesto-demora" : undefined}>{demorada ? `Demorada +${Math.round((ahora - fin) / MIN)} min · era ${hora(fin)}` : `Termina ≈ ${hora(fin)} · en ${Math.max(1, Math.round((fin - ahora) / MIN))} min`}{a.enOtraSede ? " · en otra sede" : ""}</p>
            {p.proximo && <p className={pisa ? "puesto-demora" : "ayuda"}>Después: turno {hora(p.proximo.inicio)} · {p.proximo.servicio}</p>}
            {franja(p, demorada)}
            {!a.enOtraSede && !espera && <Formulario accion={accionTermino} boton="Terminó" className="en-linea"><input type="hidden" name="reservaId" value={a.reservaId} /><input type="hidden" name="profesionalId" value={p.id} /></Formulario>}
          </article>;
        })}</div>
      </section>

      {porCobrar}
      {noLlegaron}
    </div>
  </div>;
}

/**
 * «Llegó sin turno»: nombre, teléfono opcional, hasta dos servicios y la profesional que pidió. Mientras se
 * escribe el nombre o el teléfono busca fichas (desde 3 letras, con una pausa entre teclas) para anotarla
 * con su ficha; si no, queda con solo el nombre y la ficha se completa al cobrar.
 */
function AltaSinTurno({ tablero, sedeId, categorias, pedida, setPedida, nombreRef, pista, onAnotada }: {
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
