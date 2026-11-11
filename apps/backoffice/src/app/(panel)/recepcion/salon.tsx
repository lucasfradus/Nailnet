"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { BuscadorServicio } from "@/components/buscador-servicio";
import { Formulario } from "@/components/formulario";
import { accionCambiarProfesional, accionDestinosTurno, accionLlego, accionPasar, accionSalida, accionSeFue, accionSentar, accionSentarTurno, accionSumar, accionTermino } from "./acciones";
import { NombreClienta, nombreCompleto, repartir, type Tablero } from "./comun";
import { AltaSinTurno } from "./salon-alta";
import { MIN, reglas, type Disponible, type Evaluacion, type Profesional } from "./salon-reglas";

type Espera = Tablero["esperas"][number];
type Llegada = Tablero["llegaron"][number];
type Turno = Tablero["porLlegar"][number];
/**
 * Lo que se está haciendo en el salón: uno solo a la vez. Para sentar (una espera, o una clienta que llegó con
 * turno) se elige una profesional por servicio: `elegidas` va de la clave del servicio a la profesional y
 * `activo` dice a cuál le toca. Cambiar de profesional un turno espera las candidatas del servidor.
 */
type Modo =
  | { tipo: "espera" | "llegada"; id: string; elegidas: Record<string, string>; activo: string | null }
  | { tipo: "turno"; id: string; candidatas: string[] | null }
  | { tipo: "pasar"; id: string; de: string }
  | { tipo: "sumar"; id: string; de: string; servicioId: string };
/** Un servicio para sentar: en una espera la clave es el servicio; en un turno, su posición (y `suya`, su profesional). */
type Pieza = { clave: string; servicioId: string; suya?: string };

/** «Llegó» vale desde una hora antes del turno: antes no se ofrece. */
const ANTICIPO_LLEGADA_MS = 3_600_000;
/** La franja de cada tarjeta muestra las próximas dos horas (la misma ventana que `agenda` en el tablero). */
const VENTANA_MS = 2 * 3_600_000;

/**
 * Tablero del salón (Manos y pies, y las sedes con un solo universo; doc 31, etapas 2 y 3). A la izquierda,
 * quién entra: el alta de la clienta sin turno, la lista de espera (primero las que llegaron con turno) y los
 * turnos por llegar. A la derecha, el salón: libres (la que espera hace más, primero) y atendiendo (la que
 * termina antes, primero), cada una con la franja de sus próximas dos horas.
 *
 * Un solo modo a la vez, con el aviso fijo de arriba y «Cancelar» o Escape para salir: sentar una espera,
 * sentar a una que llegó con turno, cambiar de profesional un turno, pasar una atención o sumar un servicio. Se
 * resaltan las profesionales que pueden (según el motor: `disponiblesAhora` y `destinosDeTurno`); las que
 * pisarían un turno suyo se pueden elegir igual, con borde punteado y el turno que pisan escrito. El servidor
 * decide y su rechazo se muestra tal cual.
 */
