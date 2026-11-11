import Link from "next/link";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc, validarFecha } from "@nailnet/domain/agenda";
import { DatosInvalidos } from "@nailnet/database/access";
import { agendaDia, destinosDeTurno } from "@nailnet/database/agenda-dia";
import { resumenReserva } from "@nailnet/database/reservas";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionSalida, accionSeFue } from "./acciones";
import { NoLlegaron, PorCobrar, repartir, type Tablero } from "./comun";
import { GrillaTratamientos } from "./grilla-tratamientos";
import type { DatosGrilla, Moviendo } from "./tratamientos-modelo";

type Parametros = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const nombreDe = (c: { nombre: string; apellido: string | null } | null) => c ? [c.nombre, c.apellido].filter(Boolean).join(" ") : "Sin ficha";

/**
 * Pestaña Tratamientos del tablero de recepción (doc 31). Trabaja con turno previo: lo principal es la
 * grilla del día (etapa 4). Debajo, lo que comparte con Manos y pies: por cobrar (la caja es una sola) y la
 * entrada y salida de las profesionales. No anota en espera; si ya hay una clienta anotada para un
 * tratamiento, la lista se muestra igual para que no se pierda.
 */
export function TableroTratamientos({ tablero, ahora, sedeId, q, verVentas }: { tablero: Tablero; ahora: Date; sedeId: string; q: Parametros; verVentas: boolean }) {
  const tz = tablero.timezone;
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const { presentes, ausentes, enOtraSede, libres, atendiendo } = repartir(tablero);

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

  return <>
    <div className="contadores">
      <p><strong>{atendiendo.length}</strong>en sesión</p>
      <p><strong>{tablero.porLlegar.length}</strong>turnos por llegar hoy</p>
      <p><strong>{tablero.porCobrar.length}</strong>por cobrar</p>
      {tablero.esperas.length > 0 && <p><strong>{tablero.esperas.length}</strong>en espera</p>}
    </div>
    <GrillaDelDia q={q} />
    <PorCobrar tablero={tablero} hora={hora} verVentas={verVentas} />
    {seccionEspera}
    <EnElLocal profesionales={presentes} timezone={tz} />
    <NoLlegaron ausentes={ausentes} enOtraSede={enOtraSede} sedeId={sedeId} />
  </>;
}

/**
 * La grilla del día de la sede (doc 31, etapa 4), por profesional o por
 * cabina. La fecha (`fecha`), la vista (`vista=cabina`) y el turno que se está moviendo (`mover`) van en la
 * URL, así sobreviven a la actualización automática y «mover» sigue al cambiar de día. Lo demás (el turno
 * elegido, «Nuevo turno», lo que se está escribiendo) vive en la pantalla.
 */
