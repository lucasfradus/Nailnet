"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { EstadoGrilla } from "@nailnet/database/agenda-dia";
import type { Estado } from "@/components/formulario";
import { accionAusenteTurno, accionBuscarClientas, accionCancelarTurno, accionCrearClienta, accionEmpezo, accionMoverTurno, accionReservarTurno, accionTerminoSesion } from "./acciones-tratamientos";
import { crearCuentas, duracion, hora, type DatosGrilla, type TurnoGrilla } from "./tratamientos-modelo";

/** Píxeles por minuto: una sesión de 60 minutos mide 72 px. */
const PX = 1.2;
const ETIQUETA: Record<EstadoGrilla, string> = { PENDIENTE_PAGO: "Seña pendiente", CONFIRMADA: "Confirmado", EN_SESION: "En sesión", POR_COBRAR: "Por cobrar", COBRADA: "Cobrado", AUSENTE: "Ausente" };
const CLASE: Record<EstadoGrilla, string> = { PENDIENTE_PAGO: "pendiente", CONFIRMADA: "confirmada", EN_SESION: "sesion", POR_COBRAR: "cobrar", COBRADA: "cobrado", AUSENTE: "ausente" };
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diaLargo = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

type Clienta = { id: string; nombre: string; telefono: string | null };
type Nuevo = { inicio: number; profesionalId: string | null; cabinaId: string | null; servicioId: string; elegida: string; cabinas: Record<string, string>; clienta: Clienta | null; notas: string };
/** Inicio tocado mientras se mueve un turno: en la vista por profesional trae la profesional; en la de cabina, la cabina. */
type Destino = { inicio: number; profesionalId: string | null; cabinaId: string | null; elegida: number; cabinas: Record<string, string> };
type Resultado<T> = Estado & { dato?: T };

/** Estado que se muestra: el de la grilla, más «no empezó» cuando ya pasó su hora y «terminó» por servicio. */
function estadoVisible(t: TurnoGrilla, d: DatosGrilla) {
  if (t.estado === "CONFIRMADA" && t.terminado) return { clase: "cobrar", texto: "Terminó" };
  if (t.estado === "CONFIRMADA") {
    if (d.fecha < d.hoy) return { clase: "tarde", texto: "No empezó" };
    if (d.esHoy && d.ahora !== null && d.ahora > t.inicio) return { clase: "tarde", texto: `No empezó · ${d.ahora - t.inicio} min` };
  }
  return { clase: CLASE[t.estado], texto: ETIQUETA[t.estado] };
}

/** Carriles para bloques que se pisan en una misma columna (por ejemplo, «Sin cabina»). */
function carriles<T extends { inicio: number; fin: number }>(xs: T[]) {
  const ordenados = [...xs].sort((a, b) => a.inicio - b.inicio);
  const fines: number[] = [];
  const carril = new Map<T, number>();
  for (const x of ordenados) {
    let i = fines.findIndex(f => f <= x.inicio);
    if (i < 0) { i = fines.length; fines.push(0); }
    fines[i] = x.fin; carril.set(x, i);
  }
  return { carril, total: Math.max(1, fines.length) };
}

/**
 * Grilla del día de Tratamientos (doc 31, etapa 4). Columnas por profesional o por cabina; tocar un turno
 * abre su panel, tocar un inicio libre abre «Nuevo turno» y «Mover» resalta los destinos que da el motor.
 * La selección, «Nuevo turno» y lo escrito son estado de la pantalla: la actualización automática
 * (router.refresh) trae datos nuevos sin borrarlos.
 */
