import { contextoPanel } from "@/lib/contexto";
import { ROLES } from "@/lib/etiquetas";

export default async function Home() {
  const { sesion, asignaciones, sede } = await contextoPanel();
  return <section><p className="eyebrow">ADMINISTRACIÓN</p><h1>Hola, {sesion.usuario.nombre}.</h1>
    <div className="intro">
      <ul>{asignaciones?.map((a, i) => <li key={i}>{ROLES[a.rol] ?? a.rol}{a.sede ? ` · ${a.sede.nombre}` : a.franquiciado ? ` · ${a.franquiciado.nombre}` : ""}</li>)}
        {!asignaciones?.length && <li>Sin roles asignados: pedí acceso a un administrador.</li>}</ul>
      {sede && <p>Trabajando en <strong>{sede.nombre}</strong>.</p>}
    </div>
    <div className="modules">{[["01", "Sedes y equipo", "Organización, usuarios y acceso por sede.", "Disponible"], ["02", "Catálogo y agenda", "Servicios, profesionales y disponibilidad.", "Pendiente de implementación"], ["03", "Reservas y cobros", "Turnos, señas y seguimiento de pagos.", "Pendiente de implementación"]].map(([number, title, description, estado]) => <article key={number}><span className="number">{number}</span><h2>{title}</h2><p>{description}</p><small>{estado}</small></article>)}</div>
  </section>;
}
