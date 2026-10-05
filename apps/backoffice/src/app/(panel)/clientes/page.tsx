import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DatosInvalidos } from "@nailnet/database/access";
import { buscarParaVincular, listarClientes } from "@nailnet/database/clientes";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearCliente, accionVincularCliente } from "../acciones";
import { CamposCliente } from "./campos";

export const metadata: Metadata = { title: "Clientes · Sicurella" };

function SelectorSede({ sedes, elegida }: { sedes: { id: string; nombre: string }[]; elegida?: string }) {
  if (sedes.length === 1 || elegida) return <input type="hidden" name="sedeId" value={elegida ?? sedes[0]!.id} />;
  return <select name="sedeId" aria-label="Sede" required>{sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>;
}

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; contacto?: string }> }) {
  const { q, contacto } = await searchParams;
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verClientes) notFound();
  const actorId = sesion.usuario.id;
  const clientes = await listarClientes(db(), actorId, organizacion.id, { sedeId: sede?.id, texto: q });
  let encontrados: Awaited<ReturnType<typeof buscarParaVincular>> = [], errorBusqueda = "";
  if (contacto && puede.editarClientes) {
    try { encontrados = await buscarParaVincular(db(), actorId, organizacion.id, contacto); }
    catch (e) { if (e instanceof DatosInvalidos) errorBusqueda = e.message; else throw e; }
  }

  return <section className="panel">
    <p className="eyebrow">CLIENTES{sede ? ` · ${sede.nombre.toUpperCase()}` : ""}</p><h1>Clientes</h1>
    <form className="en-linea" role="search">
      <input name="q" defaultValue={q} placeholder="Nombre, email o parte del teléfono" aria-label="Buscar" maxLength={80} />
      <button className="secundario">Buscar</button>
    </form>
    <div className="tabla">
      {clientes.map(c => <article key={c.id} className="fila">
        <div className="fila-cabecera"><h2><Link href={`/clientes/${c.id}`}>{c.nombre} {c.apellido}</Link></h2><span className="tag">{c.sedes.join(" · ") || "Sin sede"}</span></div>
        <p>{[c.email, c.telefono].filter(Boolean).join(" · ")}</p>
      </article>)}
      {!clientes.length && <p>{q ? "Sin resultados en tus sedes." : "Todavía no hay clientes en tus sedes."}</p>}
      {clientes.length === 50 && <p className="ayuda">Se muestran los primeros 50. Refiná la búsqueda.</p>}
    </div>

    {puede.editarClientes && sedes.length > 0 && <>
      <h2 className="subtitulo">¿Ya se atendió en otra sede?</h2>
      <p className="ayuda">La ficha es única en toda la organización. Buscala por email o teléfono completo para vincularla a tu sede sin duplicarla.</p>
      <form className="en-linea" role="search">
        <input name="contacto" defaultValue={contacto} placeholder="Email o teléfono completo" aria-label="Email o teléfono" maxLength={254} required />
        <button className="secundario">Buscar en la organización</button>
      </form>
      {errorBusqueda && <p className="alerta error">{errorBusqueda}</p>}
      {contacto && !errorBusqueda && !encontrados.length && <p className="ayuda">No hay clientes con ese contacto. Podés darla de alta abajo.</p>}
      {encontrados.map(c => <article key={c.id} className="fila">
        <div className="fila-cabecera"><h2>{c.nombre} {c.apellido}</h2></div>
        <Formulario accion={accionVincularCliente} boton="Vincular a la sede" className="en-linea">
          <input type="hidden" name="clienteId" value={c.id} />
          <SelectorSede sedes={sedes.filter(s => !c.sedes.some(v => v.sedeId === s.id))} elegida={sede?.id} />
        </Formulario>
      </article>)}

      <h2 className="subtitulo">Nuevo cliente</h2>
      <Formulario accion={accionCrearCliente} boton="Crear cliente">
        <SelectorSede sedes={sedes} elegida={sede?.id} />
        <CamposCliente />
      </Formulario>
    </>}
  </section>;
}