export function GrillaTratamientos({ datos: d }: { datos: DatosGrilla }) {
  const router = useRouter();
  const c = useMemo(() => crearCuentas(d), [d]);
  const [sel, setSel] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<Nuevo | null>(null);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  const href = (cambios: Record<string, string | null>) => {
    const u = new URLSearchParams(d.parametros);
    for (const [k, v] of Object.entries(cambios)) if (v === null) u.delete(k); else u.set(k, v);
    return `/recepcion?${u}`;
  };
  const irA = (cambios: Record<string, string | null>) => router.replace(href(cambios), { scroll: false });
  const nombreProfesional = (id: string) => c.profesional.get(id)?.nombre ?? "otra profesional";
  const nombreCabinas = (ids: string[]) => ids.map(id => c.recurso.get(id)?.nombre ?? "cabina").join(", ");
  const cerrar = () => { setSel(null); setNuevo(null); setDestino(null); setCancelando(null); setError(null); };

  // Escape cierra el panel o deja de mover.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (destino || nuevo || sel) cerrar();
      else if (d.moviendo) router.replace(href({ mover: null }), { scroll: false });
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });
  // Al abrir un panel, el foco va a su título (en tablet el panel aparece abajo, sobre la grilla).
  const abierto = destino ? `d${destino.inicio}${destino.profesionalId}${destino.cabinaId}` : nuevo ? `n${nuevo.inicio}${nuevo.profesionalId}${nuevo.cabinaId}` : sel ?? "";
  useEffect(() => { if (abierto) panel.current?.querySelector<HTMLElement>("h2")?.focus(); }, [abierto]);

  function operar<T>(fn: () => Promise<Resultado<T>>, despues?: (r: Resultado<T>) => void) {
    setError(null); setMensaje(null);
    iniciar(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else { if (r?.ok) setMensaje(r.ok); despues?.(r); }
    });
  }

  // ─── Geometría ────────────────────────────────────────────────────────────
  const bordes = [...d.apertura, ...d.profesionales.flatMap(p => p.disponible), ...d.turnos.map(t => ({ desde: t.inicio, hasta: t.fin }))];
  const inicioDia = bordes.length ? Math.floor(Math.min(...bordes.map(x => x.desde)) / 60) * 60 : 9 * 60;
  const finDia = bordes.length ? Math.ceil(Math.max(...bordes.map(x => x.hasta)) / 60) * 60 : 20 * 60;
  const alto = (finDia - inicioDia) * PX;
  const y = (m: number) => (m - inicioDia) * PX;
  const pasos: number[] = [];
  for (let m = inicioDia; m < finDia; m += d.paso) pasos.push(m);

  const moviendo = d.moviendo;
  const destinos = moviendo?.destinos ?? null;
  const sinCabina = d.turnos.some(t => !t.recursoIds.length);
  type Columna = { id: string; tipo: "profesional" | "cabina" | "sin-cabina"; nombre: string; sub: string; abierto: { desde: number; hasta: number }[]; ausencias: { desde: number; hasta: number; motivo: string | null }[]; turnos: TurnoGrilla[] };
  const columnas: Columna[] = d.vista === "profesional"
    ? d.profesionales.map(p => ({
      id: p.id, tipo: "profesional", nombre: p.nombre, abierto: p.disponible, ausencias: p.ausencias, turnos: d.turnos.filter(t => t.profesionalId === p.id),
      sub: !p.disponible.length ? "No trabaja este día" : `${p.disponible.map(x => `${hora(x.desde)}–${hora(x.hasta)}`).join(", ")}${p.servicioIds.length ? "" : " · sin tratamientos"}`,
    }))
    : [...d.recursos.map(r => ({ id: r.id, tipo: "cabina" as const, nombre: r.nombre, sub: r.tipo, abierto: d.apertura, ausencias: [], turnos: d.turnos.filter(t => t.recursoIds.includes(r.id)) })),
      ...(sinCabina ? [{ id: "", tipo: "sin-cabina" as const, nombre: "Sin cabina", sub: "Servicios que no usan cabina", abierto: d.apertura, ausencias: [], turnos: d.turnos.filter(t => !t.recursoIds.length) }] : [])];

  /** Inicios resaltados al mover, por columna. */
  const destinosDe = (col: Columna) => {
    if (!destinos) return [];
    const r: { inicio: number; fin: number }[] = [];
    for (const dst of destinos) for (const i of dst.inicios) {
      if (i.inicio < c.desdeMin) continue;
      const ok = col.tipo === "profesional" ? dst.profesionalIds[0] === col.id
        : col.tipo === "cabina" ? i.items.some(it => it.recursos.some(q => q.libres.includes(col.id)))
        : i.items.every(it => !it.recursos.length);
      if (ok && !r.some(x => x.inicio === i.inicio)) r.push({ inicio: i.inicio, fin: i.fin });
    }
    return r.sort((a, b) => a.inicio - b.inicio);
  };

  // ─── Selección ────────────────────────────────────────────────────────────
  const elegidos = sel ? d.turnos.filter(t => t.reservaId === sel).sort((a, b) => a.posicion - b.posicion) : [];
  const moviendoAca = moviendo ? d.turnos.filter(t => t.reservaId === moviendo.reservaId).sort((a, b) => a.posicion - b.posicion) : [];

  function abrirNuevo(inicio: number, profesionalId: string | null, cabinaId: string | null) {
    setSel(null); setDestino(null); setCancelando(null); setError(null);
    setNuevo(n => ({ inicio, profesionalId, cabinaId, servicioId: "", elegida: profesionalId ?? "", cabinas: {}, clienta: n?.clienta ?? null, notas: n?.notas ?? "" }));
  }
  function tocarTurno(t: TurnoGrilla) {
    setNuevo(null); setDestino(null); setCancelando(null); setError(null);
    setSel(s => (s === t.reservaId ? null : t.reservaId));
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const huecos = c.huecos();
  const panelActivo = !!(destino || nuevo || elegidos.length);
  return <div className="trat">
    <div className="trat-barra">
      <nav className="en-linea trat-fechas" aria-label="Fecha">
        <Link href={href({ fecha: sumarDias(d.fecha, -1) === d.hoy ? null : sumarDias(d.fecha, -1) })} scroll={false}>← Anterior</Link>
        <Link href={href({ fecha: null })} scroll={false} aria-current={d.esHoy ? "date" : undefined}>Hoy</Link>
        <Link href={href({ fecha: sumarDias(d.fecha, 1) === d.hoy ? null : sumarDias(d.fecha, 1) })} scroll={false}>Siguiente →</Link>
        <input type="date" aria-label="Ir a otra fecha" value={d.fecha} onChange={e => { if (e.target.value) irA({ fecha: e.target.value === d.hoy ? null : e.target.value }); }} />
      </nav>
      <h2 className="trat-dia">{d.esHoy ? "Hoy, " : ""}{diaLargo(d.fecha)}</h2>
      <nav className="trat-vistas" aria-label="Columnas">
        <Link href={href({ vista: null })} scroll={false} aria-current={d.vista === "profesional" ? "page" : undefined}>Por profesional</Link>
        <Link href={href({ vista: "cabina" })} scroll={false} aria-current={d.vista === "cabina" ? "page" : undefined}>Por cabina</Link>
      </nav>
    </div>

    {moviendo && <div className="trat-moviendo" role="status">
      <div>
        <strong>Moviendo a {moviendo.cliente} · {moviendo.servicios}</strong>
        <span>{moviendo.error ?? (destinos?.some(x => x.inicios.some(i => i.inicio >= c.desdeMin))
          ? `Estaba ${moviendo.desde}. Tocá un horario resaltado y elegí la cabina. Para pasarlo a otro día, cambiá la fecha: el turno sigue en movimiento.`
          : `No hay horarios libres para este turno el ${diaLargo(d.fecha)}. Probá con otra fecha.`)}</span>
      </div>
      <Link className="boton secundario" href={href({ mover: null })} scroll={false} onClick={() => setDestino(null)}>Dejar de mover</Link>
    </div>}
    {mensaje && <p className="alerta ok trat-mensaje" role="status">{mensaje} <button type="button" className="secundario" onClick={() => setMensaje(null)}>Cerrar</button></p>}
    {d.apertura.length === 0 && <p className="alerta aviso">La sede no abre este día.</p>}

    <div className="trat-cuerpo">
      <div className="trat-grilla" role="region" aria-label={`Agenda de Tratamientos, ${diaLargo(d.fecha)}`} tabIndex={0}>
        <div className="trat-lienzo" style={{ minWidth: 56 + columnas.length * 150 }}>
          <div className="trat-fila-cabecera">
            <div className="trat-eje" />
            {columnas.map(col => <div key={col.id || "sin"} className={destinos && !destinosDe(col).length ? "trat-titulo apagada" : "trat-titulo"}>
              <strong>{col.nombre}</strong><small>{col.sub}</small>
            </div>)}
          </div>
          <div className="trat-fila-cuerpo" style={{ height: alto }}>
            <div className="trat-eje">
              {Array.from({ length: (finDia - inicioDia) / 60 + 1 }, (_, i) => inicioDia + i * 60).map(m => <span key={m} style={{ top: y(m) }}>{hora(m)}</span>)}
            </div>
            {columnas.map(col => {
              const lanes = carriles(col.turnos);
              const resaltados = destinosDe(col);
              const fuera = [{ desde: inicioDia, hasta: finDia }].flatMap(base => {
                let r = [base];
                for (const a of col.abierto) r = r.flatMap(x => x.hasta <= a.desde || a.hasta <= x.desde ? [x] : [...(x.desde < a.desde ? [{ desde: x.desde, hasta: a.desde }] : []), ...(a.hasta < x.hasta ? [{ desde: a.hasta, hasta: x.hasta }] : [])]);
                return r;
              });
              return <div key={col.id || "sin"} className={destinos && !resaltados.length ? "trat-columna apagada" : "trat-columna"} style={{ height: alto, backgroundSize: `100% ${60 * PX}px` }}>
                {fuera.map((x, i) => <div key={`f${i}`} className="trat-fuera" style={{ top: y(x.desde), height: (x.hasta - x.desde) * PX }} aria-hidden />)}
                {col.ausencias.map((x, i) => <div key={`a${i}`} className="trat-ausencia" style={{ top: y(Math.max(x.desde, inicioDia)), height: (Math.min(x.hasta, finDia) - Math.max(x.desde, inicioDia)) * PX }}><span>Ausencia{x.motivo ? `: ${x.motivo}` : ""}</span></div>)}

                {destinos ? resaltados.map(r => {
                  const propio = moviendoAca.some(t => t.inicio === r.inicio && (col.tipo !== "profesional" || t.profesionalId === col.id) && (col.tipo !== "cabina" || t.recursoIds.includes(col.id)));
                  const activo = destino?.inicio === r.inicio && (destino.profesionalId ?? destino.cabinaId ?? "") === col.id;
                  return <button key={`m${r.inicio}`} type="button" className={activo ? "trat-inicio destino activo" : "trat-inicio destino"} style={{ top: y(r.inicio) + 1, height: Math.min(r.fin - r.inicio, d.paso) * PX - 2 }}
                    aria-label={`Mover a las ${hora(r.inicio)}${col.tipo === "profesional" ? ` con ${col.nombre}` : col.tipo === "cabina" ? ` en ${col.nombre}` : ""}`}
                    onClick={() => { setSel(null); setNuevo(null); setError(null); setDestino({ inicio: r.inicio, profesionalId: col.tipo === "profesional" ? col.id : null, cabinaId: col.tipo === "cabina" ? col.id : null, elegida: 0, cabinas: {} }); }}>
                    {propio ? `${hora(r.inicio)} · mismo horario` : `Mover a ${hora(r.inicio)}`}
                  </button>;
                }) : col.tipo !== "sin-cabina" && pasos.filter(m => col.tipo === "profesional" ? c.inicioLibreProfesional(col.id, m) : c.inicioLibreCabina(col.id, m)).map(m => {
                  const activo = nuevo?.inicio === m && (nuevo.profesionalId ?? nuevo.cabinaId) === col.id;
                  return <button key={`n${m}`} type="button" className={activo ? "trat-inicio activo" : "trat-inicio"} style={{ top: y(m) + 1, height: d.paso * PX - 2 }}
                    aria-label={`Nuevo turno a las ${hora(m)} ${col.tipo === "profesional" ? `con ${col.nombre}` : `en ${col.nombre}`}`}
                    onClick={() => abrirNuevo(m, col.tipo === "profesional" ? col.id : null, col.tipo === "cabina" ? col.id : null)}>+ {hora(m)}</button>;
                })}

                {col.turnos.map(t => {
                  const e = estadoVisible(t, d);
                  const n = lanes.carril.get(t) ?? 0;
                  const elegido = sel === t.reservaId;
                  const enMovimiento = moviendo?.reservaId === t.reservaId;
                  const detalle = d.vista === "profesional" ? nombreCabinas(t.recursoIds) : nombreProfesional(t.profesionalId);
                  return <button key={t.itemId} type="button" aria-pressed={elegido}
                    className={`trat-bloque e-${e.clase}${enMovimiento ? " moviendose" : ""}`}
                    style={{ top: y(t.inicio) + 1, height: Math.max((t.fin - t.inicio) * PX - 3, 22), left: `calc(${(100 / lanes.total) * n}% + 3px)`, width: `calc(${100 / lanes.total}% - 6px)` }}
                    aria-label={`${hora(t.inicio)} a ${hora(t.fin)}, ${t.cliente?.nombre ?? "Sin ficha"}, ${t.servicio}${detalle ? `, ${detalle}` : ""}, ${e.texto}`}
                    onClick={() => tocarTurno(t)}>
                    <span className="trat-bloque-estado">{hora(t.inicio)} · {e.texto}</span>
                    <span className="trat-bloque-cliente">{t.cliente?.nombre ?? "Sin ficha"}</span>
                    <span className="trat-bloque-detalle">{t.servicio}{detalle ? ` · ${detalle}` : ""}</span>
                  </button>;
                })}
              </div>;
            })}
            {d.ahora !== null && d.ahora >= inicioDia && d.ahora <= finDia && <div className="trat-ahora" style={{ top: y(d.ahora) }} aria-hidden><span>{hora(d.ahora)}</span></div>}
          </div>
        </div>
      </div>

      <aside className="trat-lateral" aria-label="Turno elegido y huecos">
        <div ref={panel} className={panelActivo ? "trat-panel abierto" : "trat-panel"}>
          {destino && moviendo ? panelDestino() : nuevo ? panelNuevo() : elegidos.length ? panelTurno() : <p className="trat-ayuda">
            {moviendo ? "Tocá en la grilla el horario resaltado al que querés mover el turno." : "Tocá un turno para ver sus acciones, o un horario libre para reservar."}
          </p>}
        </div>
        <section className="trat-huecos" aria-label="Huecos del día">
          <h2>Huecos {d.esHoy ? "de hoy" : "del día"}</h2>
          <p className="ayuda">De una hora o más, para ofrecer por teléfono.</p>
          {d.fecha < d.hoy ? <p className="ayuda">Es un día que ya pasó.</p> : !huecos.length ? <p className="ayuda">No quedan huecos de una hora.</p> : <ul>
            {huecos.map(h => <li key={`${h.profesionalId}${h.desde}`}><button type="button" className="secundario" disabled={!!moviendo} onClick={() => abrirNuevo(h.desde, h.profesionalId, null)}>
              <strong>{hora(h.desde)}–{hora(h.hasta)} · {h.nombre}</strong><small>Hueco de {duracion(h.hasta - h.desde)}</small>
            </button></li>)}
          </ul>}
        </section>
      </aside>
    </div>
  </div>;

  // ─── Paneles ──────────────────────────────────────────────────────────────
  function alerta() {
    return error ? <p className="alerta error" role="alert">{error}</p> : null;
  }

  function panelTurno() {
    const t = elegidos[0]!;
    const e = estadoVisible(t, d);
    const reservaId = t.reservaId;
    const empezado = elegidos.some(x => x.estado === "EN_SESION" || x.terminado);
    const sinEmpezar = t.estado === "CONFIRMADA" && !empezado;
    const pasado = d.fecha < d.hoy;
    const yaEsHora = pasado || (d.esHoy && d.ahora !== null && d.ahora >= t.inicio);
    const usaCabina = elegidos.some(x => (c.servicio.get(x.servicioId)?.recursos.length ?? 0) > 0);
    const terminan = [...new Set(elegidos.filter(x => x.estado === "EN_SESION").map(x => x.profesionalId))];
    const cliente = t.cliente;
    const empezarMover = (mismo: boolean) => {
      setSel(null); setError(null);
      setDestino(mismo ? { inicio: t.inicio, profesionalId: d.vista === "profesional" ? t.profesionalId : null, cabinaId: d.vista === "cabina" ? t.recursoIds[0] ?? null : null, elegida: 0, cabinas: {} } : null);
      irA({ mover: reservaId });
    };
    return <section aria-label="Turno elegido">
      <Cabecera cerrar={cerrar} titulo={cliente ? (d.puede.verClientes ? <Link href={`/clientes/${cliente.id}`}>{cliente.nombre}</Link> : cliente.nombre) : "Sin ficha"}
        sub={<span className={`tag trat-tag e-${e.clase}`}>{e.texto}</span>} />
      <ul className="trat-items">{elegidos.map(x => <li key={x.itemId}>
        <strong>{x.servicio}</strong>
        <span>{hora(x.inicio)}–{hora(x.fin)} · con {nombreProfesional(x.profesionalId)}{x.recursoIds.length ? ` · ${nombreCabinas(x.recursoIds)}` : ""}</span>
      </li>)}</ul>
      {(cliente?.telefono || t.online || (t.estado === "PENDIENTE_PAGO" && t.expira !== null)) && <p className="ayuda">
        {[cliente?.telefono && `Tel. ${cliente.telefono}`, t.online && "Reservó online", t.estado === "PENDIENTE_PAGO" && t.expira !== null && `Si no se acredita la seña, se libera a las ${hora(t.expira)}`].filter(Boolean).join(" · ")}
      </p>}
      {t.notas && <p className="trat-nota">{t.notas}</p>}
      {alerta()}
      {cancelando === reservaId ? <form className="trat-cancelar" onSubmit={ev => {
        ev.preventDefault();
        const motivo = String(new FormData(ev.currentTarget).get("motivo") ?? "");
        operar(() => accionCancelarTurno(reservaId, motivo), () => { setCancelando(null); setSel(null); });
      }}>
        <label>Motivo de la cancelación<input name="motivo" required maxLength={300} autoFocus autoComplete="off" /></label>
        <div className="en-linea">
          <button disabled={pendiente}>{pendiente ? "…" : "Cancelar turno"}</button>
          <button type="button" className="secundario" onClick={() => setCancelando(null)}>Volver</button>
        </div>
      </form> : <div className="acciones">
        {sinEmpezar && d.esHoy && <button type="button" disabled={pendiente} onClick={() => operar(() => accionEmpezo(reservaId))}>Empezó</button>}
        {d.esHoy && terminan.map(p => <button key={p} type="button" disabled={pendiente} onClick={() => operar(() => accionTerminoSesion(reservaId, p))}>{terminan.length > 1 ? `Terminó ${nombreProfesional(p)}` : "Terminó"}</button>)}
        {t.estado === "POR_COBRAR" && d.puede.cobrar && <Link className="boton" href={`/ventas/nueva?reserva=${reservaId}`}>Cobrar</Link>}
        {sinEmpezar && !pasado && <button type="button" className="secundario" disabled={pendiente} onClick={() => empezarMover(false)}>Mover</button>}
        {sinEmpezar && !pasado && usaCabina && <button type="button" className="secundario" disabled={pendiente} onClick={() => empezarMover(true)}>Cambiar cabina</button>}
        {sinEmpezar && yaEsHora && <button type="button" className="secundario" disabled={pendiente} onClick={() => { if (window.confirm(`¿${cliente?.nombre ?? "La clienta"} no vino? El turno queda ausente.`)) operar(() => accionAusenteTurno(reservaId)); }}>Ausente</button>}
        {(sinEmpezar || t.estado === "PENDIENTE_PAGO") && <button type="button" className="secundario peligro" disabled={pendiente} onClick={() => { setError(null); setCancelando(reservaId); }}>Cancelar turno</button>}
        {(t.estado === "COBRADA" || t.estado === "AUSENTE") && <p className="ayuda">Turno cerrado: no tiene acciones.</p>}
        {t.estado === "POR_COBRAR" && !d.puede.cobrar && <p className="ayuda">Terminó: queda por cobrar en caja.</p>}
      </div>}
      {sinEmpezar && !d.esHoy && !pasado && <p className="ayuda">«Empezó» se marca el día del turno.</p>}
    </section>;
  }

  function panelNuevo() {
    const n = nuevo!;
    const actualizar = (cambios: Partial<Nuevo>) => setNuevo(x => (x ? { ...x, ...cambios } : x));
    const desdeCabina = n.cabinaId ? c.recurso.get(n.cabinaId) : null;
    const servicios = n.profesionalId ? d.servicios.filter(s => c.profesional.get(n.profesionalId!)?.servicioIds.includes(s.id)) : d.servicios.filter(s => n.cabinaId && c.usaCabina(s.id, n.cabinaId));
    const puedenHacer = (servicioId: string) => n.profesionalId ? (c.entra(servicioId, n.profesionalId, n.inicio) ? [n.profesionalId] : [])
      : d.profesionales.filter(p => c.entra(servicioId, p.id, n.inicio, n.cabinaId ?? undefined)).map(p => p.id);
    const s = c.servicio.get(n.servicioId);
    const pros = s ? puedenHacer(s.id) : [];
    const profesionalId = n.profesionalId ?? (pros.includes(n.elegida) ? n.elegida : pros.length === 1 ? pros[0]! : "");
    const intervalo = s ? { desde: n.inicio, hasta: n.inicio + s.duracion } : null;
    const requisitos = s && intervalo ? c.cabinasLibres(s.id, intervalo) : [];
    // Recepción elige la cabina: si hay una sola posible (o se partió de una cabina), queda puesta y se muestra.
    const cabinaDe = (q: (typeof requisitos)[number]) => {
      const elegida = n.cabinas[q.tipoRecursoId];
      if (elegida && q.libres.includes(elegida)) return elegida;
      if (n.cabinaId && c.recurso.get(n.cabinaId)?.tipoRecursoId === q.tipoRecursoId && q.libres.includes(n.cabinaId)) return n.cabinaId;
      return q.libres.length === 1 ? q.libres[0]! : "";
    };
    const cabinas = requisitos.map(cabinaDe);
    const faltan = [!s && "tratamiento", s && !profesionalId && "profesional", requisitos.some((q, i) => !cabinas[i] || q.cantidad > 1) && "cabina", !n.clienta && "clienta"].filter(Boolean);
    return <section aria-label="Nuevo turno">
      <Cabecera cerrar={cerrar} titulo={`Nuevo turno · ${hora(n.inicio)}${n.profesionalId ? ` con ${nombreProfesional(n.profesionalId)}` : desdeCabina ? ` en ${desdeCabina.nombre}` : ""}`}
        sub={`${diaLargo(d.fecha)}${s ? ` · ${hora(n.inicio)} a ${hora(n.inicio + s.duracion)}` : ""}`} />
      {!servicios.length ? <p className="ayuda">{n.profesionalId ? "Esta profesional no tiene tratamientos habilitados en la sede." : "Ningún tratamiento usa esta cabina."}</p>
        : <Opciones etiqueta="Tratamiento" valor={n.servicioId} elegir={id => actualizar({ servicioId: id })}
          opciones={servicios.map(x => { const ok = puedenHacer(x.id).length > 0; return { id: x.id, texto: `${x.nombre} · ${x.duracion} min${ok ? "" : " · no entra"}`, no: !ok }; })} />}
      {s && !n.profesionalId && (pros.length ? <Opciones etiqueta="Profesional" valor={profesionalId} elegir={id => actualizar({ elegida: id })} opciones={pros.map(id => ({ id, texto: nombreProfesional(id) }))} />
        : <p className="ayuda">No hay profesionales libres para {s.nombre} a esa hora.</p>)}
      {requisitos.map((q, i) => <div key={q.tipoRecursoId}>
        {q.libres.length ? <Opciones etiqueta={`${d.recursos.find(r => r.tipoRecursoId === q.tipoRecursoId)?.tipo ?? "Cabina"}${q.libres.length === 1 ? " (la única libre)" : ""}`} valor={cabinas[i]!}
          elegir={id => actualizar({ cabinas: { ...n.cabinas, [q.tipoRecursoId]: id } })} opciones={q.libres.map(id => ({ id, texto: c.recurso.get(id)?.nombre ?? "Cabina" }))} />
          : <p className="alerta aviso">No queda ninguna {d.recursos.find(r => r.tipoRecursoId === q.tipoRecursoId)?.tipo.toLowerCase() ?? "cabina"} libre de {hora(n.inicio)} a {hora(n.inicio + s!.duracion)}.</p>}
        {q.cantidad > 1 && <p className="ayuda">Este tratamiento usa {q.cantidad} unidades: reservalo desde la agenda.</p>}
      </div>)}
      <ClientaCampo clienta={n.clienta} elegir={clienta => actualizar({ clienta })} puedeCrear={d.puede.crearClientes} />
      <label className="trat-campo">Nota (opcional)<input value={n.notas} maxLength={1000} onChange={e => actualizar({ notas: e.target.value })} autoComplete="off" /></label>
      {alerta()}
      <div className="en-linea">
        <button type="button" disabled={pendiente || faltan.length > 0} onClick={() => operar(() => accionReservarTurno({
          fecha: d.fecha, minutos: n.inicio, servicioId: s!.id, profesionalId, recursoIds: cabinas, clienteId: n.clienta!.id, notas: n.notas,
        }), r => { setNuevo(null); setSel(r.dato ?? null); setMensaje(`Turno reservado: ${n.clienta!.nombre}, ${s!.nombre} a las ${hora(n.inicio)} con ${nombreProfesional(profesionalId)}${cabinas.length ? ` en ${nombreCabinas(cabinas)}` : ""}.`); })}>{pendiente ? "…" : "Reservar"}</button>
        <button type="button" className="secundario" onClick={cerrar}>Descartar</button>
      </div>
      {faltan.length > 0 && <p className="ayuda">Falta elegir: {faltan.join(", ")}.</p>}
    </section>;
  }

  function panelDestino() {
    const m = moviendo!, dst = destino!;
    const actualizar = (cambios: Partial<Destino>) => setDestino(x => (x ? { ...x, ...cambios } : x));
    if (!destinos) return <section aria-label="Mover turno"><Cabecera cerrar={cerrar} titulo={`Mover a las ${hora(dst.inicio)}`} />{m.error ? <p className="alerta error">{m.error}</p> : <p className="ayuda">Buscando horarios y cabinas libres…</p>}</section>;
    const opciones = destinos.flatMap(x => {
      const i = x.inicios.find(y => y.inicio === dst.inicio);
      if (!i) return [];
      if (dst.profesionalId && x.profesionalIds[0] !== dst.profesionalId) return [];
      if (dst.cabinaId && !i.items.some(it => it.recursos.some(q => q.libres.includes(dst.cabinaId!)))) return [];
      return [{ profesionalIds: x.profesionalIds, ...i }];
    });
    const op = opciones[Math.min(dst.elegida, opciones.length - 1)];
    if (!op) return <section aria-label="Mover turno"><Cabecera cerrar={cerrar} titulo={`Mover a las ${hora(dst.inicio)}`} /><p className="alerta aviso">Ese horario ya no está libre. Elegí otro resaltado.</p></section>;
    const actuales = moviendoAca;
    // Una cabina por ítem y tipo: la que eligió recepción, la de la columna, la que ya tenía o la única libre.
    const cabinaDe = (item: number, q: { tipoRecursoId: string; libres: string[] }) => {
      const clave = `${item}:${q.tipoRecursoId}`;
      const candidatas = [dst.cabinas[clave], dst.cabinaId, ...(actuales[item]?.recursoIds ?? [])].filter((x): x is string => !!x);
      return candidatas.find(x => q.libres.includes(x)) ?? (q.libres.length === 1 ? q.libres[0]! : "");
    };
    const elegidas = op.items.map((it, i) => it.recursos.map(q => cabinaDe(i, q)));
    const completo = op.items.every((it, i) => it.recursos.every((q, k) => q.cantidad === 1 && elegidas[i]![k]));
    const nombreServicio = (i: number) => actuales[i]?.servicio ?? m.servicios.split(" + ")[i] ?? "Servicio";
    const mismo = actuales.length > 0 && actuales[0]!.inicio === dst.inicio && actuales.every((t, i) => t.profesionalId === op.profesionalIds[i]);
    return <section aria-label="Mover turno">
      <Cabecera cerrar={cerrar} titulo={mismo ? "Cambiar la cabina" : `Mover a las ${hora(op.inicio)}`} sub={`${m.cliente} · ${m.servicios} · ${diaLargo(d.fecha)}, ${hora(op.inicio)} a ${hora(op.fin)}`} />
      {opciones.length > 1 ? <Opciones etiqueta="Profesional" valor={String(opciones.indexOf(op))} elegir={id => actualizar({ elegida: Number(id) })}
        opciones={opciones.map((o, i) => ({ id: String(i), texto: [...new Set(o.profesionalIds)].map(nombreProfesional).join(" y ") }))} />
        : <p className="trat-dato">Con <strong>{[...new Set(op.profesionalIds)].map(nombreProfesional).join(" y ")}</strong></p>}
      {op.items.map((it, i) => it.recursos.map((q, k) => <div key={`${i}${q.tipoRecursoId}`}>
        <Opciones etiqueta={`${op.items.length > 1 ? `${nombreServicio(i)}: ` : ""}${d.recursos.find(r => r.tipoRecursoId === q.tipoRecursoId)?.tipo ?? "Cabina"}${q.libres.length === 1 ? " (la única libre)" : ""}`}
          valor={elegidas[i]![k]!} elegir={id => actualizar({ cabinas: { ...dst.cabinas, [`${i}:${q.tipoRecursoId}`]: id } })}
          opciones={q.libres.map(id => ({ id, texto: `${c.recurso.get(id)?.nombre ?? "Cabina"}${actuales[i]?.recursoIds.includes(id) ? " (la actual)" : ""}` }))} />
        {q.cantidad > 1 && <p className="ayuda">Usa {q.cantidad} unidades: movelo desde la agenda.</p>}
      </div>))}
      {alerta()}
      <div className="en-linea">
        <button type="button" disabled={pendiente || !completo} onClick={() => operar(() => accionMoverTurno(m.reservaId, {
          fecha: d.fecha, minutos: op.inicio, profesionales: op.profesionalIds, recursos: elegidas.map(xs => (xs.length ? xs : null)),
        }), r => {
          setDestino(null); setSel(r.dato ?? null);
          setMensaje(`${mismo ? "Cabina cambiada" : "Turno movido"}: ${m.cliente}, ${diaLargo(d.fecha)} a las ${hora(op.inicio)} con ${[...new Set(op.profesionalIds)].map(nombreProfesional).join(" y ")}${elegidas.flat().length ? ` en ${nombreCabinas(elegidas.flat())}` : ""}.`);
          irA({ mover: null });
        })}>{pendiente ? "…" : mismo ? "Cambiar cabina" : "Mover acá"}</button>
        <button type="button" className="secundario" onClick={() => setDestino(null)}>Elegir otro horario</button>
      </div>
    </section>;
  }
}