async function GrillaDelDia({ q }: { q: Parametros }) {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!sede) return null;
  const actor = sesion.usuario.id, tz = sede.timezone, ahora = new Date();
  const hoy = aLocal(ahora, tz).fecha;
  const fecha = validarFecha(uno(q.fecha)) ? uno(q.fecha) : hoy;
  const vista = uno(q.vista) === "cabina" ? "cabina" : "profesional";
  const mover = uno(q.mover);

  const dia = await agendaDia(db(), actor, organizacion.id, { sedeId: sede.id, fecha, universo: "TRATAMIENTOS" }, ahora)
    .catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!dia) return <p className="alerta error">No tenés permiso para ver la agenda de esta sede.</p>;
  const cero = aUtc(fecha, 0, tz).getTime();
  const min = (d: Date) => Math.round((d.getTime() - cero) / 60_000);
  const intervalos = (xs: { desde: Date; hasta: Date }[]) => xs.map(x => ({ desde: min(x.desde), hasta: min(x.hasta) }));
  const apertura = intervalos(dia.apertura);

  let moviendo: Moviendo | null = null;
  if (mover) {
    const r = await resumenReserva(db(), actor, organizacion.id, mover).catch(e => { if (e instanceof AccesoDenegado || e instanceof DatosInvalidos) return null; throw e; });
    if (r) {
      const inicio = r.items[0]?.inicio;
      const dondeEstaba = inicio ? `${aLocal(inicio, tz).fecha === hoy ? "hoy" : `el ${inicio.toLocaleDateString("es-AR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })}`} a las ${inicio.toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "";
      moviendo = { reservaId: r.id, cliente: r.cliente ? nombreDe(r.cliente) : r.clienteProvisional ?? "Sin ficha", servicios: r.items.map(i => i.servicio).join(" + "), desde: dondeEstaba, destinos: null, error: null };
      try {
        const d = await destinosDeTurno(db(), actor, organizacion.id, mover, fecha, ahora);
        moviendo.destinos = d.destinos.map(x => ({ profesionalIds: x.profesionalIds, inicios: x.inicios.map(i => ({ inicio: min(i.inicio), fin: min(i.fin), items: i.items })) }));
      } catch (e) {
        if (!(e instanceof DatosInvalidos || e instanceof AccesoDenegado)) throw e;
        moviendo.error = e instanceof DatosInvalidos ? e.message : "No tenés permiso para mover este turno";
      }
    }
  }

  const parametros: Record<string, string> = { u: "tratamientos", ...(fecha !== hoy ? { fecha } : {}), ...(vista === "cabina" ? { vista } : {}), ...(moviendo ? { mover } : {}) };
  const datos: DatosGrilla = {
    fecha, hoy, esHoy: dia.esHoy, ahora: dia.esHoy ? min(ahora) : null, paso: dia.pasoMinutos ?? 30, apertura,
    profesionales: dia.profesionales.map(p => ({
      id: p.id, nombre: p.nombre, servicioIds: p.servicioIds,
      // Puede atender dentro de su jornada y de la apertura de la sede.
      disponible: intervalos(p.jornada).flatMap(j => apertura.map(a => ({ desde: Math.max(j.desde, a.desde), hasta: Math.min(j.hasta, a.hasta) }))).filter(x => x.desde < x.hasta),
      ausencias: p.ausencias.map(a => ({ desde: min(a.desde), hasta: min(a.hasta), motivo: a.motivo })),
    })),
    servicios: dia.servicios.map(s => ({ id: s.id, nombre: s.nombre, duracion: s.duracionMinutos, recursos: s.recursos })),
    recursos: dia.recursos,
    turnos: dia.turnos.map(t => ({
      reservaId: t.reservaId, itemId: t.itemId, posicion: t.posicion, itemsDeLaReserva: t.itemsDeLaReserva, profesionalId: t.profesionalId, recursoIds: t.recursoIds,
      servicioId: t.servicioId, servicio: t.servicio, inicio: min(t.inicio), fin: min(t.fin), ocupaDesde: min(t.ocupaDesde), ocupaHasta: min(t.ocupaHasta),
      cliente: t.cliente ? { id: t.cliente.id, nombre: nombreDe(t.cliente), telefono: t.cliente.telefono } : null,
      notas: t.notas, online: t.canal === "ONLINE", estado: t.estado, expira: t.expiraEn ? min(t.expiraEn) : null, terminado: !!t.terminadoEn,
    })),
    moviendo, vista, parametros,
    puede: { cobrar: puede.verVentas, verClientes: puede.verClientes, crearClientes: puede.editarClientes },
  };
  // Otra fecha es otra pantalla: lo elegido en una no sigue en la otra (salvo «mover», que va en la URL).
  return <GrillaTratamientos key={fecha} datos={datos} />;
}

type Presente = { id: string; nombre: string; presencia: { id: string; otraSede: string | null } | null; atencion: { finEstimado: Date; enOtraSede: boolean } | null };

/** Entrada y salida en Tratamientos: quién está en el local, con su «Salida» (la entrada sigue en «No llegaron»). */
function EnElLocal({ profesionales, timezone }: { profesionales: Presente[]; timezone: string }) {
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const aca = profesionales.filter(p => (p.presencia && !p.presencia.otraSede) || (p.atencion && !p.atencion.enOtraSede));
  return <>
    <h2 className="subtitulo">En el local</h2>
    {!aca.length ? <p className="intro">Todavía no marcaste la entrada de ninguna profesional (abajo, en «No llegaron»).</p> : <div className="tabla">{aca.map(p =>
      <article key={p.id} className="fila"><div className="fila-cabecera">
        <h2>{p.nombre} <span className={`tag ${p.atencion ? "estado-pendiente_pago" : "estado-confirmada"}`}>{p.atencion ? `En sesión hasta ${hora(p.atencion.finEstimado)}` : "Libre"}</span></h2>
        {p.presencia && !p.atencion && <Formulario accion={accionSalida} boton="Salida" className="en-linea" secundario confirmar={`¿Marcar la salida de ${p.nombre}?`}><input type="hidden" name="presenciaId" value={p.presencia.id} /></Formulario>}
      </div></article>)}</div>}
  </>;
}
