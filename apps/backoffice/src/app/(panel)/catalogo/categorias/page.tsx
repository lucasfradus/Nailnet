import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraCatalogo } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Categorías · Sicurella" };

export default async function Categorias() {
  const { cat, sede } = await cargarCatalogo();
  return <section className="panel">
    <CabeceraCatalogo sede={sede?.nombre} accion={{ href: "/catalogo/categorias/nueva", texto: "Nueva categoría" }} />
    <p className="ayuda pie-tabla">Agrupan los servicios. Se listan de menor a mayor orden.</p>
    <div className="tabla">
      {cat.categorias.map(c => <article key={c.id} className="fila">
        <div className="fila-cabecera"><h2><Link href={`/catalogo/categorias/${c.id}`}>{c.nombre}</Link></h2><span className="tag">Orden {c.orden}</span></div>
        <p>{c.servicios.length ? c.servicios.map(s => s.nombre).join(" · ") : "Sin servicios"}</p>
      </article>)}
      {!cat.categorias.length && <p>Todavía no hay categorías.</p>}
    </div>
  </section>;
}
