import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { tableroSede } from "@nailnet/database/tablero";
import { Formulario } from "@/components/formulario";
import { Refresco } from "@/components/refresco";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionEntrada, accionLlegada, accionSalida, accionTermino } from "./acciones";

export const metadata: Metadata = { title: "Recepción · Sicurella" };
type Params = { servicio?: string; ok?: string };
const nombreCliente = (c: { nombre: string; apellido: string | null } | null) => c ? [c.nombre, c.apellido].filter(Boolean).join(" ") : "Sin cliente";

/**
 * Tablero de recepción (doc 29): quién está en el local y quién está libre para qué. Recepción marca la
 * entrada y la salida de cada profesional, despacha a la clienta que llega sin turno («Atender ahora»),
 * marca la llegada de la que tiene turno y «Terminó» cuando la profesional queda libre. Lo terminado sin
 * venta queda por cobrar. Se actualiza solo, porque lo usan varias recepcionistas a la vez.
 */
export default async function Recepcion({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  if (!sede) return <section className="panel"><h1>Recepción</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const ahora = new Date();
  const tablero = await tableroSede(db(), sesion.usuario.id, organizacion.id, sede.id, ahora).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!tablero) notFound();
  const tz = tablero.timezone;
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const servicio = tablero.servicios.find(s => s.id === q.servicio) ?? null;
  const presentes = tablero.profesionales.filter(p => p.presencia && !p.presencia.otraSede);
  const ausentes = tablero.profesionales.filter(p => !p.presencia);
  const enOtraSede = tablero.profesionales.filter(p => p.presencia?.otraSede);
  const libres = presentes.filter(p => !p.atencion);
  const atendiendo = presentes.filter(p => p.atencion);
  // Con un servicio elegido: solo las que lo hacen, y si llega a terminarlo antes de su próximo turno.
  const aptas = (ps: typeof presentes) => servicio ? ps.filter(p => p.servicioIds.includes(servicio.id)) : ps;
  const entra = (p: (typeof presentes)[number]) => !servicio || !p.proximo || ahora.getTime() + servicio.duracionMinutos * 60_000 <= p.proximo.ocupaDesde.getTime();
  const ordenLibres = aptas(libres).sort((a, b) => Number(entra(b)) - Number(entra(a)));
  const ordenAtendiendo = aptas(atendiendo).sort((a, b) => a.atencion!.finEstimado.getTime() - b.atencion!.finEstimado.getTime());
  const despachar = (profesionalId: string) => `/agenda/ahora?${new URLSearchParams({ volver: "recepcion", profesional: profesionalId, ...(servicio ? { servicio: servicio.id } : {}) })}`;

  return <section className="panel">
    <Refresco segundos={20} />
    <p className="eyebrow">RECEPCIÓN · {sede.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>Tablero</h1>
      <div className="en-linea"><Link className="boton" href="/agenda/ahora?volver=recepcion">Atender ahora</Link> <Link className="boton secundario" href="/agenda">Agenda</Link></div></div>
    {q.ok === "ahora" && <p className="alerta ok">Clienta en atención. Cuando la profesional termine, tocá «Terminó» en su tarjeta.</p>}

    <div className="contadores">
      <p><strong>{libres.length}</strong>libres</p>
      <p><strong>{atendiendo.length}</strong>atendiendo</p>
      <p><strong>{tablero.porCobrar.length}</strong>por cobrar</p>
      <p><strong>{tablero.porLlegar.length}</strong>turnos por llegar</p>
    </div>

    <form className="en-linea">
      <select name="servicio" defaultValue={servicio?.id ?? ""} aria-label="Servicio que pide la clienta">
        <option value="">Todos los servicios</option>
        {tablero.servicios.map(s => <option key={s.id} value={s.id}>{s.nombre} · {s.duracionMinutos} min</option>)}
      </select>
      <button className="secundario">Ver quién puede</button>
      {servicio && <Link href="/recepcion">Quitar filtro</Link>}
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

    <h2 className="subtitulo">Atendiendo</h2>
    {!ordenAtendiendo.length && <p className="intro">Nadie está atendiendo{servicio ? " entre las que hacen este servicio" : ""}.</p>}
    <div className="tablero">{ordenAtendiendo.map(p => {
      const a = p.atencion!;
      const demorada = ahora > a.finEstimado;
      return <article key={p.id} className={demorada ? "puesto demorada" : "puesto ocupada"}>
        <div className="fila-cabecera"><h2>{p.nombre}</h2><span className={`tag ${demorada ? "estado-pendiente" : "estado-pendiente_pago"}`}>{demorada ? "Demorada" : "Atendiendo"}</span></div>
        <p>{a.cliente ? <Link href={`/clientes/${a.cliente.id}`}>{nombreCliente(a.cliente)}</Link> : "Sin cliente"} · {a.servicios.join(", ")}</p>
        <p className="ayuda">Desde las {hora(a.desde)} · estimado hasta las {hora(a.finEstimado)}{a.enOtraSede ? " · en otra sede" : ""}</p>
        {!a.enOtraSede && <Formulario accion={accionTermino} boton="Terminó" className="en-linea"><input type="hidden" name="reservaId" value={a.reservaId} /><input type="hidden" name="profesionalId" value={p.id} /></Formulario>}
      </article>;
    })}</div>

    <h2 className="subtitulo">Por cobrar</h2>
    {!tablero.porCobrar.length ? <p className="intro">No hay comandas pendientes.</p> : <div className="tabla">{tablero.porCobrar.map(r => <article key={r.reservaId} className="fila">
      <div className="fila-cabecera"><h2>{nombreCliente(r.cliente)}</h2><span className="ayuda">terminó {hora(r.terminadaEn)}</span></div>
      <p>{r.servicios.join(" · ")}</p>
      {puede.verVentas && <div className="acciones"><Link className="boton" href={`/ventas/nueva?reserva=${r.reservaId}`}>Cobrar</Link></div>}
    </article>)}</div>}

    <h2 className="subtitulo">Turnos por llegar</h2>
    {!tablero.porLlegar.length ? <p className="intro">No hay turnos reservados en las próximas dos horas.</p> : <div className="tabla">{tablero.porLlegar.map(r => <article key={r.reservaId} className="fila">
      <div className="fila-cabecera"><h2>{hora(r.inicio)} · {nombreCliente(r.cliente)}</h2>
        <Formulario accion={accionLlegada} boton="Llegó" className="en-linea" secundario><input type="hidden" name="reservaId" value={r.reservaId} /></Formulario></div>
      <p>{r.servicios.join(" · ")}</p>
    </article>)}</div>}

    <h2 className="subtitulo">No llegaron</h2>
    {!ausentes.length && !enOtraSede.length ? <p className="intro">Están todas.</p> : <div className="tabla">
      {ausentes.map(p => <article key={p.id} className="fila"><div className="fila-cabecera"><h2>{p.nombre}</h2>
        <Formulario accion={accionEntrada} boton="Entrada" className="en-linea" secundario>
          <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="profesionalId" value={p.id} />
        </Formulario></div></article>)}
      {enOtraSede.map(p => <article key={p.id} className="fila inactiva"><div className="fila-cabecera"><h2>{p.nombre}</h2><span className="ayuda">en {p.presencia!.otraSede}</span></div></article>)}
    </div>}
  </section>;
}
