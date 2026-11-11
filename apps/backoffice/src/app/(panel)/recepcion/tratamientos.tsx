import Link from "next/link";
import { Formulario } from "@/components/formulario";
import { UNIVERSO_SLUG } from "@/lib/etiquetas";
import { accionLlegada, accionSalida, accionSeFue, accionTermino } from "./acciones";
import { NoLlegaron, NombreClienta, PorCobrar, repartir, type Tablero } from "./comun";

/** «Llegó» vale desde una hora antes del turno (lo valida `marcarLlegada`): antes no se ofrece. */
const ANTICIPO_LLEGADA_MS = 3_600_000;

/**
 * Pestaña Tratamientos del tablero de recepción (doc 31, etapa 1). Trabaja con turno previo, así que pone
 * primero los turnos de hoy y no anota en espera. Aislada a propósito: la etapa 4 la reemplaza por la
 * grilla del día.
 */
export function TableroTratamientos({ tablero, ahora, sedeId, servicioId, verVentas }: { tablero: Tablero; ahora: Date; sedeId: string; servicioId?: string; verVentas: boolean }) {
  const tz = tablero.timezone;
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const universo = tablero.universo;
  const base = universo ? `/recepcion?u=${UNIVERSO_SLUG[universo]}` : "/recepcion";
  const servicio = tablero.servicios.find(s => s.id === servicioId) ?? null;
  const { presentes, ausentes, enOtraSede, libres, atendiendo } = repartir(tablero);
  // Con un servicio elegido: solo las que lo hacen, y si llega a terminarlo antes de su próximo turno.
  const aptas = (ps: typeof presentes) => servicio ? ps.filter(p => p.servicioIds.includes(servicio.id)) : ps;
  const entra = (p: (typeof presentes)[number]) => !servicio || !p.proximo || ahora.getTime() + servicio.duracionMinutos * 60_000 <= p.proximo.ocupaDesde.getTime();
  const ordenLibres = aptas(libres).sort((a, b) => Number(entra(b)) - Number(entra(a)));
  const ordenAtendiendo = aptas(atendiendo).sort((a, b) => a.atencion!.finEstimado.getTime() - b.atencion!.finEstimado.getTime());
  const despachar = (profesionalId: string) => `/agenda/ahora?${new URLSearchParams({ volver: "recepcion", profesional: profesionalId, ...(servicio ? { servicio: servicio.id } : {}) })}`;

  const seccionEspera = tablero.esperas.length > 0 && <>
    <h2 className="subtitulo">En espera</h2>
    <div className="tabla">{tablero.esperas.map(e => {
      // Quiénes podrían atenderla ahora: libres en el local que hacen el primer servicio que pidió.
      const pueden = libres.filter(p => p.servicioIds.includes(e.servicioIds[0]!));
      const pedida = e.profesionalId ? tablero.profesionales.find(p => p.id === e.profesionalId) : null;
      const sugerida = pedida && pueden.some(p => p.id === pedida.id) ? pedida : pueden[0];
      const minutos = Math.max(0, Math.round((ahora.getTime() - e.llegada.getTime()) / 60_000));
      const atender = `/agenda/ahora?${new URLSearchParams({ volver: "recepcion", espera: e.id, servicio: e.servicioIds[0]!, buscar: e.telefono ?? e.nombre, nombre: e.nombre, ...(sugerida ? { profesional: sugerida.id } : {}) })}`;
      return <article key={e.id} className="fila">
        <div className="fila-cabecera"><h2>{e.nombre}{e.telefono ? ` · ${e.telefono}` : ""}</h2><span className="ayuda">llegó {hora(e.llegada)} · espera hace {minutos} min</span></div>
        <p>{e.servicioIds.map(id => tablero.servicios.find(s => s.id === id)?.nombre ?? "Servicio").join(" + ")}{pedida ? ` · pidió a ${pedida.nombre}` : ""}{e.notas ? ` · ${e.notas}` : ""}</p>
        <p className="ayuda">{pueden.length ? `Pueden ahora: ${pueden.map(p => p.nombre).join(", ")}` : "Nadie libre para esto todavía"}</p>
        <div className="acciones">
          <Link className={pueden.length ? "boton" : "boton secundario"} href={atender}>Atender</Link>
          <Formulario accion={accionSeFue} boton="Se fue" className="en-linea" secundario confirmar={`¿${e.nombre} se fue sin atenderse?`}><input type="hidden" name="esperaId" value={e.id} /></Formulario>
        </div>
      </article>;
    })}</div>
  </>;

  const seccionLibres = <>
    <form className="en-linea">
      {universo && <input type="hidden" name="u" value={UNIVERSO_SLUG[universo]} />}
      <select name="servicio" defaultValue={servicio?.id ?? ""} aria-label="Servicio que pide la clienta">
        <option value="">Todos los servicios</option>
        {tablero.servicios.map(s => <option key={s.id} value={s.id}>{s.nombre} · {s.duracionMinutos} min</option>)}
      </select>
      <button className="secundario">Ver quién puede</button>
      {servicio && <Link href={base}>Quitar filtro</Link>}
    </form>

    <h2 className="subtitulo">Libres{servicio ? ` para ${servicio.nombre}` : ""}</h2>
    {!ordenLibres.length && <p className="intro">{presentes.length ? "No hay nadie libre para esto ahora." : "Todavía no marcaste la entrada de ninguna profesional (abajo, en «No llegaron»)."}</p>}
    <div className="tablero">{ordenLibres.map(p => <article key={p.id} className={entra(p) ? "puesto libre" : "puesto justo"}>
      <div className="fila-cabecera"><h2>{p.nombre}</h2><span className="tag estado-confirmada">Libre</span></div>
      <p>{p.proximo ? `Libre hasta las ${hora(p.proximo.ocupaDesde)}: turno de ${p.proximo.servicio}${p.proximo.otraSede ? " en otra sede" : ""}` : "Sin turnos reservados"}</p>
      {!entra(p) && <p className="ayuda">No llega a terminar {servicio!.nombre} antes de su turno.</p>}
      <div className="acciones">
        <Link className="boton" href={despachar(p.id)}>Atender</Link>
        <Formulario accion={accionSalida} boton="Salida" className="en-linea" secundario confirmar={`¿Marcar la salida de ${p.nombre}?`}><input type="hidden" name="presenciaId" value={p.presencia!.id} /></Formulario>
      </div>
    </article>)}</div>
  </>;

  const seccionAtendiendo = <>
    <h2 className="subtitulo">En sesión</h2>
    {!ordenAtendiendo.length && <p className="intro">No hay sesiones en curso{servicio ? " entre las que hacen este servicio" : ""}.</p>}
    <div className="tablero">{ordenAtendiendo.map(p => {
      const a = p.atencion!;
      const demorada = ahora > a.finEstimado;
      return <article key={p.id} className={demorada ? "puesto demorada" : "puesto ocupada"}>
        <div className="fila-cabecera"><h2>{p.nombre}</h2><span className={`tag ${demorada ? "estado-pendiente" : "estado-pendiente_pago"}`}>{demorada ? "Demorada" : "En sesión"}</span></div>
        <p><NombreClienta cliente={a.cliente} provisional={a.clienteProvisional} /> · {a.servicios.join(", ")}</p>
        <p className="ayuda">Desde las {hora(a.desde)} · estimado hasta las {hora(a.finEstimado)}{a.enOtraSede ? " · en otra sede" : ""}</p>
        {!a.enOtraSede && <Formulario accion={accionTermino} boton="Terminó" className="en-linea"><input type="hidden" name="reservaId" value={a.reservaId} /><input type="hidden" name="profesionalId" value={p.id} /></Formulario>}
      </article>;
    })}</div>
  </>;

  const seccionPorLlegar = <>
    <h2 className="subtitulo">Turnos de hoy</h2>
    {!tablero.porLlegar.length ? <p className="intro">No quedan turnos por llegar hoy.</p> : <div className="tabla">{tablero.porLlegar.map(r => {
      const tarde = Math.floor((ahora.getTime() - r.inicio.getTime()) / 60_000);
      return <article key={r.reservaId} className="fila">
        <div className="fila-cabecera"><h2>{hora(r.inicio)} · <NombreClienta cliente={r.cliente} provisional={r.clienteProvisional} enlace={false} />{tarde > 0 && <> <span className="tag estado-pendiente">{tarde} min tarde</span></>}</h2>
          {r.inicio.getTime() - ahora.getTime() <= ANTICIPO_LLEGADA_MS && <Formulario accion={accionLlegada} boton="Llegó" className="en-linea" secundario><input type="hidden" name="reservaId" value={r.reservaId} /></Formulario>}</div>
        <p>{r.servicios.join(" · ")}</p>
      </article>;
    })}</div>}
  </>;

  return <>
    <div className="contadores">
      <p><strong>{atendiendo.length}</strong>en sesión</p>
      <p><strong>{tablero.porLlegar.length}</strong>turnos por llegar hoy</p>
      <p><strong>{libres.length}</strong>libres</p>
      <p><strong>{tablero.porCobrar.length}</strong>por cobrar</p>
      {tablero.esperas.length > 0 && <p><strong>{tablero.esperas.length}</strong>en espera</p>}
    </div>
    {seccionPorLlegar}{seccionAtendiendo}{seccionLibres}
    <PorCobrar tablero={tablero} hora={hora} verVentas={verVentas} />
    {seccionEspera}
    <NoLlegaron ausentes={ausentes} enOtraSede={enOtraSede} sedeId={sedeId} />
  </>;
}
