import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { validarReservaPublica, type ProfesionalPublico, type ReservaPublicaRespuesta, type SedePublica, type ServicioPublico, type TurnoPublico } from "@nailnet/contracts/publico";
import { api, ErrorApi, urlImagen, useCarga, type Carga } from "./api";
import { dinero, duracion, fechaEn, fechaLarga, hora, partesDia, sumarDias } from "./formato";

/** Días que ofrece el selector. El horizonte real lo aplica el backend por sede: un día fuera de él viene sin turnos. */
const DIAS_VISIBLES = 14;

export function Paso({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  const encabezado = useRef<HTMLHeadingElement>(null);
  // Al cambiar de paso, el foco va al título para lectores de pantalla y teclado.
  useEffect(() => { encabezado.current?.focus(); }, [titulo]);
  return <section className="paso"><h2 tabIndex={-1} ref={encabezado}>{titulo}</h2>{ayuda && <p className="ayuda">{ayuda}</p>}{children}</section>;
}

/** Estados de carga y error comunes; `vacio` se muestra si la lista llegó sin elementos. */
function Cargado<T>({ carga, vacio, children }: { carga: Carga<T[]>; vacio: string; children: (datos: T[]) => ReactNode }) {
  if (carga.cargando) return <p className="cargando" role="status">Cargando…</p>;
  if (carga.error) return <div className="error" role="alert"><p>{carga.error.message}</p><button type="button" className="secundario" onClick={carga.recargar}>Reintentar</button></div>;
  if (!carga.datos?.length) return <p className="vacio">{vacio}</p>;
  return <>{children(carga.datos)}</>;
}

/**
 * Imagen del catálogo con reemplazo si no hay o no carga: un fondo con la inicial, para que la grilla
 * no quede con huecos. Decorativa (alt vacío): el nombre siempre está escrito al lado.
 */
export function Foto({ ruta, nombre, className }: { ruta: string | null; nombre: string; className: string }) {
  const [fallo, setFallo] = useState(false);
  const src = urlImagen(ruta);
  if (!src || fallo) return <span className={`${className} sin-foto`} aria-hidden="true">{nombre.trim()[0]?.toUpperCase()}</span>;
  return <img src={src} alt="" className={className} loading="lazy" decoding="async" onError={() => setFallo(true)} />;
}

export function PasoSede({ onElegir }: { onElegir: (sede: SedePublica, unica: boolean) => void }) {
  const carga = useCarga(s => api.sedes(s), []);
  const sedes = carga.datos;
  useEffect(() => { if (sedes?.length === 1) onElegir(sedes[0]!, true); }, [sedes, onElegir]);
  return <>
    <div className="portada">
      <img src="/portada.webp" alt="" width={1600} height={800} />
      <div><p className="etiqueta">Tu momento, a tu tiempo</p><p className="lema">Reservá tu turno en un minuto.</p></div>
    </div>
    <Paso titulo="¿En qué sede?">
      <Cargado carga={carga} vacio="Por ahora no hay sedes con reservas online.">
        {lista => <ul className="opciones">{lista.map(s => <li key={s.id}><button type="button" className="opcion" onClick={() => onElegir(s, false)}><strong>{s.nombre}</strong><span className="flecha" aria-hidden="true">→</span></button></li>)}</ul>}
      </Cargado>
    </Paso>
  </>;
}

export function PasoServicio({ sede, onElegir }: { sede: SedePublica; onElegir: (servicio: ServicioPublico) => void }) {
  const carga = useCarga(s => api.servicios(sede.id, s), [sede.id]);
  return <Paso titulo="Elegí el servicio" ayuda="La seña se descuenta del precio y se abona al reservar.">
    <Cargado carga={carga} vacio="Esta sede todavía no tiene servicios para reservar online.">
      {lista => [...new Set(lista.map(s => s.categoria))].map(categoria => <div key={categoria} className="grupo">
        <h3>{categoria}</h3>
        <ul className="servicios">{lista.filter(s => s.categoria === categoria).map(s => <li key={s.id}>
          <button type="button" className="servicio" onClick={() => onElegir(s)}>
            <Foto ruta={s.imagenUrl} nombre={s.nombre} className="servicio-foto" />
            <span className="servicio-cuerpo">
              <strong>{s.nombre}</strong>
              {s.descripcion && <span className="servicio-descripcion">{s.descripcion}</span>}
              <span className="servicio-datos"><span>{duracion(s.duracionMinutos)}</span><span className="precio">{dinero(s.precio)}</span></span>
              <small>Seña {dinero(s.sena)}</small>
            </span>
          </button>
        </li>)}</ul>
      </div>)}
    </Cargado>
  </Paso>;
}

export function PasoProfesional({ sede, servicio, onElegir }: { sede: SedePublica; servicio: ServicioPublico; onElegir: (profesional: ProfesionalPublico | null) => void }) {
  const carga = useCarga(s => api.profesionales(sede.id, servicio.id, s), [sede.id, servicio.id]);
  return <Paso titulo="¿Con quién?" ayuda="Si te da lo mismo, te mostramos todos los horarios disponibles.">
    <Cargado carga={carga} vacio="No hay profesionales disponibles para este servicio en esta sede.">
      {lista => <ul className="profesionales">
        <li><button type="button" className="profesional cualquiera" onClick={() => onElegir(null)}>
          <span className="grupo-fotos" aria-hidden="true">{lista.slice(0, 3).map(p => <Foto key={p.id} ruta={p.fotoUrl} nombre={p.nombre} className="avatar" />)}</span>
          <span><strong>Cualquier profesional</strong><small>Más horarios disponibles</small></span>
        </button></li>
        {lista.map(p => <li key={p.id}><button type="button" className="profesional" onClick={() => onElegir(p)}>
          <Foto ruta={p.fotoUrl} nombre={p.nombre} className="avatar grande" />
          <strong>{p.nombre}</strong>
        </button></li>)}
      </ul>}
    </Cargado>
  </Paso>;
}

export function PasoHorario({ sede, servicio, profesional, fecha, aviso, onFecha, onElegir }: {
  sede: SedePublica; servicio: ServicioPublico; profesional: ProfesionalPublico | null; fecha: string; aviso: string | null;
  onFecha: (fecha: string) => void; onElegir: (turno: TurnoPublico) => void;
}) {
  const hoy = fechaEn(sede.timezone);
  const dias = Array.from({ length: DIAS_VISIBLES }, (_, i) => sumarDias(hoy, i));
  const carga = useCarga(s => api.disponibilidad(sede.id, fecha, servicio.id, profesional?.id ?? null, s), [sede.id, servicio.id, profesional?.id, fecha]);
  return <Paso titulo="Elegí día y horario">
    {aviso && <p className="error" role="alert">{aviso}</p>}
    <div className="dias" role="group" aria-label="Día">
      {dias.map(d => { const p = partesDia(d); return <button type="button" key={d} className="dia" aria-pressed={d === fecha} onClick={() => onFecha(d)}><small>{p.semana}</small><strong>{p.numero}</strong><small>{p.mes}</small></button>; })}
    </div>
    <Cargado carga={carga} vacio="No quedan horarios este día. Probá con otro.">
      {turnos => <ul className="horarios" aria-label={`Horarios del ${partesDia(fecha).semana} ${partesDia(fecha).numero}`}>
        {turnos.map(t => <li key={t.inicio}><button type="button" className="horario" onClick={() => onElegir(t)}>{hora(t.inicio, sede.timezone)}</button></li>)}
      </ul>}
    </Cargado>
  </Paso>;
}

export type Contacto = { nombre: string; apellido: string; email: string; telefono: string };

/**
 * Datos del invitado y envío. La Idempotency-Key se conserva mientras el contenido no cambie: reintentar
 * tras un corte de red no duplica la reserva. Si el contenido cambia, es un intento nuevo con otra clave.
 */
export function PasoDatos({ sede, servicio, profesional, turno, contacto, onContacto, onReservada, onNoDisponible }: {
  sede: SedePublica; servicio: ServicioPublico; profesional: ProfesionalPublico | null; turno: TurnoPublico;
  contacto: Contacto; onContacto: (c: Contacto) => void;
  onReservada: (r: ReservaPublicaRespuesta) => void; onNoDisponible: (mensaje: string) => void;
}) {
  const terminos = useCarga(s => api.terminos(s), []);
  const [acepta, setAcepta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intento = useRef<{ cuerpo: string; clave: string } | null>(null);
  const campo = (k: keyof Contacto) => ({ value: contacto[k], onChange: (e: { target: { value: string } }) => onContacto({ ...contacto, [k]: e.target.value }) });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    // Con «cualquiera» no se fija el profesional: el backend vuelve a asignar uno libre al tomar el turno.
    const validacion = validarReservaPublica({
      sedeId: sede.id, fecha: fechaEn(sede.timezone, turno.inicio), inicio: turno.inicio,
      items: [{ servicioId: servicio.id, profesionalId: profesional?.id ?? null }],
      cliente: { nombre: contacto.nombre, apellido: contacto.apellido || null, email: contacto.email, telefono: contacto.telefono },
      aceptaTerminos: acepta,
    });
    if (!validacion.ok) { setError(validacion.mensaje); return; }
    const cuerpo = JSON.stringify(validacion.valor);
    if (intento.current?.cuerpo !== cuerpo) intento.current = { cuerpo, clave: crypto.randomUUID() };
    setEnviando(true); setError(null);
    try {
      onReservada(await api.reservar(validacion.valor, intento.current.clave));
    } catch (err) {
      const e = err instanceof ErrorApi ? err : new ErrorApi(0, "INTERNO", "Error inesperado. Probá de nuevo.");
      if (e.codigo === "NO_DISPONIBLE") { onNoDisponible("Ese horario se acaba de ocupar. Elegí otro, por favor."); return; }
      // 429 y errores internos liberan la clave en el backend; 422 queda recordado: el próximo intento usa otra.
      if (e.codigo === "INVALIDO") intento.current = null;
      setError(e.codigo === "CONFLICTO_IDEMPOTENCIA" ? "Ya estamos procesando tu reserva. Esperá unos segundos y probá de nuevo." : e.message);
    } finally { setEnviando(false); }
  }

  return <Paso titulo="Tus datos" ayuda="Los usamos solo para gestionar el turno y avisarte cambios.">
    <form className="datos" onSubmit={enviar} noValidate>
      <label>Nombre<input required maxLength={80} autoComplete="given-name" {...campo("nombre")} /></label>
      <label>Apellido<input maxLength={80} autoComplete="family-name" {...campo("apellido")} /></label>
      <label>Email<input required type="email" maxLength={254} autoComplete="email" inputMode="email" {...campo("email")} /></label>
      <label>Teléfono<input required type="tel" maxLength={30} autoComplete="tel" inputMode="tel" {...campo("telefono")} /></label>
      {terminos.error && <p className="error" role="alert">No pudimos cargar los términos. <button type="button" className="enlace" onClick={terminos.recargar}>Reintentar</button></p>}
      {terminos.datos?.map(t => <details key={t.clave} className="terminos"><summary>{t.titulo}</summary><p>{t.texto}</p></details>)}
      <label className="check"><input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)} disabled={!terminos.datos} />
        <span>Leí y acepto {terminos.datos?.length ? "los términos de la reserva" : "las condiciones de la reserva"}.</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="principal" disabled={enviando || !terminos.datos}>{enviando ? "Reservando…" : `Reservar · seña ${dinero(servicio.sena)}`}</button>
    </form>
  </Paso>;
}

export function Resumen({ sede, servicio, profesional, turno }: { sede?: SedePublica; servicio?: ServicioPublico; profesional?: ProfesionalPublico | null; turno?: TurnoPublico }) {
  if (!sede) return null;
  return <div className={servicio ? "resumen con-foto" : "resumen"}>
    {servicio && <Foto ruta={servicio.imagenUrl} nombre={servicio.nombre} className="resumen-foto" />}
    <dl>
      <div><dt>Sede</dt><dd>{sede.nombre}</dd></div>
      {servicio && <div><dt>Servicio</dt><dd>{servicio.nombre} · {dinero(servicio.precio)}</dd></div>}
      {profesional !== undefined && <div><dt>Profesional</dt><dd className="con-avatar">{profesional && <Foto ruta={profesional.fotoUrl} nombre={profesional.nombre} className="avatar mini" />}{profesional?.nombre ?? "Cualquiera"}</dd></div>}
      {turno && <div><dt>Turno</dt><dd>{fechaLarga(turno.inicio, sede.timezone)}, {hora(turno.inicio, sede.timezone)} h</dd></div>}
    </dl>
  </div>;
}
