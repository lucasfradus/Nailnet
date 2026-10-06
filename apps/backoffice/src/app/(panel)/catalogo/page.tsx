import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import type { Sena } from "@nailnet/domain/catalogo";
import { catalogoSede, listarCatalogo } from "@nailnet/database/catalogo";
import { Formulario } from "@/components/formulario";
import { EditorImagen } from "@/components/imagen";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearCategoria, accionCrearSkill, accionCrearTipoRecurso, accionGuardarServicio, accionImagenServicio, accionServicioSede } from "../acciones";

export const metadata: Metadata = { title: "Catálogo · Sicurella" };
const pesos = (v: string | null) => v === null ? "—" : `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const textoSena = (s: Sena) => !s ? "sin definir" : s.tipo === "NINGUNA" ? "sin seña" : s.tipo === "FIJA" ? pesos(s.valor) : `${s.valor}%`;

function CamposSena({ sena, heredar }: { sena: Sena; heredar: string }) {
  return <>
    <select name="senaTipo" defaultValue={sena?.tipo ?? ""} aria-label="Tipo de seña">
      <option value="">{heredar}</option><option value="NINGUNA">Sin seña</option><option value="FIJA">Monto fijo</option><option value="PORCENTAJE">Porcentaje</option>
    </select>
    <input name="senaValor" defaultValue={sena?.valor ?? ""} placeholder="Valor" aria-label="Valor de la seña" inputMode="decimal" size={8} />
  </>;
}

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

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ sede?: string }> }) {
  const { sede: sedeParam } = await searchParams;
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const sedeId = sedeParam ?? sede?.id ?? (sedes.length === 1 ? sedes[0]!.id : undefined);
  const enSede = sedeId ? await catalogoSede(db(), actorId, organizacion.id, sedeId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  if (sedeId && !enSede) notFound();
  const cat = puede.administrarCatalogo ? await listarCatalogo(db(), actorId, organizacion.id) : null;
  const nombreSede = sedes.find(s => s.id === sedeId)?.nombre;

  return <section className="panel">
    <p className="eyebrow">CATÁLOGO{nombreSede ? ` · ${nombreSede.toUpperCase()}` : ""}</p><h1>Servicios</h1>

    {!sedeId && <><p className="intro">Elegí una sede para ver precios y condiciones:</p>
      <ul className="lista">{sedes.map(s => <li key={s.id}><Link href={`/catalogo?sede=${s.id}`}>{s.nombre}</Link></li>)}</ul></>}

    {enSede && <div className="tabla">
      {enSede.servicios.map(s => <article key={s.id} className={s.efectivo.habilitado ? "fila" : "fila inactiva"}>
        <div className="fila-cabecera"><h2>{s.nombre}</h2><span className="tag">{s.efectivo.reservableOnline ? "Online" : s.efectivo.habilitado ? "Solo recepción" : "No disponible"}</span></div>
        <p>{s.categoria} · {s.efectivo.duracionMinutos} min · {pesos(s.efectivo.precio)} · seña {s.efectivo.sena === null ? "sin definir" : pesos(s.efectivo.sena)}
          {s.efectivo.motivosSinOnline.length > 0 && ` · ${s.efectivo.motivosSinOnline.join(", ")}`}</p>
        {enSede.puedeEditar && s.activo && <details><summary>Condiciones en esta sede</summary>
          <Formulario accion={accionServicioSede} boton="Guardar" className="en-linea">
            <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="servicioId" value={s.id} />
            <label className="check"><input type="checkbox" name="habilitado" defaultChecked={s.enSede?.habilitado} />Habilitado</label>
            <input name="precio" defaultValue={s.enSede?.precio ?? ""} placeholder="Precio" aria-label="Precio" inputMode="decimal" size={10} />
            <input name="duracionMinutos" type="number" min={5} max={480} step={5} defaultValue={s.enSede?.duracionMinutos ?? ""} placeholder={`${s.duracionBase} min`} aria-label="Duración en esta sede" className="corto" />
            <CamposSena sena={s.enSede?.sena ?? null} heredar={`Del servicio (${textoSena(s.senaBase)})`} />
            <label className="check"><input type="checkbox" name="reservableOnline" defaultChecked={s.enSede?.reservableOnline ?? true} />Reservable online</label>
          </Formulario>
        </details>}
      </article>)}
      {!enSede.servicios.length && <p>La organización todavía no cargó servicios.</p>}
    </div>}

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