function Cabecera({ titulo, sub, cerrar }: { titulo: React.ReactNode; sub?: React.ReactNode; cerrar: () => void }) {
  return <div className="trat-panel-cabecera">
    <div><h2 tabIndex={-1}>{titulo}</h2>{sub && <p className="ayuda">{sub}</p>}</div>
    <button type="button" className="secundario trat-cerrar" onClick={cerrar} aria-label="Cerrar panel">×</button>
  </div>;
}

/** Opciones de a un toque (tratamiento, profesional, cabina): botones con aria-pressed. */
function Opciones({ etiqueta, opciones, valor, elegir }: { etiqueta: string; opciones: { id: string; texto: string; no?: boolean }[]; valor: string; elegir: (id: string) => void }) {
  return <fieldset className="trat-opciones">
    <legend>{etiqueta}</legend>
    {opciones.map(o => <button key={o.id} type="button" className="trat-chip" aria-pressed={valor === o.id} disabled={o.no} onClick={() => elegir(o.id)}>{o.texto}</button>)}
  </fieldset>;
}

/**
 * Clienta del turno: buscar una ficha mientras se escribe, o crearla con nombre y teléfono. Tiene su
 * propio estado, así lo escrito no se pierde cuando la grilla se actualiza.
 */
function ClientaCampo({ clienta, elegir, puedeCrear }: { clienta: Clienta | null; elegir: (c: Clienta | null) => void; puedeCrear: boolean }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<{ q: string; lista: Clienta[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ficha, setFicha] = useState<{ nombre: string; telefono: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const ultimo = useRef(0);
  const q = texto.trim();
  useEffect(() => {
    if (q.length < 2) return;
    const n = ++ultimo.current;
    const id = setTimeout(async () => {
      const r = await accionBuscarClientas(q);
      if (n !== ultimo.current) return;
      setError(r.error ?? null);
      setResultados({ q, lista: r.dato ?? [] });
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  const lista = q.length >= 2 && resultados?.q === q ? resultados.lista : null;

  if (clienta) return <div className="trat-clienta">
    <p className="trat-etiqueta">Clienta</p>
    <div className="cliente-elegido"><div><strong>{clienta.nombre}</strong>{clienta.telefono && <small>{clienta.telefono}</small>}</div>
      <button type="button" className="secundario" onClick={() => elegir(null)}>Cambiar</button></div>
  </div>;
  return <div className="trat-clienta">
    <label className="trat-campo">Clienta<input type="search" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Nombre o teléfono" autoComplete="off" maxLength={80} /></label>
    {error && <p className="alerta error" role="alert">{error}</p>}
    {lista && (lista.length ? <ul className="lista candidatos" aria-label="Fichas encontradas">{lista.map(x => <li key={x.id}>
      <button type="button" className="trat-candidata" onClick={() => elegir(x)}><strong>{x.nombre}</strong>{x.telefono && <small>{x.telefono}</small>}</button>
    </li>)}</ul> : <p className="ayuda">No hay fichas con ese nombre o teléfono.</p>)}
    {puedeCrear && (ficha ? <form className="trat-ficha" onSubmit={e => {
      e.preventDefault();
      setError(null);
      iniciar(async () => {
        const r = await accionCrearClienta(ficha.nombre, ficha.telefono);
        if (r.error || !r.dato) setError(r.error ?? "No se pudo crear la ficha");
        else { setFicha(null); setTexto(""); elegir(r.dato); }
      });
    }}>
      <p className="trat-etiqueta">Ficha nueva</p>
      <label className="trat-campo">Nombre<input value={ficha.nombre} onChange={e => setFicha({ ...ficha, nombre: e.target.value })} required maxLength={80} autoComplete="off" /></label>
      <label className="trat-campo">Teléfono<input value={ficha.telefono} onChange={e => setFicha({ ...ficha, telefono: e.target.value })} required inputMode="tel" maxLength={40} autoComplete="off" /></label>
      <div className="en-linea">
        <button disabled={pendiente}>{pendiente ? "…" : "Crear y elegir"}</button>
        <button type="button" className="secundario" onClick={() => setFicha(null)}>Volver</button>
      </div>
    </form> : <button type="button" className="secundario" onClick={() => setFicha(/^[\d\s+()-]+$/.test(q) ? { nombre: "", telefono: q } : { nombre: q, telefono: "" })}>+ Ficha nueva</button>)}
  </div>;
}
