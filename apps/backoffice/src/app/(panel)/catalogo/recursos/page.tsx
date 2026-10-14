import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraCatalogo } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Tipos de recurso · Sicurella" };

export default async function TiposRecurso() {
  const { cat, sede } = await cargarCatalogo();
  const nombres = new Map(cat.categorias.flatMap(c => c.servicios).map(s => [s.id, s.nombre]));
  return <section className="panel">
    <CabeceraCatalogo sede={sede?.nombre} accion={{ href: "/catalogo/recursos/nuevo", texto: "Nuevo tipo de recurso" }} />
    <p className="ayuda pie-tabla">Cabinas, camillas o equipos que un servicio ocupa durante el turno. Las unidades se cargan en cada sede{sede ? <> (<Link href={`/sedes/${sede.id}?seccion=recursos`}>recursos de {sede.nombre}</Link>)</> : ""}.</p>
    <div className="tabla">
      {cat.tiposRecurso.map(t => <article key={t.id} className="fila">
        <div className="fila-cabecera"><h2><Link href={`/catalogo/recursos/${t.id}`}>{t.nombre}</Link></h2>
          <span className="tag">{t._count.recursos} {t._count.recursos === 1 ? "unidad" : "unidades"} en sedes</span></div>
        <p>{t.requisitos.length ? `Lo ocupan ${t.requisitos.map(r => `${nombres.get(r.servicioId)}${r.cantidad > 1 ? ` (×${r.cantidad})` : ""}`).join(" · ")}` : "Ningún servicio lo ocupa"}</p>
      </article>)}
      {!cat.tiposRecurso.length && <p>Todavía no hay tipos de recurso.</p>}
    </div>
  </section>;
}
