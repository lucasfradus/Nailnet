import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { listarProfesionales } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearProfesional } from "../acciones";

export const metadata: Metadata = { title: "Profesionales · Sicurella" };

export default async function Profesionales() {
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const lista = await listarProfesionales(db(), sesion.usuario.id, organizacion.id, { sedeId: sede?.id }).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!lista) notFound();
  return <section className="panel">
    <p className="eyebrow">EQUIPO{sede ? ` · ${sede.nombre.toUpperCase()}` : ""}</p><h1>Profesionales</h1>
    <div className="tabla">
      {lista.map(p => <article key={p.id} className={p.activo ? "fila" : "fila inactiva"}>
        <div className="fila-cabecera"><h2><Link href={`/profesionales/${p.id}`}>{p.nombre} {p.apellido}</Link></h2><span className="tag">{p.activo ? p.sedes.map(s => s.nombre).join(" · ") : "Inactivo"}</span></div>
        <p>{p.skills.join(" · ") || "Sin habilidades cargadas"}</p>
      </article>)}
      {!lista.length && <p>No hay profesionales en tu alcance.</p>}
    </div>
    {puede.editarSedes && sedes.length > 0 && <>
      <h2 className="subtitulo">Nuevo profesional</h2>
      <Formulario accion={accionCrearProfesional} boton="Crear profesional" className="en-linea">
        <input name="nombre" placeholder="Nombre" required maxLength={80} aria-label="Nombre" />
        <input name="apellido" placeholder="Apellido" maxLength={80} aria-label="Apellido" />
        {sede ? <input type="hidden" name="sedeId" value={sede.id} /> : <select name="sedeId" aria-label="Sede">{sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>}
      </Formulario>
      <p className="ayuda">La ficha es de la organización: un mismo profesional puede trabajar en varias sedes sin duplicarse.</p>
    </>}
  </section>;
}
