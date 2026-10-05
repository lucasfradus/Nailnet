import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { DatosInvalidos } from "@nailnet/database/access";
import { catalogoSede } from "@nailnet/database/catalogo";
import { listarClientes, obtenerCliente } from "@nailnet/database/clientes";
import { ConfiguracionIncompleta, consultarDisponibilidad } from "@nailnet/database/disponibilidad";
import { listarProfesionales } from "@nailnet/database/profesionales";
import { resumenReserva } from "@nailnet/database/reservas";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionReprogramar, accionReservar } from "../../acciones";

export const metadata: Metadata = { title: "Nuevo turno · Sicurella" };
type Params = { sede?: string; fecha?: string; s?: string | string[]; p?: string | string[]; cliente?: string; buscar?: string; reprogramar?: string };
const lista = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function NuevoTurno({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const sedeId = q.sede ?? sede?.id ?? (sedes.length === 1 ? sedes[0]!.id : undefined);
  const sedeActual = sedes.find(s => s.id === sedeId);
  if (!sedeId || !sedeActual) return <section className="panel"><h1>Nuevo turno</h1><p className="intro">Elegí una sede:</p>
    <ul className="lista">{sedes.map(s => <li key={s.id}><Link href={`/agenda/nuevo?sede=${s.id}`}>{s.nombre}</Link></li>)}</ul></section>;

  const hoy = aLocal(new Date(), sedeActual.timezone).fecha;
  const fecha = q.fecha ?? hoy;
  const [catalogo, profesionales] = await Promise.all([
    catalogoSede(db(), actorId, organizacion.id, sedeId),
    listarProfesionales(db(), actorId, organizacion.id, { sedeId }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }),
  ]);
  // Modo reprogramar: servicios y cliente vienen del turno original.
  const original = q.reprogramar ? await resumenReserva(db(), actorId, organizacion.id, q.reprogramar).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  if (q.reprogramar && (!original || original.estado !== "CONFIRMADA")) notFound();
  const cliente = original?.clienteId ? await obtenerCliente(db(), actorId, organizacion.id, original.clienteId).catch(() => null) : q.cliente ? await obtenerCliente(db(), actorId, organizacion.id, q.cliente).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  const candidatos = !cliente && q.buscar ? await listarClientes(db(), actorId, organizacion.id, { texto: q.buscar }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }) : [];
  const habilitados = catalogo.servicios.filter(s => s.efectivo.habilitado);
  const elegidos = (original && !q.s ? original.items.map(i => i.servicioId) : lista(q.s)).filter(Boolean).slice(0, 3);
  const prefer = lista(q.p);
  const items = elegidos.map((servicioId, i) => ({ servicioId, profesionalId: prefer[i] || null }));

  let turnos: Awaited<ReturnType<typeof consultarDisponibilidad>> = [], aviso = "";
  if (items.length) {
    try { turnos = await consultarDisponibilidad(db(), actorId, organizacion.id, { sedeId, fecha, canal: "RECEPCION", items }); }
    catch (e) {
      if (e instanceof ConfiguracionIncompleta) aviso = `Falta definir en la sede: ${e.faltantes.join(", ")}.`;
      else if (e instanceof DatosInvalidos) aviso = e.message;
      else if (e instanceof AccesoDenegado) aviso = "No tenés acceso a esa sede.";
      else throw e;
    }
  }
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: sedeActual.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const nombreServicio = new Map(habilitados.map(s => [s.id, s.nombre]));
  // Parámetros a conservar entre pasos (cliente → servicios → horario).
  const base = new URLSearchParams({ sede: sedeId, fecha, ...(original ? { reprogramar: original.id } : {}) });
  elegidos.forEach((s, i) => { base.append("s", s); base.append("p", prefer[i] ?? ""); });

  return <section className="panel">
    <p className="eyebrow"><Link href={`/agenda?sede=${sedeId}&fecha=${fecha}`}>AGENDA</Link> · {sedeActual.nombre.toUpperCase()}</p><h1>{original ? "Reprogramar turno" : "Nuevo turno"}</h1>
    {original && <p className="intro">{original.items.map(i => i.servicio).join(" + ")} de {original.cliente?.nombre} {original.cliente?.apellido}. Se conservan precio y seña pactados; el horario actual se libera solo si el nuevo se confirma.</p>}

    <h2 className="subtitulo">1 · Cliente</h2>
    {original ? <p>{cliente?.nombre} {cliente?.apellido}</p> : cliente ? <p>{cliente.nombre} {cliente.apellido} · {[cliente.telefono, cliente.email].filter(Boolean).join(" · ")} · <Link href={`/agenda/nuevo?${base}`}>cambiar</Link></p> : <>
      <form className="en-linea" role="search">
        {[...base.entries()].map(([k, v], i) => <input key={i} type="hidden" name={k} value={v} />)}
        <input name="buscar" defaultValue={q.buscar} placeholder="Nombre, email o parte del teléfono" aria-label="Buscar cliente" required />
        <button className="secundario">Buscar</button>
      </form>
      {candidatos.map(c => <p key={c.id}><Link href={`/agenda/nuevo?${base}&cliente=${c.id}`}>{c.nombre} {c.apellido}</Link> · {[c.telefono, c.email].filter(Boolean).join(" · ")}</p>)}
      {q.buscar && !candidatos.length && <p className="ayuda">Sin resultados en tus sedes. <Link href="/clientes">Buscala en la organización o dala de alta</Link>.</p>}
    </>}

    <h2 className="subtitulo">2 · Servicios y fecha</h2>
    <form className="formulario">
      <input type="hidden" name="sede" value={sedeId} />{cliente && !original && <input type="hidden" name="cliente" value={cliente.id} />}{original && <input type="hidden" name="reprogramar" value={original.id} />}
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
      <button>Buscar horarios</button>
    </form>
    {!habilitados.length && <p className="ayuda">No hay servicios habilitados en esta sede. Configuralos en <Link href={`/catalogo?sede=${sedeId}`}>Catálogo</Link>.</p>}
    {aviso && <p className="alerta error">{aviso} {aviso.startsWith("Falta") && <Link href={`/sedes/${sedeId}`}>Configurar la sede</Link>}</p>}

    {items.length > 0 && !aviso && <>
      <h2 className="subtitulo">3 · Horario {turnos.length ? `(${turnos.length} disponibles el ${fecha})` : `· sin turnos el ${fecha}`}</h2>
      {!cliente && turnos.length > 0 && <p className="alerta error">Elegí el cliente para poder reservar.</p>}
      <div className="tabla">{turnos.map(t => <article key={t.inicio} className="fila">
        <div className="fila-cabecera"><h2>{hora(t.inicio)} – {hora(t.fin)}</h2></div>
        <p>{t.items.map(i => `${nombreServicio.get(i.servicioId)} con ${i.profesional} (${hora(i.inicio)})`).join(" → ")}</p>
        {original && <Formulario accion={accionReprogramar} boton={`Mover a ${hora(t.inicio)}`} className="en-linea">
          <input type="hidden" name="reservaId" value={original.id} /><input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="fecha" value={fecha} /><input type="hidden" name="inicio" value={t.inicio} />
          {t.items.map((i, k) => <input key={k} type="hidden" name="p" value={prefer[k] || i.profesionalId} />)}
        </Formulario>}
        {cliente && !original && <Formulario accion={accionReservar} boton={`Reservar ${hora(t.inicio)}`} className="en-linea">
          <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="fecha" value={fecha} />
          <input type="hidden" name="clienteId" value={cliente.id} /><input type="hidden" name="inicio" value={t.inicio} />
          {/* Se envía el profesional asignado: si «cualquiera» cambió mientras tanto, se revalida igual bajo lock. */}
          {t.items.map((i, k) => <span key={k}><input type="hidden" name="s" value={i.servicioId} /><input type="hidden" name="p" value={prefer[k] || i.profesionalId} /></span>)}
          <input name="notas" placeholder="Notas (opcional)" maxLength={1000} aria-label="Notas" />
        </Formulario>}
      </article>)}</div>
    </>}
  </section>;
}
