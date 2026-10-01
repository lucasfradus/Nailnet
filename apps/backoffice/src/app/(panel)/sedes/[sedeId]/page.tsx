import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { PARAMETROS, type Parametro } from "@nailnet/domain/configuracion";
import { ESQUEMAS, type Proveedor } from "@nailnet/domain/secretos";
import { listarSedes } from "@nailnet/database/access";
import { listarCredenciales, obtenerConfiguracion } from "@nailnet/database/configuracion";
import { aHora } from "@nailnet/domain/agenda";
import { listarCatalogo } from "@nailnet/database/catalogo";
import { calendarioSede } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { CamposSemana, textoSemana } from "@/components/semana";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionConfiguracionOrganizacion, accionConfiguracionSede, accionCrearExcepcion, accionCrearRecurso, accionEliminarCredencial, accionEliminarExcepcion, accionEstadoRecurso, accionGuardarCredencial, accionHorarioSede, accionSenaRecepcion } from "../../acciones";

export const metadata: Metadata = { title: "Configuración de sede · NailNet" };
const PROVEEDORES: Record<Proveedor, string> = { MERCADO_PAGO: "Mercado Pago", FACTURANTE: "Facturante" };
const AMBIENTES = { PRUEBA: "Prueba", PRODUCCION: "Producción" } as const;
const ORIGEN = { SEDE: "definido en la sede", ORGANIZACION: "heredado de la organización", POR_DEFECTO: "valor por defecto", SIN_DEFINIR: "sin definir" } as const;

function CamposParametros({ valores }: { valores: Partial<Record<Parametro, number | null>> | null }) {
  return <>{(Object.keys(PARAMETROS) as Parametro[]).map(p => <label key={p} className="campo">{PARAMETROS[p].etiqueta} ({PARAMETROS[p].unidad})
    <input name={p} type="number" min={PARAMETROS[p].min} max={PARAMETROS[p].max} step={1} defaultValue={valores?.[p] ?? ""} placeholder="heredar" />
  </label>)}</>;
}

