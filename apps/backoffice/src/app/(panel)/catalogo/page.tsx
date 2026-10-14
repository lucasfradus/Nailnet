import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { catalogoSede, listarCatalogo } from "@nailnet/database/catalogo";
import { Formulario } from "@/components/formulario";
import { CamposSena, ServiciosSede, textoSena } from "@/components/catalogo";
import { EditorImagen } from "@/components/imagen";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearCategoria, accionCrearSkill, accionCrearTipoRecurso, accionGuardarServicio, accionImagenServicio } from "../acciones";

export const metadata: Metadata = { title: "Catálogo · Sicurella" };

type Catalogo = Awaited<ReturnType<typeof listarCatalogo>>;
type ServicioCat = Catalogo["categorias"][number]["servicios"][number];

function FormServicio({ cat, servicio }: { cat: Catalogo; servicio?: ServicioCat }) {
  return <Formulario accion={accionGuardarServicio} boton={servicio ? "Guardar servicio" : "Crear servicio"}>
    {servicio && <input type="hidden" name="servicioId" value={servicio.id} />}
    <div className="grilla">
      <label>Nombre<input name="nombre" required maxLength={120} defaultValue={servicio?.nombre} /></label>
      <label>Categoría<select name="categoriaId" defaultValue={servicio?.categoriaId}>{cat.categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label>Duración (min)<input name="duracionMinutos" type="number" min={5} max={480} step={5} required defaultValue={servicio?.duracionMinutos ?? 50} /></label>
      <label>Preparación antes (min)<input name="bufferAntesMinutos" type="number" min={0} max={120} step={5} defaultValue={servicio?.bufferAntesMinutos ?? 0} /></label>
      <label>Preparación después (min)<input name="bufferDespuesMinutos" type="number" min={0} max={120} step={5} defaultValue={servicio?.bufferDespuesMinutos ?? 0} /></label>
      <label>Seña por defecto<span className="en-linea sin-margen"><CamposSena sena={servicio?.sena ?? null} heredar="Sin definir" /></span></label>
    </div>
    <label>Descripción<textarea name="descripcion" rows={2} maxLength={1000} defaultValue={servicio?.descripcion ?? ""} /></label>
    {cat.skills.length > 0 && <fieldset><legend>Habilidades requeridas (todas)</legend>{cat.skills.map(s => <label key={s.id} className="check"><input type="checkbox" name="skillId" value={s.id} defaultChecked={servicio?.skills.some(x => x.skillId === s.id)} />{s.nombre}</label>)}</fieldset>}
    {cat.tiposRecurso.length > 0 && <fieldset><legend>Recursos que ocupa</legend>{cat.tiposRecurso.map(t => <label key={t.id} className="check">
      <input type="hidden" name="tipoRecursoId" value={t.id} />{t.nombre}
      <input type="number" name={`cantidad_${t.id}`} min={0} max={10} defaultValue={servicio?.recursos.find(r => r.tipoRecursoId === t.id)?.cantidad ?? 0} aria-label={`Cantidad de ${t.nombre}`} className="corto" />
    </label>)}</fieldset>}
    {cat.consentimientos.length > 0 && <fieldset><legend>Consentimientos que exige</legend>{cat.consentimientos.map(c => <label key={c.clave} className="check"><input type="checkbox" name="consentimiento" value={c.clave} defaultChecked={servicio?.consentimientos.some(x => x.clave === c.clave)} />{c.titulo}</label>)}</fieldset>}
    {servicio && <label className="check"><input type="checkbox" name="activo" defaultChecked={servicio.activo} />Activo</label>}
  </Formulario>;
}

export default async function Catalogo() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const sedeId = sede?.id;
  const enSede = sedeId ? await catalogoSede(db(), actorId, organizacion.id, sedeId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  if (sedeId && !enSede) notFound();
  const cat = puede.administrarCatalogo ? await listarCatalogo(db(), actorId, organizacion.id) : null;
  const nombreSede = sede?.nombre;

  return <section className="panel">
    <p className="eyebrow">CATÁLOGO{nombreSede ? ` · ${nombreSede.toUpperCase()}` : ""}</p><h1>Servicios</h1>

    {!sedeId && <p className="intro">No tenés sedes asignadas: abajo está el catálogo común de la organización.</p>}

    {enSede && sedeId && <ServiciosSede sedeId={sedeId} datos={enSede} />}

    {cat && <>
      <h2 className="subtitulo">Catálogo de la organización</h2>
      <p className="ayuda">Servicios, habilidades, recursos y consentimientos son comunes a todas las sedes (propuesta D12). Cada sede define su precio. La política de seña (D3) sigue pendiente: un servicio sin seña definida no se ofrece online.</p>
      {cat.categorias.map(c => <div key={c.id}><h3>{c.nombre}</h3>
        {c.servicios.map(s => <details key={s.id} className="fila"><summary>{s.nombre} · {s.duracionMinutos} min · seña {textoSena(s.sena)}{s.activo ? "" : " · inactivo"}{s.imagenId ? "" : " · sin imagen"}</summary>
          <EditorImagen accion={accionImagenServicio} ocultos={{ servicioId: s.id }} imagenId={s.imagenId} titulo={`Imagen de ${s.nombre}`} />
          <FormServicio cat={cat} servicio={s} /></details>)}
      </div>)}
      {cat.categorias.length > 0 && <details><summary>Nuevo servicio</summary><FormServicio cat={cat} /></details>}
      <div className="grilla">
        <Formulario accion={accionCrearCategoria} boton="Agregar categoría" className="en-linea"><input name="nombre" placeholder="Categoría" required maxLength={60} aria-label="Nueva categoría" /></Formulario>
        <Formulario accion={accionCrearSkill} boton="Agregar habilidad" className="en-linea"><input name="nombre" placeholder="Habilidad" required maxLength={60} aria-label="Nueva habilidad" /></Formulario>
        <Formulario accion={accionCrearTipoRecurso} boton="Agregar tipo de recurso" className="en-linea"><input name="nombre" placeholder="Cabina, láser…" required maxLength={60} aria-label="Nuevo tipo de recurso" /></Formulario>
      </div>
    </>}
  </section>;
}
