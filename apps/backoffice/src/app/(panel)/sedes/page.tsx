import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarFranquiciados, listarSedes } from "@nailnet/database/access";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { ZONAS } from "@/lib/etiquetas";
import { accionCrearFranquiciado, accionCrearSede } from "../acciones";

export const metadata: Metadata = { title: "Sedes · Sicurella" };

/**
 * Listado de solo lectura de todas las sedes del alcance: cada una se edita desde su configuración.
 * La zona horaria se elige al crearla y después no se cambia (correría los turnos ya tomados).
 */
export default async function Sedes() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const sedes = await listarSedes(db(), actorId, organizacion.id, { incluirInactivas: puede.crearSedes });
  const franquiciados = puede.crearSedes ? await listarFranquiciados(db(), actorId, organizacion.id) : [];
  const activos = franquiciados.filter(f => f.activo && puede.crearSedeEn(f.id));

  return <section className="panel">
    <p className="eyebrow">ORGANIZACIÓN</p>
    <h1>Sedes</h1>

    <div className="tabla">
      {sedes.map(s => <Link key={s.id} href={`/sedes/${s.id}`} className={s.activo ? "fila fila-enlace" : "fila fila-enlace inactiva"}>
        <div className="fila-enlace-texto">
          <h2>{s.nombre}{s.id === sede?.id && <span className="tag">Elegida arriba</span>}</h2>
          <p>{s.franquiciado.nombre} · {s.timezone.replace(/_/g, " ")}</p>
        </div>
        <span className={s.activo ? "tag estado-confirmada" : "tag"}>{s.activo ? "Activa" : "Inactiva"}</span>
        <span className="boton secundario">Configurar</span>
      </Link>)}
      {!sedes.length && <p>No hay sedes en tu alcance.</p>}
    </div>

    {activos.length > 0 && <details className="desplegable">
      <summary>+ Nueva sede</summary>
      <Formulario accion={accionCrearSede} boton="Crear sede">
        <div className="grilla">
          <label>Nombre<input name="nombre" required maxLength={120} /></label>
          <label>Franquiciado<select name="franquiciadoId">{activos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select></label>
          <label>Zona horaria<select name="timezone" defaultValue={ZONAS[0]}>{ZONAS.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></label>
        </div>
        <p className="ayuda">La zona horaria no se puede cambiar después: elegí la de la ciudad donde está la sede.</p>
      </Formulario>
    </details>}

    {puede.administrarFranquiciados && <>
      <h2 className="subtitulo">Franquiciados</h2>
      <div className="tabla">
        {franquiciados.map(f => <article key={f.id} className={f.activo ? "fila" : "fila inactiva"}>
          <div className="fila-cabecera"><h2>{f.nombre}</h2><span className="tag">{f._count.sedes} {f._count.sedes === 1 ? "sede" : "sedes"}{f.activo ? "" : " · inactivo"}</span></div>
        </article>)}
        {!franquiciados.length && <p>Todavía no hay franquiciados.</p>}
      </div>
      <details className="desplegable">
        <summary>+ Nuevo franquiciado</summary>
        <Formulario accion={accionCrearFranquiciado} boton="Agregar franquiciado" className="en-linea">
          <input name="nombre" placeholder="Nombre comercial" required maxLength={120} aria-label="Nombre del franquiciado" />
        </Formulario>
      </details>
    </>}
  </section>;
}
