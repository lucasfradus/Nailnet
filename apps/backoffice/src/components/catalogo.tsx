import Link from "next/link";
import type { Sena } from "@nailnet/domain/catalogo";
import type { catalogoSede, listarCatalogo } from "@nailnet/database/catalogo";
import { Formulario } from "./formulario";
import { CamposSena } from "./campos-sena";
import { Pestanas } from "./pestanas";
import { accionGuardarCategoria, accionGuardarServicio, accionGuardarSkill, accionGuardarTipoRecurso, accionServicioSede } from "@/app/(panel)/acciones";

export const pesos = (v: string | null) => v === null ? "—" : `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const textoSena = (s: Sena) => !s ? "sin definir" : s.tipo === "NINGUNA" ? "sin seña" : s.tipo === "FIJA" ? pesos(s.valor) : `${s.valor}%`;

export type Catalogo = Awaited<ReturnType<typeof listarCatalogo>>;
export type ServicioCat = Catalogo["categorias"][number]["servicios"][number];
type Skill = Catalogo["skills"][number];
type TipoRecurso = Catalogo["tiposRecurso"][number];
type Categoria = Catalogo["categorias"][number];

/** Encabezado de las pestañas del catálogo, con el alta de la pestaña como acción principal. */
export function CabeceraCatalogo({ accion, sede }: { accion?: { href: string; texto: string }; sede?: string }) {
  return <>
    <p className="eyebrow">CATÁLOGO DE LA ORGANIZACIÓN</p>
    <div className="fila-cabecera"><h1>Catálogo</h1>{accion && <Link className="boton" href={accion.href}>+ {accion.texto}</Link>}</div>
    <Pestanas base="/catalogo" etiqueta="Secciones del catálogo" items={[
      { ruta: "", etiqueta: "Servicios" }, { ruta: "categorias", etiqueta: "Categorías" },
      { ruta: "habilidades", etiqueta: "Habilidades" }, { ruta: "recursos", etiqueta: "Tipos de recurso" },
      ...sede ? [{ ruta: "precios", etiqueta: `Precios en ${sede}` }] : [],
    ]} />
  </>;
}

/** Encabezado de una página de alta o edición, con vuelta a su pestaña. */
export function CabeceraFicha({ volver, seccion, titulo }: { volver: string; seccion: string; titulo: string }) {
  return <>
    <p className="eyebrow"><Link href="/catalogo">CATÁLOGO</Link> · <Link href={volver}>{seccion.toUpperCase()}</Link></p>
    <h1>{titulo}</h1>
  </>;
}

const servicios = (cat: Catalogo) => cat.categorias.flatMap(c => c.servicios.map(s => ({ ...s, categoria: c.nombre })));

export function FormServicio({ cat, servicio }: { cat: Catalogo; servicio?: ServicioCat }) {
  return <Formulario accion={accionGuardarServicio} boton={servicio ? "Guardar cambios" : "Crear servicio"} className="formulario ficha-form">
    {servicio && <input type="hidden" name="servicioId" value={servicio.id} />}
    <section className="form-seccion"><h2>Datos generales</h2>
      <div className="grilla">
        <label>Nombre<input name="nombre" required maxLength={120} defaultValue={servicio?.nombre} placeholder="Esmaltado semipermanente" /></label>
        <label>Categoría<select name="categoriaId" required defaultValue={servicio?.categoriaId}>{cat.categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      </div>
      <label><span>Descripción <span className="opcional">(opcional)</span></span><textarea name="descripcion" rows={3} maxLength={1000} defaultValue={servicio?.descripcion ?? ""} /></label>
    </section>

    <section className="form-seccion"><h2>Tiempos</h2>
      <p className="ayuda">La preparación antes y después reserva al profesional y los recursos alrededor del turno. Cada sede puede ajustar la duración.</p>
      <div className="grilla">
        <label>Duración (min)<input name="duracionMinutos" type="number" min={5} max={480} step={5} required defaultValue={servicio?.duracionMinutos ?? 50} /></label>
        <label>Preparación antes (min)<input name="bufferAntesMinutos" type="number" min={0} max={120} step={5} defaultValue={servicio?.bufferAntesMinutos ?? 0} /></label>
        <label>Preparación después (min)<input name="bufferDespuesMinutos" type="number" min={0} max={120} step={5} defaultValue={servicio?.bufferDespuesMinutos ?? 0} /></label>
      </div>
    </section>

    <section className="form-seccion"><h2>Seña por defecto</h2>
      <p className="ayuda">Monto fijo en pesos o porcentaje del precio de cada sede; una sede puede definir la suya. Un servicio sin seña definida no se ofrece online.</p>
      <div className="grilla"><CamposSena sena={servicio?.sena ?? null} heredar="Sin definir" /></div>
    </section>

    <section className="form-seccion"><h2>Requisitos</h2>
      <fieldset><legend>Habilidades requeridas (el profesional debe tenerlas todas)</legend>
        {cat.skills.map(s => <label key={s.id} className="check"><input type="checkbox" name="skillId" value={s.id} defaultChecked={servicio?.skills.some(x => x.skillId === s.id)} />{s.nombre}</label>)}
        {!cat.skills.length && <span className="ayuda">Todavía no hay habilidades. <Link href="/catalogo/habilidades/nueva">Crear una</Link>.</span>}
      </fieldset>
      <fieldset><legend>Recursos que ocupa (unidades)</legend>
        {cat.tiposRecurso.map(t => <label key={t.id} className="check">
          <input type="hidden" name="tipoRecursoId" value={t.id} />
          <input type="number" name={`cantidad_${t.id}`} min={0} max={10} defaultValue={servicio?.recursos.find(r => r.tipoRecursoId === t.id)?.cantidad ?? 0} aria-label={`Unidades de ${t.nombre}`} className="corto" />{t.nombre}
        </label>)}
        {!cat.tiposRecurso.length && <span className="ayuda">Todavía no hay tipos de recurso. <Link href="/catalogo/recursos/nuevo">Crear uno</Link>.</span>}
      </fieldset>
      <fieldset><legend>Consentimientos que exige</legend>
        {cat.consentimientos.map(c => <label key={c.clave} className="check"><input type="checkbox" name="consentimiento" value={c.clave} defaultChecked={servicio?.consentimientos.some(x => x.clave === c.clave)} />{c.titulo}</label>)}
        {!cat.consentimientos.length && <span className="ayuda">No hay consentimientos de práctica publicados. <Link href="/consentimientos">Ver consentimientos</Link>.</span>}
      </fieldset>
    </section>

    {servicio && <section className="form-seccion"><h2>Estado</h2>
      <label className="check"><input type="checkbox" name="activo" defaultChecked={servicio.activo} />Activo (un servicio inactivo no se ofrece en ninguna sede)</label>
    </section>}
  </Formulario>;
}

export function FormCategoria({ categoria }: { categoria?: Categoria }) {
  return <Formulario accion={accionGuardarCategoria} boton={categoria ? "Guardar cambios" : "Crear categoría"} className="formulario ficha-form">
    {categoria && <input type="hidden" name="categoriaId" value={categoria.id} />}
    <div className="grilla">
      <label>Nombre<input name="nombre" required maxLength={60} defaultValue={categoria?.nombre} placeholder="Manos, Pestañas, Faciales…" /></label>
      <label>Orden<input name="orden" type="number" min={-9999} max={9999} step={1} defaultValue={categoria?.orden ?? 0} /></label>
    </div>
    <p className="ayuda">Las categorías agrupan los servicios en el backoffice y en la reserva online; se listan de menor a mayor orden.</p>
  </Formulario>;
}

export function FormSkill({ cat, skill }: { cat: Catalogo; skill?: Skill }) {
  const lista = servicios(cat);
  return <Formulario accion={accionGuardarSkill} boton={skill ? "Guardar cambios" : "Crear habilidad"} className="formulario ficha-form">
    {skill && <input type="hidden" name="skillId" value={skill.id} />}
    <label>Nombre<input name="nombre" required maxLength={60} defaultValue={skill?.nombre} placeholder="Semipermanente, Lifting…" /></label>
    <fieldset><legend>Servicios que la requieren</legend>
      {lista.map(s => <label key={s.id} className="check"><input type="checkbox" name="servicioId" value={s.id} defaultChecked={skill?.servicios.some(x => x.servicioId === s.id)} />{s.nombre}<span className="ayuda">· {s.categoria}</span></label>)}
      {!lista.length && <span className="ayuda">Todavía no hay servicios.</span>}
    </fieldset>
    <p className="ayuda">Solo pueden atender un servicio los profesionales con todas sus habilidades. Las habilidades de cada profesional se asignan en su ficha.</p>
  </Formulario>;
}

export function FormTipoRecurso({ cat, tipo }: { cat: Catalogo; tipo?: TipoRecurso }) {
  const lista = servicios(cat);
  return <Formulario accion={accionGuardarTipoRecurso} boton={tipo ? "Guardar cambios" : "Crear tipo de recurso"} className="formulario ficha-form">
    {tipo && <input type="hidden" name="tipoRecursoId" value={tipo.id} />}
    <label>Nombre<input name="nombre" required maxLength={60} defaultValue={tipo?.nombre} placeholder="Cabina, Camilla, Láser…" /></label>
    <fieldset><legend>Servicios que lo ocupan (unidades por turno)</legend>
      {lista.map(s => <label key={s.id} className="check">
        <input type="hidden" name="servicioId" value={s.id} />
        <input type="number" name={`cantidad_${s.id}`} min={0} max={10} defaultValue={tipo?.requisitos.find(r => r.servicioId === s.id)?.cantidad ?? 0} aria-label={`Unidades para ${s.nombre}`} className="corto" />{s.nombre}<span className="ayuda">· {s.categoria}</span>
      </label>)}
      {!lista.length && <span className="ayuda">Todavía no hay servicios.</span>}
    </fieldset>
    <p className="ayuda">Las unidades concretas (Cabina 1, Cabina 2…) se cargan en cada sede, en la pestaña Recursos. Un servicio que ocupa este tipo solo se ofrece si la sede tiene unidades libres.</p>
  </Formulario>;
}

/** Servicios del catálogo con sus condiciones en una sede: precio, duración, seña y si se ofrece online. */
export function ServiciosSede({ sedeId, datos }: { sedeId: string; datos: Awaited<ReturnType<typeof catalogoSede>> }) {
  return <div className="tabla">
    {datos.servicios.map(s => <article key={s.id} className={s.efectivo.habilitado ? "fila" : "fila inactiva"}>
      <div className="fila-cabecera"><h2>{s.nombre}</h2><span className="tag">{s.efectivo.reservableOnline ? "Online" : s.efectivo.habilitado ? "Solo recepción" : "No disponible"}</span></div>
      <p>{s.categoria} · {s.efectivo.duracionMinutos} min · {pesos(s.efectivo.precio)} · seña {s.efectivo.sena === null ? "sin definir" : pesos(s.efectivo.sena)}
        {s.efectivo.motivosSinOnline.length > 0 && ` · ${s.efectivo.motivosSinOnline.join(", ")}`}</p>
      {datos.puedeEditar && s.activo && <details><summary>Condiciones en esta sede</summary>
        <Formulario accion={accionServicioSede} boton="Guardar" className="en-linea">
          <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="servicioId" value={s.id} />
          <label className="campo">Precio<span className="con-unidad" data-unidad="$"><input name="precio" defaultValue={s.enSede?.precio ?? ""} placeholder="30000" inputMode="decimal" /></span></label>
          <label className="campo">Duración (min)<input name="duracionMinutos" type="number" min={5} max={480} step={5} defaultValue={s.enSede?.duracionMinutos ?? ""} placeholder={`${s.duracionBase} (del servicio)`} /></label>
          <CamposSena sena={s.enSede?.sena ?? null} heredar={`Del servicio (${textoSena(s.senaBase)})`} />
          <label className="check"><input type="checkbox" name="habilitado" defaultChecked={s.enSede?.habilitado} />Habilitado</label>
          <label className="check"><input type="checkbox" name="reservableOnline" defaultChecked={s.enSede?.reservableOnline ?? true} />Reservable online</label>
        </Formulario>
      </details>}
    </article>)}
    {!datos.servicios.length && <p>La organización todavía no cargó servicios.</p>}
  </div>;
}