export function TableroSalon({ tablero, disponibles, ahora, sedeId, categorias, porCobrar, noLlegaron }: {
  tablero: Tablero; disponibles: Disponible[]; ahora: number; sedeId: string; categorias: Record<string, string>; porCobrar: ReactNode; noLlegaron: ReactNode;
}) {
  const tz = tablero.timezone;
  const hora = (d: Date | number) => new Date(d).toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fechaLocal = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const { presentes, libres, atendiendo } = repartir(tablero);
  const r = reglas({ tablero, disponibles, ahora, hora });
  const { nombreServicio } = r;
  const nombrePro = (id: string) => tablero.profesionales.find(p => p.id === id)?.nombre ?? "otra profesional";
  const desde = (p: Profesional) => p.libreDesde?.getTime() ?? ahora;
  const ordenLibres = [...libres].sort((a, b) => desde(a) - desde(b));
  const ordenAtendiendo = [...atendiendo].sort((a, b) => a.atencion!.finEstimado.getTime() - b.atencion!.finEstimado.getTime());
  const enEspera = tablero.esperas.length + tablero.llegaron.length;

  const [modo, setModo] = useState<Modo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Un rechazo fuera de un modo (por ejemplo, de «Llegó»): se muestra arriba del salón.
  const [avisoError, setAvisoError] = useState<string | null>(null);
  const [pedida, setPedida] = useState("");
  const [pendiente, iniciar] = useTransition();
  const nombreRef = useRef<HTMLInputElement>(null);

  // El modo sobrevive a la actualización automática; si lo elegido ya no está (otra recepcionista sentó a la
  // clienta, la atención terminó, el turno llegó), no hay nada elegido.
  const espera = modo?.tipo === "espera" ? tablero.esperas.find(e => e.id === modo.id) ?? null : null;
  const llegada = modo?.tipo === "llegada" ? tablero.llegaron.find(l => l.reservaId === modo.id) ?? null : null;
  const turno = modo?.tipo === "turno" ? tablero.porLlegar.find(t => t.reservaId === modo.id && t.items.length === 1) ?? null : null;
  const origen = modo?.tipo === "pasar" || modo?.tipo === "sumar" ? atendiendo.find(p => p.id === modo.de && p.atencion?.reservaId === modo.id) ?? null : null;
  const activa = !!(espera || llegada || turno || origen);

  // Sentando: los servicios, lo elegido y a cuál le toca.
  const piezas: Pieza[] = espera ? espera.servicioIds.map(s => ({ clave: s, servicioId: s }))
    : llegada ? llegada.items.map((it, n) => ({ clave: String(n), servicioId: it.servicioId, suya: it.profesionalId })) : [];
  const sel = modo?.tipo === "espera" || modo?.tipo === "llegada" ? modo : null;
  const elegidas = sel ? Object.fromEntries(Object.entries(sel.elegidas).filter(([k]) => piezas.some(pz => pz.clave === k))) : {};
  const faltan = piezas.filter(pz => !elegidas[pz.clave]);
  const activo = sel && piezas.length ? piezas.find(pz => pz.clave === sel.activo && !elegidas[pz.clave]) ?? faltan[0] ?? null : null;
  const propia = llegada?.reservaId;
  const evaluarPieza = (p: Profesional, pz: Pieza) => r.ahoraPara(p, pz.servicioId, propia);

  const salir = () => { setModo(null); setError(null); };
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 10_000);
    return () => clearTimeout(t);
  }, [aviso]);
  useEffect(() => {
    if (!activa) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) { setModo(null); setError(null); } };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [activa]);

  /** Entra a un modo (o sale, si se toca lo mismo otra vez). */
  const clave = (m: Modo) => `${m.tipo}:${m.id}:${"de" in m ? m.de : ""}`;
  const entrar = (m: Modo) => {
    setError(null); setAviso(null); setAvisoError(null);
    setModo(actual => actual && clave(actual) === clave(m) ? null : m);
  };
  const elegirEspera = (e: Espera) => entrar({ tipo: "espera", id: e.id, elegidas: {}, activo: null });
  const elegirLlegada = (l: Llegada) => entrar({ tipo: "llegada", id: l.reservaId, elegidas: {}, activo: null });
  const cambiarTurno = (t: Turno) => {
    if (modo?.tipo === "turno" && modo.id === t.reservaId) { salir(); return; }
    entrar({ tipo: "turno", id: t.reservaId, candidatas: null });
    iniciar(async () => {
      const res = await accionDestinosTurno(t.reservaId, t.inicio.toISOString());
      if (res.error) { setError(res.error); setModo(m => m?.tipo === "turno" && m.id === t.reservaId ? { ...m, candidatas: [] } : m); return; }
      setModo(m => m?.tipo === "turno" && m.id === t.reservaId ? { ...m, candidatas: res.dato ?? [] } : m);
    });
  };

  /** Corre una acción del servidor; si sale bien, sale del modo y avisa. Si no, muestra el rechazo tal cual. */
  const correr = (fn: () => Promise<{ error?: string; ok?: string }>, exito: () => string, despues?: () => void) => {
    setError(null); setAviso(null);
    iniciar(async () => {
      const res = await fn();
      if (res.error) { setError(res.error); return; }
      setModo(null);
      setAviso(exito());
      despues?.();
    });
  };

  const quienes = (asignadas: Record<string, string>) => piezas.filter(pz => asignadas[pz.clave]).map(pz => `${nombrePro(asignadas[pz.clave]!)} (${nombreServicio(pz.servicioId)})`).join(" y ");
  const pisaAlguna = (asignadas: Record<string, string>) => piezas.some(pz => {
    const p = tablero.profesionales.find(x => x.id === asignadas[pz.clave]);
    return !!p && evaluarPieza(p, pz).nivel === "pisa";
  });

  const sentarEspera = (e: Espera, asignadas: Record<string, string>) => {
    const form = new FormData();
    form.set("esperaId", e.id);
    piezas.filter(pz => asignadas[pz.clave]).forEach((pz, n) => { form.set(`s_${n}`, pz.servicioId); form.set(`p_${n}`, asignadas[pz.clave]!); });
    if (pisaAlguna(asignadas)) form.set("pisar", "1");
    const quien = quienes(asignadas);
    const resto = e.servicioIds.filter(s => !asignadas[s]);
    // Si ya tenía una atención en curso (un sentado a medias), lo nuevo se sumó a ese turno: una sola comanda.
    const enCurso = new Set(tablero.profesionales.flatMap(p => p.atencion ? [p.atencion.reservaId] : []));
    setError(null); setAviso(null);
    iniciar(async () => {
      const res = await accionSentar(undefined, form);
      if (res.error) {
        setError(res.error);
        // Con un servicio, la clienta sigue elegida para tocar otra profesional; con dos, se conserva lo elegido.
        setModo({ tipo: "espera", id: e.id, elegidas: e.servicioIds.length > 1 ? asignadas : {}, activo: null });
        return;
      }
      const misma = !!res.id && enCurso.has(res.id);
      setAviso(`${e.nombre} se sentó con ${quien}${misma ? ". Quedó en la misma comanda que lo que ya se está haciendo" : ""}${resto.length ? `. Sigue esperando para ${resto.map(nombreServicio).join(" y ")}` : ""}.`);
      // Si quedó un servicio sin sentar, sigue elegida para ese.
      setModo(resto.length ? { tipo: "espera", id: e.id, elegidas: {}, activo: null } : null);
    });
  };
  const sentarLlegada = (l: Llegada, asignadas: Record<string, string>) => {
    const profesionales = piezas.map(pz => asignadas[pz.clave] ?? null);
    const quien = quienes(asignadas);
    correr(() => accionSentarTurno(l.reservaId, profesionales, pisaAlguna(asignadas)), () => `${nombreDeLlegada(l)} se sentó con ${quien}.`);
  };
  const sentar = (asignadas: Record<string, string>) => {
    if (espera) sentarEspera(espera, asignadas);
    else if (llegada) sentarLlegada(llegada, asignadas);
  };

  const llego = (t: Turno) => {
    const quien = nombreDeTurno(t);
    const con = [...new Set(t.items.map(i => nombrePro(i.profesionalId)))].join(" y ");
    setError(null); setAviso(null); setAvisoError(null);
    iniciar(async () => {
      const res = await accionLlego(t.reservaId);
      if (res.error) { setAvisoError(`${quien}: ${res.error}`); return; }
      if (res.dato?.empezo) { setModo(null); setAviso(`${quien} llegó y empezó con ${con}.`); return; }
      // Su profesional está ocupada: queda primera en la espera, elegida para sentarla con otra si hace falta.
      setAviso(`${quien} llegó, pero ${con} no puede empezar ahora: quedó primera en la espera. Esperala o sentala con otra.`);
      setModo({ tipo: "llegada", id: t.reservaId, elegidas: {}, activo: null });
    });
  };
  useEffect(() => {
    if (!avisoError) return;
    const t = setTimeout(() => setAvisoError(null), 12_000);
    return () => clearTimeout(t);
  }, [avisoError]);

  /** Toque (o soltar una tarjeta) en una profesional, según el modo. */
  const elegirProfesional = (p: Profesional) => {
    if (pendiente) return;
    setAvisoError(null);
    if (sel && (espera || llegada)) {
      const ya = piezas.find(pz => elegidas[pz.clave] === p.id);
      if (ya) { setModo({ ...sel, elegidas: Object.fromEntries(Object.entries(elegidas).filter(([k]) => k !== ya.clave)), activo: ya.clave }); return; }
      if (!activo || evaluarPieza(p, activo).nivel === "no") return;
      const asignadas = { ...elegidas, [activo.clave]: p.id };
      // Al completar, se sienta; si falta otro servicio, se pasa a elegir su profesional.
      if (piezas.every(pz => asignadas[pz.clave])) sentar(asignadas);
      else setModo({ ...sel, elegidas: asignadas, activo: piezas.find(pz => !asignadas[pz.clave])?.clave ?? null });
      return;
    }
    if (turno && modo?.tipo === "turno") {
      if (r.turnoPara(p, turno, modo.candidatas).nivel !== "puede") return;
      correr(() => accionCambiarProfesional(turno.reservaId, turno.inicio.toISOString(), p.id), () => `El turno de ${nombreDeTurno(turno)} (${hora(turno.inicio)}) ahora es con ${p.nombre}.`);
      return;
    }
    if (origen && modo?.tipo === "pasar") {
      const ev = r.pasarA(p, origen);
      if (ev.nivel === "no") return;
      const a = origen.atencion!;
      correr(() => accionPasar(a.reservaId, origen.id, p.id, ev.nivel === "pisa"), () => `${nombreDe(a)} (${a.servicios.join(", ")}) pasó de ${origen.nombre} a ${p.nombre}.`);
      return;
    }
    if (origen && modo?.tipo === "sumar" && modo.servicioId) {
      const ev = r.ahoraPara(p, modo.servicioId);
      if (ev.nivel === "no") return;
      const a = origen.atencion!;
      const s = modo.servicioId;
      correr(() => accionSumar(a.reservaId, s, p.id, ev.nivel === "pisa"), () => `Se sumó ${nombreServicio(s)} con ${p.nombre} a la comanda de ${nombreDe(a)}.`);
    }
  };

  /** Si la profesional se puede elegir en el modo actual, y si no, por qué. `null`: el modo no la mira. */
  const evaluar = (p: Profesional): Evaluacion | null => {
    if (sel && (espera || llegada)) return activo ? evaluarPieza(p, activo) : null;
    if (turno && modo?.tipo === "turno") return r.turnoPara(p, turno, modo.candidatas);
    if (origen && modo?.tipo === "pasar") return p.id === origen.id ? null : r.pasarA(p, origen);
    if (origen && modo?.tipo === "sumar") return p.id === origen.id || !modo.servicioId ? null : r.ahoraPara(p, modo.servicioId);
    return null;
  };
  const verbo = espera || llegada ? "Sentar" : turno ? "Asignar" : modo?.tipo === "pasar" ? "Pasar" : "Sumar";

  /** Botón y aviso de una tarjeta mientras hay un modo activo. */
  const opcion = (p: Profesional): { clase: string; nodo: ReactNode } | null => {
    if (!activa) return null;
    if (origen?.id === p.id) return { clase: "origen", nodo: <p className="puesto-nota">{modo?.tipo === "pasar" ? "Pasando desde acá" : "Sumando a esta comanda"}</p> };
    const notas: string[] = [];
    if (espera?.profesionalId === p.id) notas.push("Es la que pidió");
    if (activo?.suya === p.id) notas.push("Su profesional");
    const nota = notas.length ? <p className="puesto-nota">{notas.join(" · ")}</p> : null;
    const para = piezas.find(pz => elegidas[pz.clave] === p.id);
    if (para) return { clase: "elegida", nodo: <>
      <button type="button" aria-pressed="true" disabled={pendiente} onClick={() => elegirProfesional(p)}>Elegida para {nombreServicio(para.servicioId)}</button>{nota}
    </> };
    const ev = evaluar(p);
    if (!ev) return { clase: "", nodo: null };
    if (ev.nivel === "no") return { clase: "apagada", nodo: ev.motivo ? <p className="puesto-motivo">No puede: {ev.motivo}</p> : null };
    const igual = ev.nivel === "pisa";
    const completa = !(espera || llegada) || faltan.length === 1;
    const etiqueta = completa ? `${verbo} ${igual ? "igual" : "acá"}` : `Elegir${igual ? " igual" : ""} para ${nombreServicio(activo!.servicioId)}`;
    return { clase: igual ? "pisa" : "puede", nodo: <>
      {igual && <p className="puesto-aviso">{ev.motivo}</p>}
      <button type="button" className={igual ? "secundario" : undefined} aria-pressed="false" disabled={pendiente} onClick={() => elegirProfesional(p)}>{etiqueta}</button>{nota}
    </> };
  };

  const arrastrar = (m: Modo) => (ev: React.DragEvent) => {
    try { ev.dataTransfer.setData("text/plain", m.id); ev.dataTransfer.effectAllowed = "move"; } catch { /* sin dataTransfer */ }
    // Después del arranque del arrastre: si se cambia el DOM antes, el navegador lo cancela.
    if (modo?.id !== m.id) setTimeout(() => { setError(null); setModo(m); }, 0);
  };
  const soltar = (p: Profesional) => ({
    onDragOver: (ev: React.DragEvent) => { if ((espera || llegada) && activo && evaluarPieza(p, activo).nivel !== "no") ev.preventDefault(); },
    onDrop: (ev: React.DragEvent) => { ev.preventDefault(); elegirProfesional(p); },
  });

  const atender = (p: Profesional) => {
    salir();
    setPedida(p.id);
    nombreRef.current?.focus();
    nombreRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  /** Quiénes pueden empezar ahora un servicio, y quiénes solo pisando un turno: para la lista de espera. */
  const quienPuede = (servicioId: string, propiaId?: string) => {
    const ev = libres.map(p => ({ p, ev: r.ahoraPara(p, servicioId, propiaId) }));
    const ya = ev.filter(x => x.ev.nivel === "puede").map(x => x.p.nombre);
    const pisando = ev.filter(x => x.ev.nivel === "pisa").map(x => x.p.nombre);
    return ya.length ? `pueden ahora ${ya.join(", ")}` : pisando.length ? `nadie libre sin pisar un turno · pisando: ${pisando.join(", ")}` : "nadie libre ahora";
  };

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
        pista={id => { const n = libres.filter(p => r.ahoraPara(p, id).nivel === "puede").length; return n ? `${n} libre${n > 1 ? "s" : ""}` : "nadie libre"; }}
        onAnotada={id => { setError(null); setModo({ tipo: "espera", id, elegidas: {}, activo: null }); }} />

      <section aria-labelledby="t-espera">
        <h2 className="salon-titulo" id="t-espera">En espera <span>{enEspera}</span></h2>
        {enEspera > 0 && <p className="ayuda">Tocá una clienta y después una profesional resaltada, o arrastrala a su tarjeta.</p>}
        {!enEspera && <p className="salon-vacio">Nadie esperando.</p>}
        {tablero.llegaron.map(l => {
          const elegida = llegada?.reservaId === l.reservaId;
          const minutos = Math.max(0, Math.round((ahora - l.llegoEn.getTime()) / MIN));
          const con = [...new Set(l.items.map(i => i.profesional))].join(" y ");
          return <div key={l.reservaId} className={`espera con-turno${elegida ? " elegida" : ""}`} draggable onDragStart={arrastrar({ tipo: "llegada", id: l.reservaId, elegidas: {}, activo: null })}>
            <div className="espera-cabecera">
              <h3><NombreClienta cliente={l.cliente} provisional={l.clienteProvisional} /></h3>
              <span className="ayuda">{minutos ? `llegó hace ${minutos} min` : "recién llega"}</span>
            </div>
            <button type="button" className="espera-elegir" aria-pressed={elegida} onClick={() => elegirLlegada(l)} aria-label={`${elegida ? "Dejar de elegir" : "Elegir"} a ${nombreDeLlegada(l)} para sentarla`}>
              <span className="espera-nota">Con turno {hora(l.inicio)} · con {con}</span>
              <span className="espera-pide">{l.items.map(i => i.servicio).join(" + ")}</span>
              {l.items.map((it, n) => <span key={n} className="ayuda">{l.items.length > 1 ? `${it.servicio}: ` : ""}{quienPuede(it.servicioId, l.reservaId)}</span>)}
            </button>
          </div>;
        })}
        {tablero.esperas.map(e => {
          const elegida = espera?.id === e.id;
          const minutos = Math.max(0, Math.round((ahora - e.llegada.getTime()) / MIN));
          const pidio = e.profesionalId ? tablero.profesionales.find(p => p.id === e.profesionalId) : null;
          return <div key={e.id} className={elegida ? "espera elegida" : "espera"} draggable onDragStart={arrastrar({ tipo: "espera", id: e.id, elegidas: {}, activo: null })}>
            <div className="espera-cabecera">
              <h3>{e.cliente ? <Link href={`/clientes/${e.cliente.id}`}>{e.nombre}</Link> : <>{e.nombre} <span className="tag sin-ficha">Sin ficha</span></>}</h3>
              <span className="ayuda">{minutos ? `espera hace ${minutos} min` : "recién llega"}</span>
            </div>
            <button type="button" className="espera-elegir" aria-pressed={elegida} onClick={() => elegirEspera(e)} aria-label={`${elegida ? "Dejar de elegir" : "Elegir"} a ${e.nombre} para sentarla`}>
              <span className="espera-pide">{e.servicioIds.map(nombreServicio).join(" + ")}</span>
              {(pidio || e.notas) && <span className="espera-nota">{[pidio ? `Pidió a ${pidio.nombre}` : "", e.notas ?? ""].filter(Boolean).join(" · ")}</span>}
              {e.servicioIds.map(s => <span key={s} className="ayuda">{e.servicioIds.length > 1 ? `${nombreServicio(s)}: ` : ""}{quienPuede(s)}</span>)}
            </button>
            <Formulario accion={accionSeFue} boton="Se fue" className="en-linea" secundario confirmar={`¿${e.nombre} se fue sin atenderse?`}><input type="hidden" name="esperaId" value={e.id} /></Formulario>
          </div>;
        })}
      </section>

      <section aria-labelledby="t-turnos">
        <h2 className="salon-titulo" id="t-turnos">Turnos por llegar <span>{tablero.porLlegar.length}</span></h2>
        {!tablero.porLlegar.length ? <p className="salon-vacio">No hay turnos reservados en las próximas dos horas.</p> : <div className="tabla">{tablero.porLlegar.map(t => {
          const tarde = Math.floor((ahora - t.inicio.getTime()) / MIN);
          const cambiando = turno?.reservaId === t.reservaId;
          const riesgo = t.riesgos.map(x => x.demorada ? `${x.profesional} viene demorada` : `${x.profesional} termina ≈ ${hora(x.libreEstimado!)}`);
          return <article key={t.reservaId} className={`fila turno-llega${riesgo.length ? " en-riesgo" : ""}${cambiando ? " elegida" : ""}`}>
            <div className="fila-cabecera"><h2><span className="salon-hora">{hora(t.inicio)}</span> <NombreClienta cliente={t.cliente} provisional={t.clienteProvisional} /></h2>
              {t.inicio.getTime() - ahora <= ANTICIPO_LLEGADA_MS && <button type="button" className="secundario" disabled={pendiente} onClick={() => llego(t)}>Llegó</button>}</div>
            <p>{t.servicios.join(" · ")}{tarde > 0 && <> <span className="tag estado-pendiente">{tarde} min tarde</span></>}</p>
            {riesgo.length > 0 && <p className="turno-riesgo"><strong>En riesgo:</strong> {riesgo.join(" · ")}</p>}
            <div className="acciones">{t.items.length === 1
              ? <button type="button" className="secundario" aria-pressed={cambiando} disabled={pendiente && !cambiando} onClick={() => cambiarTurno(t)}>Cambiar de profesional</button>
              : <Link className="boton secundario" href={`/agenda/nuevo?fecha=${fechaLocal(t.inicio)}&reprogramar=${t.reservaId}`}>Cambiar en la agenda</Link>}</div>
          </article>;
        })}</div>}
      </section>
    </aside>

    <div className="salon-local">
      {activa && <div className="salon-sentando" role="region" aria-label="Lo que estás haciendo">
        <div className="salon-sentando-texto">
          {(espera || llegada) && <>
            <strong>Sentando a {espera ? espera.nombre : nombreDeLlegada(llegada!)}{llegada ? ` · con turno ${hora(llegada.inicio)}` : ""}{piezas.length === 1 ? ` · ${nombreServicio(piezas[0]!.servicioId)}` : ""}</strong>
            <span>{piezas.length === 1
              ? "Tocá una profesional resaltada, o arrastrá la tarjeta de la clienta a la suya."
              : llegada ? "Elegí una profesional para cada servicio. Los que no elijas siguen con su profesional."
                : "Elegí una profesional para cada servicio: se sientan juntas al completar. También podés sentar solo uno y dejar el otro esperando."}</span>
            {llegada && <span>{suyaOcupada(llegada, tablero, ahora, hora)}</span>}
            <span>Borde punteado: tiene un turno cerca y lo pisaría; se puede sentar igual.</span>
            {piezas.length > 1 && <div className="en-linea">
              {piezas.map(pz => { const pro = elegidas[pz.clave]; return <button key={pz.clave} type="button" className="secundario" aria-pressed={activo?.clave === pz.clave}
                onClick={() => setModo({ ...sel!, elegidas, activo: pz.clave })} disabled={!!pro || pendiente}>{nombreServicio(pz.servicioId)}: {pro ? nombrePro(pro) : "elegí profesional"}</button>; })}
              {Object.keys(elegidas).length > 0 && <button type="button" disabled={pendiente} onClick={() => sentar(elegidas)}>
                {!faltan.length ? "Sentar" : llegada ? "Sentar" : `Sentar solo ${piezas.filter(pz => elegidas[pz.clave]).map(pz => nombreServicio(pz.servicioId)).join(" y ")}`}</button>}
            </div>}
          </>}
          {turno && modo?.tipo === "turno" && <>
            <strong>Cambiando de profesional el turno de {nombreDeTurno(turno)} · {hora(turno.inicio)} · {nombreServicio(turno.items[0]!.servicioId)}</strong>
            <span>{modo.candidatas === null ? "Buscando quién tiene libre esa hora…" : modo.candidatas.some(id => !turno.items.some(i => i.profesionalId === id))
              ? "Se resaltan las que hacen el servicio y tienen libre esa hora. Tocá una para pasarle el turno."
              : "Nadie más tiene libre esa hora para este servicio."}</span>
            <OtrasCandidatas turno={turno} candidatas={modo.candidatas} visibles={[...libres, ...atendiendo]} profesionales={tablero.profesionales} pendiente={pendiente} elegir={elegirProfesional} />
          </>}
          {origen && modo?.tipo === "pasar" && <>
            <strong>Pasando a {nombreDe(origen.atencion!)} ({origen.atencion!.servicios.join(", ")}) de {origen.nombre} a otra profesional</strong>
            <span>Tocá una profesional libre resaltada. Borde punteado: tiene un turno cerca y lo pisaría; se puede pasar igual.</span>
          </>}
          {origen && modo?.tipo === "sumar" && <>
            <strong>Sumando un servicio a la comanda de {nombreDe(origen.atencion!)}</strong>
            <span>{modo.servicioId ? "Ahora tocá la profesional que lo hace: empieza ya, con otra profesional." : "Elegí el servicio y después la profesional que lo hace."}</span>
            <div className="salon-sumar">
              <BuscadorServicio id="sumar-servicio" servicios={tablero.servicios.map(s => ({ ...s, categoria: categorias[s.id] ?? "Servicios" }))} valor={modo.servicioId} placeholder="Servicio…"
                pista={id => { const n = libres.filter(p => r.ahoraPara(p, id).nivel === "puede").length; return n ? `${n} libre${n > 1 ? "s" : ""}` : "nadie libre"; }}
                onElegir={id => { setError(null); setModo({ ...modo, servicioId: id }); }} />
            </div>
          </>}
          {pendiente && <span role="status">Un momento…</span>}
          {error && <p className="alerta error" role="alert">{error}</p>}
        </div>
        <button type="button" className="secundario" onClick={salir}>Cancelar</button>
      </div>}
      {aviso && <p className="alerta ok" role="status">{aviso}</p>}
      {avisoError && !activa && <p className="alerta error" role="alert">{avisoError}</p>}

      <div className="contadores">
        <p><strong>{libres.length}</strong>libres</p>
        <p><strong>{atendiendo.length}</strong>atendiendo</p>
        <p><strong>{enEspera}</strong>en espera</p>
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
          const jornada = r.jornada(p);
          return <article key={p.id} className={`puesto libre ${o?.clase ?? ""}`} {...soltar(p)}>
            <div className="fila-cabecera"><h2>{p.nombre}</h2>{!activa && <button type="button" onClick={() => atender(p)}>Atender</button>}</div>
            <p className="puesto-estado">{minutos === null ? "Libre" : minutos ? `Libre hace ${minutos} min` : "Libre recién"}</p>
            {jornada && <p className="puesto-demora">{jornada}</p>}
            <p>{p.proximo ? `Turno ${hora(p.proximo.inicio)} · ${p.proximo.servicio}${p.proximo.cliente ? ` · ${nombreCompleto(p.proximo.cliente)}` : ""}${p.proximo.otraSede ? " en otra sede" : ""}` : "Sin turnos próximos"}</p>
            {franja(p, false)}
            {o?.nodo && <div className="puesto-opcion">{o.nodo}</div>}
            {!activa && p.presencia && <div className="acciones">
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
          const o = opcion(p);
          const pasando = modo?.tipo === "pasar" && origen?.id === p.id, sumando = modo?.tipo === "sumar" && origen?.id === p.id;
          return <article key={p.id} className={`puesto ${demorada ? "demorada" : "ocupada"} ${o?.clase ?? ""}`}>
            <div className="fila-cabecera"><h2>{p.nombre}</h2><span className={`tag ${demorada ? "estado-pendiente" : "estado-pendiente_pago"}`}>{demorada ? "Demorada" : "Atendiendo"}</span></div>
            <p className="puesto-clienta"><NombreClienta cliente={a.cliente} provisional={a.clienteProvisional} /> · {a.servicios.join(", ")}</p>
            <p className={demorada ? "puesto-demora" : undefined}>{demorada ? `Demorada +${Math.round((ahora - fin) / MIN)} min · era ${hora(fin)}` : `Termina ≈ ${hora(fin)} · en ${Math.max(1, Math.round((fin - ahora) / MIN))} min`}{a.enOtraSede ? " · en otra sede" : ""}</p>
            {p.proximo && <p className={pisa ? "puesto-demora" : "ayuda"}>Después: turno {hora(p.proximo.inicio)} · {p.proximo.servicio}</p>}
            {franja(p, demorada)}
            {o?.nodo && <div className="puesto-opcion">{o.nodo}</div>}
            {!a.enOtraSede && (!activa || pasando || sumando) && <div className="puesto-acciones">
              {!activa && <Formulario accion={accionTermino} boton="Terminó" className="en-linea"><input type="hidden" name="reservaId" value={a.reservaId} /><input type="hidden" name="profesionalId" value={p.id} /></Formulario>}
              <button type="button" className="secundario" aria-pressed={pasando} disabled={pendiente} onClick={() => entrar({ tipo: "pasar", id: a.reservaId, de: p.id })}>Pasar</button>
              <button type="button" className="secundario" aria-pressed={sumando} disabled={pendiente} onClick={() => entrar({ tipo: "sumar", id: a.reservaId, de: p.id, servicioId: "" })}>+ servicio</button>
            </div>}
          </article>;
        })}</div>
      </section>

      {porCobrar}
      {noLlegaron}
    </div>
  </div>;
}

