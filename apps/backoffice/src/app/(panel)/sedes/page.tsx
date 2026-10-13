import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarFranquiciados, listarSedes } from "@nailnet/database/access";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { SelectorZona } from "@/components/zona";
import { accionCrearFranquiciado, accionCrearSede } from "../acciones";

export const metadata: Metadata = { title: "Sedes · Sicurella" };

export default async function Sedes() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const todas = await listarSedes(db(), actorId, organizacion.id, { incluirInactivas: puede.crearSedes });
  // Las inactivas no se pueden elegir arriba: se listan siempre para poder entrar a reactivarlas.
  const sedes = sede ? todas.filter(s => s.id === sede.id || !s.activo) : todas;
  const franquiciados = puede.crearSedes ? await listarFranquiciados(db(), actorId, organizacion.id) : [];
  const activos = franquiciados.filter(f => f.activo && puede.crearSedeEn(f.id));

  return <section className="panel">
    <p className="eyebrow">ORGANIZACIÓN</p><h1>Sedes</h1>
    <div className="tabla">
      {sedes.map(s => <article key={s.id} className={s.activo ? "fila" : "fila inactiva"}>
        <div className="fila-cabecera"><h2><Link href={`/sedes/${s.id}`}>{s.nombre}</Link></h2><span className="tag">{s.activo ? "Activa" : "Inactiva"}</span></div>
        <p>{s.franquiciado.nombre} · {s.timezone.replace(/_/g, " ")} · <Link href={`/sedes/${s.id}`}>Ver configuración</Link></p>
      </article>)}
      {!sedes.length && <p>No hay sedes en tu alcance.</p>}
    </div>

    {activos.length > 0 && <>
      <h2 className="subtitulo">Nueva sede</h2>
      <Formulario accion={accionCrearSede} boton="Crear sede" className="en-linea">
        <input name="nombre" placeholder="Nombre" required maxLength={120} aria-label="Nombre" />
        <select name="franquiciadoId" aria-label="Franquiciado">{activos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
        <SelectorZona />
      </Formulario>
    </>}

    {puede.administrarFranquiciados && <>
      <h2 className="subtitulo">Franquiciados</h2>
      <ul className="lista">{franquiciados.map(f => <li key={f.id}>{f.nombre} · {f._count.sedes} {f._count.sedes === 1 ? "sede" : "sedes"}{f.activo ? "" : " · inactivo"}</li>)}</ul>
      <Formulario accion={accionCrearFranquiciado} boton="Agregar franquiciado" className="en-linea">
        <input name="nombre" placeholder="Nombre comercial" required maxLength={120} aria-label="Nombre del franquiciado" />
      </Formulario>
    </>}
  </section>;
}
