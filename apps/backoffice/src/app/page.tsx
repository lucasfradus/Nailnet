import { resumenAcceso } from "@nailnet/database/auth";
import { db } from "@/lib/db";
import { requerirSesion } from "@/lib/sesion";
import { salir } from "./acceso/actions";

const ROLES: Record<string, string> = { MASTER_FRANQUICIADOR: "Master franquiciador", FRANQUICIADO: "Franquiciado", ADMIN_SEDE: "Administración de sede", RECEPCIONISTA: "Recepción", PROFESIONAL: "Profesional" };

export default async function Home() {
  const { usuario } = await requerirSesion();
  const membresias = await resumenAcceso(db(), usuario.id);
  return <main><header><span className="brand">NailNet<span> / gestión</span></span>
    <form action={salir} className="usuario"><span>{usuario.nombre}</span><button className="secundario">Salir</button></form></header>
    <section><p className="eyebrow">ADMINISTRACIÓN</p><h1>Hola, {usuario.nombre}.</h1>
      <div className="intro">{membresias.map(m => <div key={m.organizacion.id}><strong>{m.organizacion.nombre}</strong>
        <ul>{m.asignaciones.map((a, i) => <li key={i}>{ROLES[a.rol] ?? a.rol}{a.sede ? ` · ${a.sede.nombre}` : a.franquiciado ? ` · ${a.franquiciado.nombre}` : ""}</li>)}
          {!m.asignaciones.length && <li>Sin roles asignados: pedí acceso a un administrador.</li>}</ul></div>)}</div>
      <div className="modules">{[["01", "Sedes y equipo", "Organización, usuarios y acceso por sede."], ["02", "Catálogo y agenda", "Servicios, profesionales y disponibilidad."], ["03", "Reservas y cobros", "Turnos, señas y seguimiento de pagos."]].map(([number, title, description]) => <article key={number}><span className="number">{number}</span><h2>{title}</h2><p>{description}</p><small>Pendiente de implementación</small></article>)}</div></section><footer>Base técnica inicial · Sin datos operativos</footer></main>;
}