export default async function ConfiguracionSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { sesion, organizacion } = await requerirOrganizacion();
  const actorId = sesion.usuario.id;
  const cargar = async () => {
    const [sede] = await listarSedes(db(), actorId, organizacion.id, { sedeId, incluirInactivas: true });
    return { sede: sede!, config: await obtenerConfiguracion(db(), actorId, organizacion.id, sedeId) };
  };
  const datos = await cargar().catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!datos) notFound();
  const { sede, config } = datos;
  // El calendario solo aplica a sedes activas; una sede inactiva conserva su configuración.
  const cal = sede.activo ? await calendarioSede(db(), actorId, organizacion.id, sedeId) : null;
  const tiposRecurso = cal?.editable ? (await listarCatalogo(db(), actorId, organizacion.id)).tiposRecurso : [];
  const credenciales = config.puedeCredenciales ? await listarCredenciales(db(), actorId, organizacion.id, sedeId) : [];

  return <section className="panel">
    <p className="eyebrow"><Link href="/sedes">SEDES</Link> · {sede.franquiciado.nombre.toUpperCase()}</p>
    <h1>{sede.nombre}</h1>

    <h2 className="subtitulo">Reservas online</h2>
    <ul className="lista">{(Object.keys(PARAMETROS) as Parametro[]).map(p => {
      const e = config.efectiva[p];
      return <li key={p}>{PARAMETROS[p].etiqueta}: <strong>{e.valor ?? "—"}</strong>{e.valor !== null ? ` ${PARAMETROS[p].unidad}` : ""} · {ORIGEN[e.origen]}</li>;
    })}</ul>
    {Object.values(config.efectiva).some(e => e.origen === "SIN_DEFINIR") && <p className="alerta error">Mientras falten valores, la sede no podrá ofrecer turnos online. Los valores iniciales están pendientes de definición (D17/D18).</p>}
    {config.puedeEditarSede && <Formulario accion={accionConfiguracionSede} boton="Guardar para esta sede" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} /><CamposParametros valores={config.sede} />
    </Formulario>}
    <p>Seña en reservas de recepción: <strong>{config.senaRecepcion.efectiva ? "se exige por Mercado Pago" : "no se exige, el turno se confirma"}</strong> · {config.senaRecepcion.sede !== null ? "definido en la sede" : config.senaRecepcion.organizacion !== null ? "heredado de la organización" : "valor por defecto"} (D6)</p>
    {config.puedeEditarSede && <Formulario accion={accionSenaRecepcion} boton="Guardar" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="nivel" value="sede" />
      <select name="valor" defaultValue={config.senaRecepcion.sede === null ? "" : String(config.senaRecepcion.sede)} aria-label="Seña en recepción">
        <option value="">Heredar de la organización</option><option value="false">Confirmar sin seña</option><option value="true">Exigir seña por Mercado Pago</option>
      </select>
    </Formulario>}
    {config.puedeEditarOrganizacion && <Formulario accion={accionSenaRecepcion} boton="Guardar para la organización" className="en-linea" secundario>
      <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="nivel" value="organizacion" />
      <select name="valor" defaultValue={config.senaRecepcion.organizacion === null ? "" : String(config.senaRecepcion.organizacion)} aria-label="Seña en recepción para la organización">
        <option value="">Sin definir (no exige)</option><option value="false">Confirmar sin seña</option><option value="true">Exigir seña por Mercado Pago</option>
      </select>
    </Formulario>}
    {config.puedeEditarOrganizacion && <>
      <p className="ayuda">Valores por defecto para todas las sedes de {organizacion.nombre}:</p>
      <Formulario accion={accionConfiguracionOrganizacion} boton="Guardar para la organización" className="en-linea"><CamposParametros valores={config.organizacion} /></Formulario>
    </>}

    {cal && <>
    <h2 className="subtitulo">Horario de atención</h2>
    <p>{textoSemana(cal.semana)}</p>
    {cal.editable && <details><summary>Editar horario semanal</summary>
      <Formulario accion={accionHorarioSede} boton="Guardar horario">
        <input type="hidden" name="sedeId" value={sede.id} /><CamposSemana semana={cal.semana} />
        <p className="ayuda">Los turnos online se ofrecen dentro de este horario y de la jornada de cada profesional.</p>
      </Formulario>
    </details>}

    <h2 className="subtitulo">Feriados y fechas especiales</h2>
    <ul className="lista">{cal.excepciones.map(e => <li key={e.id}>{e.fecha} · {e.cerrado ? "Cerrado" : `${aHora(e.inicio!)}-${aHora(e.fin!)}`}{e.motivo ? ` · ${e.motivo}` : ""}{e.deOrganizacion ? " · toda la organización" : ""}
      {((e.deOrganizacion && cal.editarFeriados) || (!e.deOrganizacion && cal.editable)) && <Formulario accion={accionEliminarExcepcion} boton="Quitar" className="en-linea" secundario>
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="excepcionId" value={e.id} />
      </Formulario>}</li>)}
      {!cal.excepciones.length && <li>Sin fechas especiales próximas.</li>}</ul>
    <p className="ayuda">Si la sede tiene filas propias para una fecha, reemplazan al feriado de la organización (por ejemplo, abrir medio día).</p>
    {cal.editable && <Formulario accion={accionCrearExcepcion} boton="Agregar fecha" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} />
      <input type="date" name="fecha" required aria-label="Fecha" />
      <label className="check"><input type="checkbox" name="cerrado" defaultChecked />Cerrado</label>
      <input name="desde" placeholder="Desde HH:MM" size={8} aria-label="Desde" /><input name="hasta" placeholder="Hasta HH:MM" size={8} aria-label="Hasta" />
      <input name="motivo" placeholder="Motivo" maxLength={120} aria-label="Motivo" />
      {cal.editarFeriados && <label className="check"><input type="checkbox" name="toda" />Para toda la organización</label>}
    </Formulario>}

    <h2 className="subtitulo">Recursos</h2>
    <ul className="lista">{cal.recursos.map(r => <li key={r.id}>{r.tipo} · {r.nombre}{r.activo ? "" : " · fuera de servicio"}
      {cal.editable && <Formulario accion={accionEstadoRecurso} boton={r.activo ? "Fuera de servicio" : "Reactivar"} className="en-linea" secundario>
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="recursoId" value={r.id} /><input type="hidden" name="activo" value={String(!r.activo)} />
      </Formulario>}</li>)}
      {!cal.recursos.length && <li>Sin recursos cargados.</li>}</ul>
    {cal.editable && tiposRecurso.length > 0 && <Formulario accion={accionCrearRecurso} boton="Agregar recurso" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} />
      <select name="tipoRecursoId" aria-label="Tipo">{tiposRecurso.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
      <input name="nombre" placeholder="Nombre (Cabina 1)" required maxLength={80} aria-label="Nombre" />
    </Formulario>}
    </>}

    {config.puedeCredenciales && <>
      <h2 className="subtitulo">Credenciales de proveedores</h2>
      <p className="ayuda">Cada sede usa sus propias cuentas (D8). Los secretos se guardan cifrados y no se vuelven a mostrar: para cambiarlos, cargalos completos de nuevo.</p>
      <div className="tabla">{(Object.keys(ESQUEMAS) as Proveedor[]).flatMap(proveedor => (Object.keys(AMBIENTES) as (keyof typeof AMBIENTES)[]).map(ambiente => {
        const actual = credenciales.find(c => c.proveedor === proveedor && c.ambiente === ambiente);
        const esquema = ESQUEMAS[proveedor];
        return <article key={proveedor + ambiente} className="fila">
          <div className="fila-cabecera"><h2>{PROVEEDORES[proveedor]} · {AMBIENTES[ambiente]}</h2>
            <span className="tag">{actual ? `Configurada ${actual.pista}` : "Sin configurar"}</span></div>
          {actual && <p>{esquema.publicos.map(c => `${c.etiqueta}: ${actual.publicos[c.nombre] ?? "—"}`).join(" · ")}
            {actual.requiereRecifrado ? " · pendiente de rotación de clave" : ""}</p>}
          <details><summary>{actual ? "Reemplazar" : "Configurar"}</summary>
            <Formulario accion={accionGuardarCredencial} boton="Guardar credencial" className="en-linea">
              <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="proveedor" value={proveedor} /><input type="hidden" name="ambiente" value={ambiente} />
              {esquema.publicos.map(c => <input key={c.nombre} name={`c_${c.nombre}`} placeholder={c.etiqueta} aria-label={c.etiqueta} defaultValue={actual?.publicos[c.nombre] ?? ""} required autoComplete="off" />)}
              {esquema.secretos.map(c => <input key={c.nombre} name={`c_${c.nombre}`} type="password" placeholder={c.etiqueta} aria-label={c.etiqueta} required autoComplete="new-password" />)}
            </Formulario>
          </details>
          {actual && <Formulario accion={accionEliminarCredencial} boton="Eliminar" className="en-linea" secundario confirmar={`¿Eliminar la credencial de ${PROVEEDORES[proveedor]} (${AMBIENTES[ambiente]})?`}>
            <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="proveedor" value={proveedor} /><input type="hidden" name="ambiente" value={ambiente} />
          </Formulario>}
        </article>;
      }))}</div>
    </>}
  </section>;
}
