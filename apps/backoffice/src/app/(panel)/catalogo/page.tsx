import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { catalogoSede, listarCatalogo } from "@nailnet/database/catalogo";
import { listarMediosPago } from "@nailnet/database/medios-pago";
import { CabeceraCatalogo, TablaPrecios, type FilaPrecio } from "@/components/catalogo";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";

export const metadata: Metadata = { title: "Servicios y precios · Sicurella" };

const sinAcceso = (e: unknown): null => { if (e instanceof AccesoDenegado) return null; throw e; };

/**
 * Servicios y precios: el catálogo de la organización y, con una sede elegida en la barra, su precio de lista
 * y lo que sale con cada medio de pago de esa sede. Sin permiso sobre el catálogo global se ve solo lo de la sede.
 */
export default async function Catalogo({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const { editar } = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;

  const [enSede, medios] = sede ? await Promise.all([
    catalogoSede(db(), actorId, organizacion.id, sede.id).catch(sinAcceso),
    listarMediosPago(db(), actorId, organizacion.id, sede.id).catch(sinAcceso),
  ]) : [null, null];
  const deSede = new Map(enSede?.servicios.map(s => [s.id, s]));
  const sedeTabla = sede && enSede ? { id: sede.id, nombre: sede.nombre } : null;
  const ayudaMedios = sedeTabla && <>Lo que se cobra con cada medio de pago sale del ajuste definido en <Link href={`/sedes/${sedeTabla.id}?seccion=medios`}>medios de pago de {sedeTabla.nombre}</Link>.</>;

  // Sin permiso sobre el catálogo global: solo los servicios con sus condiciones en la sede elegida.
  if (!puede.administrarCatalogo) {
    if (!sede || !enSede) notFound();
    const grupos = new Map<string, FilaPrecio[]>();
    for (const s of enSede.servicios) {
      if (!grupos.has(s.categoria)) grupos.set(s.categoria, []);
      grupos.get(s.categoria)!.push({ id: s.id, nombre: s.nombre, activo: s.activo, duracionBase: s.duracionBase, senaBase: s.senaBase, enSede: s });
    }
    return <section className="panel">
      <p className="eyebrow">CATÁLOGO · {sede.nombre.toUpperCase()}</p><h1>Servicios y precios</h1>
      <p className="ayuda pie-tabla">{enSede.servicios.length} servicios en {sede.nombre}. {ayudaMedios}</p>
      <TablaPrecios grupos={[...grupos].map(([categoria, filas]) => ({ categoria, filas }))} sede={sedeTabla} medios={medios} puedeEditar={enSede.puedeEditar} editar={editar} />
      {!enSede.servicios.length && <p>La organización todavía no cargó servicios.</p>}
    </section>;
  }

  const cat = await listarCatalogo(db(), actorId, organizacion.id);
  const skills = new Map(cat.skills.map(s => [s.id, s.nombre]));
  const tipos = new Map(cat.tiposRecurso.map(t => [t.id, t.nombre]));
  const total = cat.categorias.reduce((n, c) => n + c.servicios.length, 0);
  const detalle = (s: typeof cat.categorias[number]["servicios"][number]) => [
    s.bufferAntesMinutos + s.bufferDespuesMinutos ? `+${s.bufferAntesMinutos + s.bufferDespuesMinutos} min de preparación` : "",
    s.skills.length ? `requiere ${s.skills.map(x => skills.get(x.skillId)).join(", ")}` : "",
    s.recursos.length ? `ocupa ${s.recursos.map(r => `${r.cantidad} ${tipos.get(r.tipoRecursoId)}`).join(", ")}` : "",
    s.imagenId ? "" : "sin imagen",
  ].filter(Boolean).join(" · ");
  const grupos = cat.categorias.map(c => ({
    categoria: c.nombre,
    filas: c.servicios.map((s): FilaPrecio => ({
      id: s.id, nombre: s.nombre, activo: s.activo, duracionBase: s.duracionMinutos, senaBase: s.sena,
      detalle: detalle(s) || undefined, enlace: `/catalogo/servicios/${s.id}`, enSede: deSede.get(s.id),
    })),
  }));

  return <section className="panel">
    <CabeceraCatalogo accion={cat.categorias.length ? { href: "/catalogo/servicios/nuevo", texto: "Nuevo servicio" } : { href: "/catalogo/categorias/nueva", texto: "Nueva categoría" }} />
    <p className="ayuda pie-tabla">{total} servicios. El catálogo es común a todas las sedes; precio, duración y seña se ajustan en cada sede{sedeTabla
      ? <> (acá, los de <strong>{sedeTabla.nombre}</strong>). {ayudaMedios}</>
      : ". Elegí una sede en la barra de arriba para ver y editar sus precios."}</p>
    {!cat.categorias.length && <p className="intro">Para cargar servicios primero creá al menos una categoría (por ejemplo «Manos» o «Pestañas»).</p>}
    <TablaPrecios grupos={grupos} sede={sedeTabla} medios={medios} puedeEditar={!!enSede?.puedeEditar} editar={editar} />
  </section>;
}
