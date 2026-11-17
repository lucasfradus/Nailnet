import { useEffect, useState, type MouseEvent } from "react";
import { api, useCarga } from "./api";
import { fechaEn } from "./formato";
import { entradaHistorial, leerEntrada, NOMBRES, ORDEN, pasoVisible, rutaDeSede, slugDeRuta, type NombrePaso, type Seleccion } from "./navegacion";
import { PasoDatos, PasoHorario, PasoProfesional, PasoSede, PasoServicio, Resumen, type Contacto } from "./pasos";
import { EstadoReserva, guardarReserva, leerReservaGuardada, type ReservaGuardada } from "./reserva";

const CONTACTO_VACIO: Contacto = { nombre: "", apellido: "", email: "", telefono: "" };
const TITULO = "Sicurella · Reservas";

/** Recorrido P01: sede → servicio → profesional → horario → datos → estado de la reserva. */
export function App() {
  const [reserva, setReserva] = useState<ReservaGuardada | null>(leerReservaGuardada);
  const [inicial] = useState(() => leerEntrada(window.history.state));
  const [paso, setPaso] = useState<NombrePaso>(inicial?.paso ?? "sede");
  const [sel, setSel] = useState<Seleccion>(inicial?.sel ?? {});
  const [contacto, setContacto] = useState(CONTACTO_VACIO);
  const [aviso, setAviso] = useState<string | null>(null);
  // Sede pedida en el link (`/lomada`). Se olvida al elegir otra a mano.
  const [slugPedido, setSlugPedido] = useState(() => slugDeRuta(window.location.pathname));
  const sedes = useCarga(s => api.sedes(s), []);

  const primerPaso: NombrePaso = sel.sedeFija ? "servicio" : "sede";
  const visible = pasoVisible(paso, sel, primerPaso);
  const posicion = (p: NombrePaso) => ORDEN.indexOf(p) - ORDEN.indexOf(primerPaso);

  /**
   * La entrada actual del historial siempre refleja paso y selección (así sobreviven a una recarga), y la ruta,
   * la sede elegida: un link copiado en cualquier paso abre esa sede. Mientras cargan las sedes se respeta la
   * ruta pedida; la consulta (vuelta de Mercado Pago) la limpia `EstadoReserva`.
   */
  const sedesListas = !!sedes.datos;
  useEffect(() => {
    const ruta = sel.sede || sedesListas ? rutaDeSede(sel.sede) : window.location.pathname;
    window.history.replaceState(entradaHistorial(paso, sel), "", ruta + window.location.search + window.location.hash);
  }, [paso, sel, sedesListas]);
  useEffect(() => { document.title = sel.sede ? `Reservá en ${sel.sede.nombre} · Sicurella` : TITULO; }, [sel.sede]);
  // Atrás/adelante del navegador: cambia el paso y conserva lo elegido, para mostrarlo marcado al volver.
  useEffect(() => {
    const alNavegar = (e: PopStateEvent) => setPaso(leerEntrada(e.state)?.paso ?? "sede");
    window.addEventListener("popstate", alNavegar);
    return () => window.removeEventListener("popstate", alNavegar);
  }, []);
  /**
   * Sede fija: la única de la organización, o la del link. No hay nada que elegir: se reemplaza la entrada (no se
   * apila) para que «atrás» no vuelva a la lista de sedes.
   */
  const deRuta = slugPedido ? sedes.datos?.find(s => s.slug === slugPedido) : undefined;
  const fija = sedes.datos?.length === 1 ? sedes.datos[0] : deRuta;
  const fijando = !!fija && !sel.sede;
  useEffect(() => {
    if (fija && !sel.sede) { setSel({ sede: fija, sedeFija: true }); setPaso("servicio"); }
  }, [fija, sel.sede]);
  const rutaDesconocida = !!slugPedido && !!sedes.datos && sedes.datos.length > 1 && !deRuta;

  /**
   * Única forma de moverse entre pasos. Hacia adelante apila una entrada por paso; hacia atrás retrocede en el
   * historial (el paso lo fija `popstate`), así cada entrada sigue correspondiendo a un paso.
   */
  function irA(destino: NombrePaso, nueva: Seleccion = sel) {
    setSel(nueva); setAviso(null);
    const desde = posicion(paso), hasta = posicion(destino);
    if (hasta > desde) {
      for (let i = desde + 1; i <= hasta; i++) window.history.pushState(entradaHistorial(ORDEN[ORDEN.indexOf(primerPaso) + i]!, nueva), "");
      setPaso(destino);
    } else if (hasta < desde) window.history.go(hasta - desde);
  }
  const volver = () => irA(ORDEN[ORDEN.indexOf(visible) - 1]!);

  function terminar(nueva: ReservaGuardada | null) {
    guardarReserva(nueva); setReserva(nueva);
  }
  /** Otra reserva: la actual, si sigue en pie, queda a mano en el encabezado («Ver mi reserva»). */
  function reiniciar(descartar: boolean) {
    terminar(descartar || !reserva ? null : { ...reserva, oculta: true });
    irA(primerPaso, sel.sedeFija ? { sede: sel.sede, sedeFija: true } : {});
  }
  const verReserva = () => { if (reserva) terminar({ ...reserva, oculta: false }); };
  const viendoReserva = !!reserva && !reserva.oculta;
  /** El logo vuelve al primer paso conservando lo elegido (como «atrás» varias veces). */
  function alInicio(e: MouseEvent) {
    e.preventDefault();
    if (!viendoReserva) irA(primerPaso);
  }

  // Repetir una elección ya hecha conserva lo elegido después; cambiarla lo descarta.
  const { sede, servicio, profesional, turno } = sel;
  let contenido;
  if (reserva && viendoReserva) {
    // Tras una reserva vencida se puede volver a los horarios con la misma elección, si sigue en memoria.
    const puedeVolver = !!(sede && servicio && profesional !== undefined);
    contenido = <EstadoReserva reserva={reserva} onNueva={reiniciar} onOtroHorario={puedeVolver ? () => { terminar(null); irA("horario", { ...sel, turno: undefined }); } : null} />;
  } else if (fijando) {
    contenido = <p className="cargando" role="status">Cargando…</p>;
  } else if (visible === "sede" || !sede) {
    contenido = <PasoSede carga={sedes} elegida={sede?.id} aviso={rutaDesconocida ? `No encontramos la sede «${slugPedido}». Elegí una de la lista.` : null}
      onElegir={s => { setSlugPedido(null); irA("servicio", s.id === sede?.id ? sel : { sede: s, sedeFija: false }); }} />;
  } else if (visible === "servicio" || !servicio) {
    contenido = <PasoServicio sede={sede} elegido={servicio?.id} onElegir={s => irA("profesional", s.id === servicio?.id ? sel : { ...sel, servicio: s, profesional: undefined, turno: undefined })} />;
  } else if (visible === "profesional" || profesional === undefined) {
    contenido = <PasoProfesional sede={sede} servicio={servicio} elegido={profesional}
      onElegir={p => irA("horario", p?.id === profesional?.id && profesional !== undefined ? sel : { ...sel, profesional: p, turno: undefined })} />;
  } else if (visible === "horario" || !turno) {
    contenido = <PasoHorario sede={sede} servicio={servicio} profesional={profesional} fecha={sel.fecha ?? fechaEn(sede.timezone)} fechaElegida={!!sel.fecha} elegido={turno} aviso={aviso}
      onFecha={fecha => setSel(s => ({ ...s, fecha }))} onElegir={t => irA("datos", { ...sel, turno: t })} />;
  } else {
    contenido = <PasoDatos sede={sede} servicio={servicio} profesional={profesional} turno={turno} contacto={contacto} onContacto={setContacto}
      onReservada={r => {
        terminar({ token: r.token, timezone: sede.timezone });
        // Con la reserva hecha, los pasos del historial ya no sirven: se vuelve al primero para que «atrás» no reabra el formulario.
        irA(primerPaso);
      }}
      onNoDisponible={mensaje => { irA("horario", { ...sel, turno: undefined }); setAviso(mensaje); }} />;
  }

  // El contador aparece cuando ya se sabe cuántos pasos hay (depende de si la sede es fija).
  const conBarra = !viendoReserva && !fijando && (!!sede || (sedes.datos?.length ?? 0) > 1);
  const numero = posicion(visible) + 1, total = ORDEN.length - ORDEN.indexOf(primerPaso);
  // El resumen muestra solo lo elegido en pasos anteriores al visible.
  const antes = (p: NombrePaso) => ORDEN.indexOf(p) < ORDEN.indexOf(visible);
  return <main>
    <header>
      <a className="marca" href={rutaDeSede(sel.sedeFija ? sede : undefined)} onClick={alInicio} aria-label="Sicurella, ir al inicio">
        <img src="/sicurella-logo-teal.svg" alt="" width={153} height={28} />
      </a>
      {reserva?.oculta && <button type="button" className="mi-reserva" onClick={verReserva}>Ver mi reserva</button>}
    </header>
    {conBarra && <nav className="barra" aria-label="Pasos de la reserva">
      {visible !== primerPaso && <button type="button" className="volver" onClick={volver} aria-label="Volver al paso anterior">←</button>}
      <p className="etapa"><small>Paso {numero} de {total}</small><strong>{NOMBRES[visible]}</strong></p>
      <span className="segmentos" aria-hidden="true">{Array.from({ length: total }, (_, i) => <span key={i} className={i < numero ? "hecho" : undefined} />)}</span>
    </nav>}
    {!viendoReserva && !fijando && visible === primerPaso && <div className="portada">
      <img src="/portada.webp" alt="" width={1600} height={800} />
      <div><p className="etiqueta">{sede && sel.sedeFija ? `Sicurella ${sede.nombre}` : "Tu momento, a tu tiempo"}</p><p className="lema">Reservá tu turno en un minuto.</p></div>
    </div>}
    {!viendoReserva && <Resumen sede={antes("sede") ? sede : undefined} servicio={antes("servicio") ? servicio : undefined}
      profesional={antes("profesional") ? profesional : undefined} turno={antes("horario") ? turno : undefined}
      cambiarSede={!sel.sedeFija} onCambiar={p => irA(p)} />}
    {contenido}
    <footer>Reservá online en pocos pasos. Los horarios se muestran en la hora de la sede.</footer>
  </main>;
}
