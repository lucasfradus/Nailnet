import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { catalogoSede, listarCatalogo } from "@nailnet/database/catalogo";
import { CabeceraCatalogo, ServiciosSede, textoSena } from "@/components/catalogo";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";

export const metadata: Metadata = { title: "Catálogo · Sicurella" };

export default async function Catalogo() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;

  // Sin permiso sobre el catálogo global, la pantalla es la de precios de la sede elegida.
  if (!puede.administrarCatalogo) {
    const enSede = sede ? await catalogoSede(db(), actorId, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
    if (!sede || !enSede) notFound();
    return <section className="panel">
      <p className="eyebrow">CATÁLOGO · {sede.nombre.toUpperCase()}</p><h1>Servicios</h1>
      <ServiciosSede sedeId={sede.id} datos={enSede} />
    </section>;
  }

  const cat = await listarCatalogo(db(), actorId, organizacion.id);
  const skills = new Map(cat.skills.map(s => [s.id, s.nombre]));
  const tipos = new Map(cat.tiposRecurso.map(t => [t.id, t.nombre]));
  const total = cat.categorias.reduce((n, c) => n + c.servicios.length, 0);

  return <section className="panel">
    <CabeceraCatalogo sede={sede?.nombre} accion={cat.categorias.length ? { href: "/catalogo/servicios/nuevo", texto: "Nuevo servicio" } : { href: "/catalogo/categorias/nueva", texto: "Nueva categoría" }} />
    <p className="ayuda pie-tabla">{total} servicios. El catálogo es común a todas las sedes; cada sede define su precio{sede ? <> (<Link href="/catalogo/precios">precios en {sede.nombre}</Link>)</> : ""}.</p>
    {!cat.categorias.length && <p className="intro">Para cargar servicios primero creá al menos una categoría (por ejemplo «Manos» o «Pestañas»).</p>}
    {cat.categorias.map(c => <div key={c.id}>
      <h2 className="subtitulo">{c.nombre} <span className="tag">{c.servicios.length}</span></h2>
      <div className="tabla">
        {c.servicios.map(s => <article key={s.id} className={s.activo ? "fila" : "fila inactiva"}>
          <div className="fila-cabecera"><h2><Link href={`/catalogo/servicios/${s.id}`}>{s.nombre}</Link></h2>
            <span className="tag">{s.activo ? `Seña ${textoSena(s.sena)}` : "Inactivo"}</span></div>
          <p>{s.duracionMinutos} min{s.bufferAntesMinutos + s.bufferDespuesMinutos ? ` (+${s.bufferAntesMinutos + s.bufferDespuesMinutos} de preparación)` : ""}
            {s.skills.length > 0 && ` · requiere ${s.skills.map(x => skills.get(x.skillId)).join(", ")}`}
            {s.recursos.length > 0 && ` · ocupa ${s.recursos.map(r => `${r.cantidad} ${tipos.get(r.tipoRecursoId)}`).join(", ")}`}
            {s.imagenId ? "" : " · sin imagen"}</p>
        </article>)}
        {!c.servicios.length && <p>Sin servicios en esta categoría.</p>}
      </div>
    </div>)}
  </section>;
}
