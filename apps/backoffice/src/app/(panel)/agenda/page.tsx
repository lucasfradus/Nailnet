import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { DatosInvalidos } from "@nailnet/database/access";
import { catalogoSede } from "@nailnet/database/catalogo";
import { ConfiguracionIncompleta, consultarDisponibilidad } from "@nailnet/database/disponibilidad";
import { listarProfesionales } from "@nailnet/database/profesionales";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";

export const metadata: Metadata = { title: "Disponibilidad · NailNet" };
type Params = { sede?: string; fecha?: string; s?: string | string[]; p?: string | string[] };
const lista = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function Agenda({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const sedeId = q.sede ?? sede?.id ?? (sedes.length === 1 ? sedes[0]!.id : undefined);
  const sedeActual = sedes.find(s => s.id === sedeId);
  if (!sedeId || !sedeActual) return <section className="panel"><h1>Disponibilidad</h1><p className="intro">Elegí una sede:</p>
    <ul className="lista">{sedes.map(s => <li key={s.id}><Link href={`/agenda?sede=${s.id}`}>{s.nombre}</Link></li>)}</ul></section>;

  const hoy = aLocal(new Date(), sedeActual.timezone).fecha;
  const fecha = q.fecha ?? hoy;
  const [catalogo, profesionales] = await Promise.all([
    catalogoSede(db(), actorId, organizacion.id, sedeId),
    listarProfesionales(db(), actorId, organizacion.id, { sedeId }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }),
  ]);
  const habilitados = catalogo.servicios.filter(s => s.efectivo.habilitado);
  const elegidos = lista(q.s).filter(Boolean).slice(0, 3);
  const prefer = lista(q.p);
  const items = elegidos.map((servicioId, i) => ({ servicioId, profesionalId: prefer[i] || null }));

  let turnos: Awaited<ReturnType<typeof consultarDisponibilidad>> = [], aviso = "";
  if (items.length) {
    try { turnos = await consultarDisponibilidad(db(), actorId, organizacion.id, { sedeId, fecha, canal: "RECEPCION", items }); }
    catch (e) {
      if (e instanceof ConfiguracionIncompleta) aviso = `Falta definir en la sede: ${e.faltantes.join(", ")}.`;
      else if (e instanceof DatosInvalidos || e instanceof AccesoDenegado) aviso = e instanceof DatosInvalidos ? e.message : "No tenés acceso a esa sede.";
      else throw e;
    }
  }
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: sedeActual.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const nombreServicio = new Map(habilitados.map(s => [s.id, s.nombre]));

  return <section className="panel">
    <p className="eyebrow">AGENDA · {sedeActual.nombre.toUpperCase()}</p><h1>Disponibilidad</h1>
    <form className="formulario">
      <input type="hidden" name="sede" value={sedeId} />
      <label>Fecha<input type="date" name="fecha" defaultValue={fecha} min={hoy} required /></label>
      {[0, 1, 2].map(i => <div key={i} className="en-linea sin-margen">
        <select name="s" defaultValue={elegidos[i] ?? ""} aria-label={`Servicio ${i + 1}`}>
          <option value="">{i === 0 ? "Elegí un servicio" : "+ otro servicio a continuación (opcional)"}</option>
          {habilitados.map(s => <option key={s.id} value={s.id}>{s.nombre} · {s.efectivo.duracionMinutos} min</option>)}
        </select>
        <select name="p" defaultValue={prefer[i] ?? ""} aria-label={`Profesional ${i + 1}`}>
          <option value="">Cualquiera</option>
          {profesionales.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
        </select>
      </div>)}
      <button>Buscar turnos</button>
    </form>
    {!habilitados.length && <p className="ayuda">No hay servicios habilitados en esta sede. Configuralos en <Link href={`/catalogo?sede=${sedeId}`}>Catálogo</Link>.</p>}
    {aviso && <p className="alerta error">{aviso} {aviso.startsWith("Falta") && <Link href={`/sedes/${sedeId}`}>Configurar la sede</Link>}</p>}
    {items.length > 0 && !aviso && <>
      <h2 className="subtitulo">{turnos.length ? `${turnos.length} turnos el ${fecha}` : `Sin turnos disponibles el ${fecha}`}</h2>
      <div className="tabla">{turnos.map(t => <article key={t.inicio} className="fila">
        <div className="fila-cabecera"><h2>{hora(t.inicio)} – {hora(t.fin)}</h2></div>
        <p>{t.items.map(i => `${nombreServicio.get(i.servicioId)} con ${i.profesional} (${hora(i.inicio)})`).join(" → ")}</p>
      </article>)}</div>
      <p className="ayuda">Tomar el turno llega con la reserva manual (R01). Los horarios se recalculan al confirmar.</p>
    </>}
  </section>;
}
