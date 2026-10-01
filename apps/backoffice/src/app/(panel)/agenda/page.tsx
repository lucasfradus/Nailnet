import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { listarProfesionales } from "@nailnet/database/profesionales";
import { agendaSede } from "@nailnet/database/reservas";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionAtendida, accionAusente, accionCancelarReserva } from "../acciones";

export const metadata: Metadata = { title: "Agenda · NailNet" };
type Params = { sede?: string; fecha?: string; vista?: string; profesional?: string; cerrados?: string; ok?: string };
const ESTADOS: Record<string, string> = { PENDIENTE_PAGO: "Pendiente de seña", PAGO_EN_REVISION: "Pago en revisión", CONFIRMADA: "Confirmado", ATENDIDA: "Atendido", AUSENTE: "Ausente", CANCELADA: "Cancelado", EXPIRADA: "Vencido" };
const sumar = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default async function Agenda({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const sedeId = q.sede ?? sede?.id ?? (sedes.length === 1 ? sedes[0]!.id : undefined);
  const sedeActual = sedes.find(s => s.id === sedeId);
  if (!sedeId || !sedeActual) return <section className="panel"><h1>Agenda</h1><p className="intro">Elegí una sede:</p>
    <ul className="lista">{sedes.map(s => <li key={s.id}><Link href={`/agenda?sede=${s.id}`}>{s.nombre}</Link></li>)}</ul></section>;

  const tz = sedeActual.timezone;
  const hoy = aLocal(new Date(), tz).fecha;
  const fecha = q.fecha ?? hoy;
  const semana = q.vista === "semana";
  const agenda = await agendaSede(db(), actorId, organizacion.id, { sedeId, desde: fecha, dias: semana ? 7 : 1, profesionalId: q.profesional || null, incluirCerrados: q.cerrados === "1" })
    .catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!agenda) notFound();
  const profesionales = await listarProfesionales(db(), actorId, organizacion.id, { sedeId }).catch(() => []);
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dia = (d: Date) => d.toLocaleDateString("es-AR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const porDia = new Map<string, typeof agenda.items>();
  for (const i of agenda.items) { const k = aLocal(i.inicio, tz).fecha; porDia.set(k, [...(porDia.get(k) ?? []), i]); }
  const enlace = (extra: Record<string, string>) => `/agenda?${new URLSearchParams({ sede: sedeId, fecha, vista: semana ? "semana" : "dia", ...(q.profesional ? { profesional: q.profesional } : {}), ...extra })}`;

  return <section className="panel">
    <p className="eyebrow">AGENDA · {sedeActual.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>{semana ? `Semana del ${fecha}` : dia(new Date(`${fecha}T12:00:00Z`))}</h1>
      {puede.verSedes && <Link className="boton" href={`/agenda/nuevo?sede=${sedeId}&fecha=${fecha}`}>Nuevo turno</Link>}</div>
    {q.ok && <p className="alerta ok">{q.ok === "reprogramado" ? "Turno reprogramado." : "Turno reservado."}</p>}
    <nav className="en-linea">
      <Link href={enlace({ fecha: sumar(fecha, semana ? -7 : -1) })}>← Anterior</Link>
      <Link href={enlace({ fecha: hoy })}>Hoy</Link>
      <Link href={enlace({ fecha: sumar(fecha, semana ? 7 : 1) })}>Siguiente →</Link>
      <Link href={enlace({ vista: semana ? "dia" : "semana" })}>{semana ? "Ver día" : "Ver semana"}</Link>
    </nav>
    <form className="en-linea">
      <input type="hidden" name="sede" value={sedeId} /><input type="hidden" name="fecha" value={fecha} /><input type="hidden" name="vista" value={semana ? "semana" : "dia"} />
      <select name="profesional" defaultValue={q.profesional ?? ""} aria-label="Profesional"><option value="">Todos los profesionales</option>{profesionales.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}</select>
      <label className="check"><input type="checkbox" name="cerrados" value="1" defaultChecked={q.cerrados === "1"} />Incluir cancelados y vencidos</label>
      <button className="secundario">Filtrar</button>
    </form>

    {!agenda.items.length && <p className="intro">Sin turnos{semana ? " esta semana" : " este día"}.</p>}
    {[...porDia.entries()].map(([d, items]) => <div key={d}>
      {semana && <h2 className="subtitulo">{dia(new Date(`${d}T12:00:00Z`))}</h2>}
      <div className="tabla">{items.map(i => <article key={i.itemId} className={["CANCELADA", "EXPIRADA"].includes(i.estado) ? "fila inactiva" : "fila"}>
        <div className="fila-cabecera"><h2>{hora(i.inicio)} – {hora(i.fin)} · {i.servicio}</h2><span className={`tag estado-${i.estado.toLowerCase()}`}>{ESTADOS[i.estado]}</span></div>
        <p>{i.cliente ? <Link href={`/clientes/${i.cliente.id}`}>{i.cliente.nombre} {i.cliente.apellido}</Link> : "Sin cliente"}{i.cliente?.telefono ? ` · ${i.cliente.telefono}` : ""}
          {" · "}{i.profesional.nombre} {i.profesional.apellido}{i.recursos.length ? ` · ${i.recursos.join(", ")}` : ""}{i.canal === "ONLINE" ? " · online" : ""}
          {i.estado === "PENDIENTE_PAGO" && i.expiraEn ? ` · vence ${hora(i.expiraEn)}` : ""}</p>
        {i.notas && i.posicion === 0 && <p className="ayuda">{i.notas}</p>}
        {i.posicion === 0 && ["CONFIRMADA", "PENDIENTE_PAGO", "PAGO_EN_REVISION"].includes(i.estado) && <div className="acciones">
          {i.estado === "CONFIRMADA" && <>
            <Formulario accion={accionAtendida} boton="Atendido" className="en-linea" secundario><input type="hidden" name="reservaId" value={i.reservaId} /></Formulario>
            <Formulario accion={accionAusente} boton="Ausente" className="en-linea" secundario confirmar="¿Marcar ausente?"><input type="hidden" name="reservaId" value={i.reservaId} /></Formulario>
            <Link className="boton secundario" href={`/agenda/nuevo?sede=${sedeId}&fecha=${aLocal(i.inicio, tz).fecha}&reprogramar=${i.reservaId}`}>Reprogramar</Link>
          </>}
          <details><summary>Cancelar</summary>
            <Formulario accion={accionCancelarReserva} boton="Cancelar turno" className="en-linea" secundario confirmar="¿Cancelar el turno? El horario se libera en el acto.">
              <input type="hidden" name="reservaId" value={i.reservaId} />
              <input name="motivo" placeholder="Motivo" required maxLength={300} aria-label="Motivo de la cancelación" />
            </Formulario>
          </details>
        </div>}
      </article>)}</div>
    </div>)}
  </section>;
}
