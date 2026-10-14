import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraCatalogo } from "@/components/catalogo";
import { cargarCatalogo } from "@/lib/catalogo";

export const metadata: Metadata = { title: "Habilidades · Sicurella" };

export default async function Habilidades() {
  const { cat, sede } = await cargarCatalogo();
  const nombres = new Map(cat.categorias.flatMap(c => c.servicios).map(s => [s.id, s.nombre]));
  return <section className="panel">
    <CabeceraCatalogo sede={sede?.nombre} accion={{ href: "/catalogo/habilidades/nueva", texto: "Nueva habilidad" }} />
    <p className="ayuda pie-tabla">Un profesional atiende un servicio solo si tiene todas las habilidades que requiere.</p>
    <div className="tabla">
      {cat.skills.map(s => <article key={s.id} className="fila">
        <div className="fila-cabecera"><h2><Link href={`/catalogo/habilidades/${s.id}`}>{s.nombre}</Link></h2>
          <span className="tag">{s._count.profesionales} {s._count.profesionales === 1 ? "profesional" : "profesionales"}</span></div>
        <p>{s.servicios.length ? `Requerida por ${s.servicios.map(x => nombres.get(x.servicioId)).join(" · ")}` : "Ningún servicio la requiere"}</p>
      </article>)}
      {!cat.skills.length && <p>Todavía no hay habilidades.</p>}
    </div>
  </section>;
}