const nombreDe = (x: { cliente: { nombre: string; apellido: string | null } | null; clienteProvisional: string | null }) => x.cliente ? nombreCompleto(x.cliente) : x.clienteProvisional ?? "La clienta";
const nombreDeTurno = (t: Turno) => nombreDe(t);
const nombreDeLlegada = (l: Llegada) => nombreDe(l);

/** Para la clienta que llegó con turno: si su profesional está libre, atendiendo o no vino. */
function suyaOcupada(l: Llegada, tablero: Tablero, ahora: number, hora: (d: Date | number) => string) {
  const ids = [...new Set(l.items.map(i => i.profesionalId))];
  return ids.map(id => {
    const p = tablero.profesionales.find(x => x.id === id);
    const nombre = p?.nombre ?? l.items.find(i => i.profesionalId === id)!.profesional;
    if (!p) return `${nombre} no está en este universo.`;
    if (p.atencion) return p.atencion.finEstimado.getTime() < ahora ? `${nombre} está atendiendo y viene demorada: esperala o sentala con otra.` : `${nombre} está atendiendo (termina ≈ ${hora(p.atencion.finEstimado)}): esperala o sentala con otra.`;
    if (!p.presencia || p.presencia.otraSede) return `${nombre} no está en el local: sentala con otra.`;
    return `${nombre} está libre: está marcada «Su profesional».`;
  }).join(" ");
}

/**
 * Cambiar de profesional un turno: las candidatas que no están en el salón ahora (no marcaron la entrada, o
 * están en otra sede) no tienen tarjeta; se ofrecen acá.
 */
function OtrasCandidatas({ turno, candidatas, visibles, profesionales, pendiente, elegir }: {
  turno: Turno; candidatas: string[] | null; visibles: Profesional[]; profesionales: Profesional[]; pendiente: boolean; elegir: (p: Profesional) => void;
}) {
  const otras = (candidatas ?? []).filter(id => !visibles.some(p => p.id === id) && !turno.items.some(i => i.profesionalId === id))
    .map(id => profesionales.find(p => p.id === id)).filter((p): p is Profesional => !!p);
  if (!otras.length) return null;
  return <div className="en-linea">
    <span className="ayuda">También tienen libre esa hora (todavía no están en el salón):</span>
    {otras.map(p => <button key={p.id} type="button" className="secundario" disabled={pendiente} onClick={() => elegir(p)}>Asignar a {p.nombre}</button>)}
  </div>;
}
