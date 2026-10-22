import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { catalogoSede } from "@nailnet/database/catalogo";
import { listarClientes, obtenerCliente } from "@nailnet/database/clientes";
import { listarProfesionales } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearCliente } from "../../acciones";
import { accionAtenderAhora } from "./acciones";

export const metadata: Metadata = { title: "Atender ahora · Sicurella" };
const SERVICIOS = 3;

/**
 * «Atender ahora»: cliente que llega sin turno. Se elige (o se crea con nombre y un contacto) el cliente,
 * la profesional y los servicios, y el turno arranca en este momento ocupando la agenda de la profesional.
 * Al terminar, se marca atendido y se cobra con la comanda, como cualquier turno.
 */
export default async function AtenderAhora({ searchParams }: { searchParams: Promise<{ cliente?: string; buscar?: string; profesional?: string; servicio?: string; volver?: string; espera?: string; nombre?: string }> }) {
  const q = await searchParams;
  // Desde el tablero de recepción (doc 29) llegan la profesional y el servicio elegidos, y se vuelve ahí.
  const desdeTablero = q.volver === "recepcion";
  const contexto = new URLSearchParams({ ...(desdeTablero ? { volver: "recepcion" } : {}), ...(q.profesional ? { profesional: q.profesional } : {}), ...(q.servicio ? { servicio: q.servicio } : {}), ...(q.espera ? { espera: q.espera } : {}) });
  const aqui = (extra: Record<string, string> = {}) => `/agenda/ahora?${new URLSearchParams([...contexto, ...Object.entries(extra)])}`;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  if (!sede) return <section className="panel"><h1>Atender ahora</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const actorId = sesion.usuario.id;
  const [catalogo, profesionales] = await Promise.all([
    catalogoSede(db(), actorId, organizacion.id, sede.id),
    listarProfesionales(db(), actorId, organizacion.id, { sedeId: sede.id }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }),
  ]);
  const cliente = q.cliente ? await obtenerCliente(db(), actorId, organizacion.id, q.cliente).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  const candidatos = !cliente && q.buscar?.trim() ? await listarClientes(db(), actorId, organizacion.id, { texto: q.buscar }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }) : [];
  const habilitados = catalogo.servicios.filter(s => s.efectivo.habilitado);
  const activas = profesionales.filter(p => p.activo);
  const sugerido = q.buscar?.trim() ?? "";
  // Desde la lista de espera llega también el nombre, para el alta rápida.
  const valores: { nombre?: string; telefono?: string; email?: string } = { ...(sugerido.includes("@") ? { email: sugerido } : /^[\d\s+()-]+$/.test(sugerido) ? { telefono: sugerido } : { nombre: sugerido }), ...(q.nombre ? { nombre: q.nombre } : {}) };

  return <section className="panel">
    <p className="eyebrow">{desdeTablero ? <Link href="/recepcion">RECEPCIÓN</Link> : <Link href="/agenda">AGENDA</Link>} · {sede.nombre.toUpperCase()}</p>
    <h1>Atender ahora</h1>
    {q.espera && <p className="alerta ok">Clienta de la lista de espera: al empezar sale de la lista.</p>}
    <p className="intro">Para un cliente que llegó sin turno. El turno empieza ahora y ocupa la agenda de la profesional: el portal deja de ofrecer ese horario. Si la profesional está ocupada, elegí otra.</p>

    <h2 className="subtitulo">1. Cliente</h2>
    {cliente ? <p className="alerta ok">{cliente.nombre} {cliente.apellido ?? ""}{cliente.telefono ? ` · ${cliente.telefono}` : ""} <Link href={aqui()}>Cambiar</Link></p> : <>
      <form className="en-linea" action="/agenda/ahora">
        {[...contexto].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="buscar" defaultValue={q.buscar ?? ""} placeholder="Nombre, teléfono o email" aria-label="Buscar cliente" />
        <button className="secundario">Buscar</button>
      </form>
      {candidatos.length > 0 && <div className="tabla">{candidatos.slice(0, 10).map(c => <Link key={c.id} className="fila fila-enlace" href={aqui({ cliente: c.id })}>
        <div className="fila-enlace-texto"><h2>{c.nombre} {c.apellido ?? ""}</h2><p>{[c.telefono, c.email].filter(Boolean).join(" · ") || "Sin contacto"}</p></div>
        <span className="boton secundario">Elegir</span>
      </Link>)}</div>}
      {q.buscar && <details className="desplegable" open={!candidatos.length}>
        <summary>+ Cliente nuevo (datos mínimos)</summary>
        <Formulario accion={accionCrearCliente} boton="Crear y seguir">
          <input type="hidden" name="sedeId" value={sede.id} />
          <input type="hidden" name="volver" value={aqui()} />
          <div className="grilla">
            <label>Nombre<input name="nombre" required maxLength={80} defaultValue={valores.nombre ?? ""} autoComplete="off" /></label>
            <label>Teléfono<input name="telefono" inputMode="tel" defaultValue={valores.telefono ?? ""} autoComplete="off" /></label>
            <label>Email (opcional si hay teléfono)<input name="email" type="email" defaultValue={valores.email ?? ""} autoComplete="off" /></label>
          </div>
          <p className="ayuda">Alcanza con el nombre y un teléfono o email. El resto se completa después en la ficha.</p>
        </Formulario>
      </details>}
    </>}

    {cliente && <>
      <h2 className="subtitulo">2. Profesional y servicios</h2>
      <Formulario accion={accionAtenderAhora} boton="Empezar ahora">
        <input type="hidden" name="sedeId" value={sede.id} />
        <input type="hidden" name="clienteId" value={cliente.id} />
        {desdeTablero && <input type="hidden" name="volver" value="recepcion" />}
        {q.espera && <input type="hidden" name="esperaId" value={q.espera} />}
        {Array.from({ length: SERVICIOS }, (_, i) => <div key={i} className="grilla">
          <select name={`s_${i}`} defaultValue={i === 0 ? q.servicio ?? "" : ""} aria-label={`Servicio ${i + 1}`} required={i === 0}>
            <option value="">{i === 0 ? "Elegí un servicio" : "+ Otro servicio"}</option>
            {habilitados.map(s => <option key={s.id} value={s.id}>{s.nombre} · {s.efectivo.duracionMinutos} min</option>)}
          </select>
          <select name={`p_${i}`} defaultValue={i === 0 ? q.profesional ?? "" : ""} aria-label={`Profesional del servicio ${i + 1}`} required={i === 0}>
            <option value="">Profesional</option>
            {activas.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido ?? ""}</option>)}
          </select>
          {i > 0 && <label className="check"><input type="checkbox" name={`j_${i}`} value="1" />A la vez con el anterior (otra profesional)</label>}
        </div>)}
        <label>Notas (opcional)<input name="notas" maxLength={1000} /></label>
        <p className="ayuda">Al terminar, tocá «Terminó» en el tablero de recepción (o marcalo atendido en la agenda) y cobralo con la comanda (podés agregar o quitar servicios y ajustar precios).</p>
      </Formulario>
    </>}
  </section>;
}
