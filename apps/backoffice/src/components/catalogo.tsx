import Link from "next/link";
import { UNIVERSOS, aCentavos, importe, type Sena } from "@nailnet/domain/catalogo";
import { precioConAjuste, textoAjuste, type Redondeo } from "@nailnet/domain/medios-pago";
import type { catalogoSede, listarCatalogo } from "@nailnet/database/catalogo";
import { Formulario } from "./formulario";
import { CamposSena } from "./campos-sena";
import { Pestanas } from "./pestanas";
import { UNIVERSO } from "@/lib/etiquetas";
import { accionGuardarCategoria, accionGuardarServicio, accionGuardarSkill, accionGuardarTipoRecurso, accionServicioSede } from "@/app/(panel)/acciones";

export const pesos = (v: string | null) => v === null ? "—" : `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const textoSena = (s: Sena) => !s ? "sin definir" : s.tipo === "NINGUNA" ? "sin seña" : s.tipo === "FIJA" ? pesos(s.valor) : `${s.valor}%`;

export type Catalogo = Awaited<ReturnType<typeof listarCatalogo>>;
export type ServicioCat = Catalogo["categorias"][number]["servicios"][number];
type Skill = Catalogo["skills"][number];
type TipoRecurso = Catalogo["tiposRecurso"][number];
type Categoria = Catalogo["categorias"][number];

/** Encabezado de las pestañas del catálogo, con el alta de la pestaña como acción principal. */
export function CabeceraCatalogo({ accion }: { accion?: { href: string; texto: string } }) {
  return <>
    <p className="eyebrow">CATÁLOGO DE LA ORGANIZACIÓN</p>
    <div className="fila-cabecera"><h1>Catálogo</h1>{accion && <Link className="boton" href={accion.href}>+ {accion.texto}</Link>}</div>
    <Pestanas base="/catalogo" etiqueta="Secciones del catálogo" items={[
      { ruta: "", etiqueta: "Servicios y precios" }, { ruta: "categorias", etiqueta: "Categorías" },
      { ruta: "habilidades", etiqueta: "Habilidades" }, { ruta: "recursos", etiqueta: "Tipos de recurso" },
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
      <label>Universo<select name="universo" defaultValue={categoria?.universo ?? "MANOS_PIES"}>
        {UNIVERSOS.map(u => <option key={u} value={u}>{UNIVERSO[u]}</option>)}
      </select></label>
    </div>
    <p className="ayuda">Las categorías agrupan los servicios en el backoffice y en la reserva online; se listan de menor a mayor orden.</p>
    <p className="ayuda">El universo define en qué tablero de Recepción aparecen sus servicios y las profesionales que los hacen: Manos y pies es el salón, con y sin turno; Tratamientos trabaja con turno previo.</p>
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

type EnSede = Awaited<ReturnType<typeof catalogoSede>>["servicios"][number];
/** Un servicio en la tabla: lo común del catálogo y, si hay sede elegida, sus condiciones ahí. */
export type FilaPrecio = { id: string; nombre: string; activo: boolean; duracionBase: number; senaBase: Sena; detalle?: string; enlace?: string; enSede?: EnSede };
export type MedioPrecio = { nombre: string; ajuste: bigint; habilitado: boolean };

const ESTADO = (f: FilaPrecio) => !f.activo ? "Inactivo" : !f.enSede?.efectivo.habilitado ? "No disponible" : f.enSede.efectivo.reservableOnline ? "Online" : "Solo recepción";

/**
 * Servicios y precios en una sola tabla por categoría: lo común del catálogo (duración, requisitos) y lo de la
 * sede elegida (precio de lista, seña, si se ofrece online), con una columna por cada ajuste de los medios de
 * pago activos de la sede: los medios con el mismo porcentaje comparten columna. `editar` abre, debajo de la
 * fila, el formulario de sus condiciones en la sede.
 */
export function TablaPrecios({ grupos, sede, medios, puedeEditar, editar }: {
  grupos: { categoria: string; filas: FilaPrecio[] }[];
  sede: { id: string; nombre: string } | null;
  medios: { medios: MedioPrecio[]; redondeo: Redondeo } | null;
  puedeEditar: boolean; editar?: string;
}) {
  const columnas: { ajuste: bigint; nombres: string[] }[] = [];
  for (const m of medios?.medios ?? []) {
    if (!m.habilitado) continue;
    const c = columnas.find(x => x.ajuste === m.ajuste);
    if (c) c.nombres.push(m.nombre); else columnas.push({ ajuste: m.ajuste, nombres: [m.nombre] });
  }
  const lista = columnas.find(c => c.ajuste === 0n);
  const ajustes = columnas.filter(c => c.ajuste !== 0n);
  const conPrecio = !!sede;
  const total = 3 + (conPrecio ? 2 + ajustes.length : 0) + (conPrecio && puedeEditar ? 1 : 0);
  const conAjuste = (precio: string | null, ajuste: bigint) => {
    const c = precio === null ? null : aCentavos(precio);
    return c === null || !medios ? "—" : pesos(importe(precioConAjuste(c, ajuste, medios.redondeo)));
  };

  return <>{grupos.map(g => <div key={g.categoria}>
    <h2 className="subtitulo">{g.categoria} <span className="tag">{g.filas.length}</span></h2>
    {g.filas.length ? <div className="reporte-tabla tabla-precios"><table>
      <thead><tr>
        <th scope="col">Servicio</th><th scope="col" className="num">Duración</th><th scope="col" className="num">Seña</th>
        {conPrecio && <th scope="col" className="num">Lista{lista && <small>{lista.nombres.join(", ")}</small>}</th>}
        {ajustes.map(c => <th key={String(c.ajuste)} scope="col" className="num">{c.nombres.join(", ")}<small>{textoAjuste(c.ajuste)}</small></th>)}
        {conPrecio && <th scope="col">Estado</th>}
        {conPrecio && puedeEditar && <th scope="col" aria-label="Acciones" />}
      </tr></thead>
      <tbody>{g.filas.map(f => {
        const e = f.enSede?.efectivo;
        const abierta = editar === f.id && puedeEditar && f.activo && !!sede && !!f.enSede;
        return [
          <tr key={f.id} id={`s-${f.id}`} className={(conPrecio ? e?.habilitado : f.activo) ? undefined : "apagada"}>
            <th scope="row">{f.enlace ? <Link href={f.enlace}>{f.nombre}</Link> : f.nombre}{f.detalle && <small>{f.detalle}</small>}</th>
            <td className="num">{e?.duracionMinutos ?? f.duracionBase} min</td>
            <td className="num">{!conPrecio ? textoSena(f.senaBase) : e?.sena === null || !e ? "—" : pesos(e.sena)}</td>
            {conPrecio && <td className="num precio">{pesos(e?.precio ?? null)}</td>}
            {ajustes.map(c => <td key={String(c.ajuste)} className="num">{conAjuste(e?.precio ?? null, c.ajuste)}</td>)}
            {conPrecio && <td><span className="tag" title={e?.motivosSinOnline.join(", ")}>{ESTADO(f)}</span></td>}
            {conPrecio && puedeEditar && <td>{f.activo && f.enSede && (abierta
              ? <Link href="/catalogo" scroll={false}>Cerrar</Link>
              : <Link href={`/catalogo?editar=${f.id}#s-${f.id}`} scroll={false}>Editar</Link>)}</td>}
          </tr>,
          abierta && f.enSede && <tr key={`${f.id}-editar`}><td colSpan={total} className="edicion">
            <Formulario accion={accionServicioSede} boton="Guardar" className="en-linea">
              <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="servicioId" value={f.id} />
              <label className="campo">Precio de lista<span className="con-unidad" data-unidad="$"><input name="precio" defaultValue={f.enSede.enSede?.precio ?? ""} placeholder="30000" inputMode="decimal" autoFocus /></span></label>
              <label className="campo">Duración (min)<input name="duracionMinutos" type="number" min={5} max={480} step={5} defaultValue={f.enSede.enSede?.duracionMinutos ?? ""} placeholder={`${f.duracionBase} (del servicio)`} /></label>
              <CamposSena sena={f.enSede.enSede?.sena ?? null} heredar={`Del servicio (${textoSena(f.senaBase)})`} />
              <label className="check"><input type="checkbox" name="habilitado" defaultChecked={f.enSede.enSede?.habilitado} />Habilitado</label>
              <label className="check"><input type="checkbox" name="reservableOnline" defaultChecked={f.enSede.enSede?.reservableOnline ?? true} />Reservable online</label>
            </Formulario>
            {f.enSede.efectivo.motivosSinOnline.length > 0 && <p className="ayuda">Sin reserva online: {f.enSede.efectivo.motivosSinOnline.join(", ")}.</p>}
          </td></tr>,
        ];
      })}</tbody>
    </table></div> : <p className="ayuda">Sin servicios en esta categoría.</p>}
  </div>)}</>;
}
