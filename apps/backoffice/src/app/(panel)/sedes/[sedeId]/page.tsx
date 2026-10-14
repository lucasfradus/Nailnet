import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { PARAMETROS, type Parametro } from "@nailnet/domain/configuracion";
import { ESQUEMAS } from "@nailnet/domain/secretos";
import { listarSedes } from "@nailnet/database/access";
import { listarCredenciales, obtenerConfiguracion } from "@nailnet/database/configuracion";
import { ambientePagos } from "@nailnet/database/pagos";
import { aHora } from "@nailnet/domain/agenda";
import { listarCatalogo } from "@nailnet/database/catalogo";
import { calendarioSede } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { CamposSemana, textoSemana } from "@/components/semana";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { aplicacionMercadoPago } from "@/lib/mercadopago";
import { accionActualizarSede, accionConectarMercadoPago, accionConfiguracionOrganizacion, accionConfiguracionSede, accionCrearExcepcion, accionCrearRecurso, accionEliminarCredencial, accionEliminarExcepcion, accionEstadoRecurso, accionEstadoSede, accionGuardarCredencial, accionHorarioSede, accionSenaRecepcion } from "../../acciones";

export const metadata: Metadata = { title: "Configuración de sede · Sicurella" };
const AMBIENTES = { PRUEBA: "Prueba", PRODUCCION: "Producción" } as const;
const ORIGEN = { SEDE: "definido en la sede", ORGANIZACION: "heredado de la organización", POR_DEFECTO: "valor por defecto", SIN_DEFINIR: "sin definir" } as const;

/**
 * Secciones de la configuración, como pestañas con ?seccion=. Cada una agrupa lo que se edita junto;
 * para sumar algo nuevo, agregarlo a la sección que corresponda o crear otra acá.
 */
const SECCIONES = [
  { id: "resumen", nombre: "Resumen" },
  { id: "horarios", nombre: "Horarios" },
  { id: "reservas", nombre: "Reservas" },
  { id: "recursos", nombre: "Recursos" },
  { id: "cobros", nombre: "Cobros y facturación" },
] as const;
type Seccion = typeof SECCIONES[number]["id"];

function CamposParametros({ valores }: { valores: Partial<Record<Parametro, number | null>> | null }) {
  return <>{(Object.keys(PARAMETROS) as Parametro[]).map(p => <label key={p} className="campo">{PARAMETROS[p].etiqueta} ({PARAMETROS[p].unidad})
    <input name={p} type="number" min={PARAMETROS[p].min} max={PARAMETROS[p].max} step={1} defaultValue={valores?.[p] ?? ""} placeholder="heredar" />
  </label>)}</>;
}

// Resultado de la vinculación con Mercado Pago (lo informa el callback de OAuth con ?mp=…).
const RESULTADO_MP: Record<string, [tipo: "ok" | "error", mensaje: string]> = {
  vinculada: ["ok", "Cuenta de Mercado Pago vinculada."],
  cancelado: ["error", "Se canceló la autorización en Mercado Pago. La cuenta no se vinculó."],
  duplicada: ["error", "Esa cuenta de Mercado Pago ya está vinculada a otra sede."],
  "sin-permiso": ["error", "No tenés permiso para vincular cuentas en esta sede."],
  "sin-configurar": ["error", "La integración con Mercado Pago no está configurada en este entorno."],
  error: ["error", "No se pudo vincular la cuenta. Volvé a intentar en unos minutos."],
};
const vencida = (venceEn: Date | null) => venceEn !== null && venceEn <= new Date();

export default async function ConfiguracionSede({ params, searchParams }: { params: Promise<{ sedeId: string }>; searchParams: Promise<{ seccion?: string; mp?: string }> }) {
  const { sedeId } = await params;
  const q = await searchParams;
  const resultadoMp = RESULTADO_MP[q.mp ?? ""];
  const ambienteMp = ambientePagos(), mpConfigurado = aplicacionMercadoPago() !== null;
  const { sesion, organizacion, puede } = await requerirOrganizacion();
  const actorId = sesion.usuario.id;
  const cargar = async () => {
    const [sede] = await listarSedes(db(), actorId, organizacion.id, { sedeId, incluirInactivas: true });
    return { sede: sede!, config: await obtenerConfiguracion(db(), actorId, organizacion.id, sedeId) };
  };
  const datos = await cargar().catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!datos) notFound();
  const { sede, config } = datos;

  const visibles = SECCIONES.filter(s => s.id !== "cobros" || config.puedeCredenciales);
  // Al volver de Mercado Pago se abre directo la sección de cobros.
  const pedida = (q.mp ? "cobros" : q.seccion) as Seccion | undefined;
  const seccion: Seccion = visibles.some(s => s.id === pedida) ? pedida! : "resumen";
  const enlace = (s: Seccion) => s === "resumen" ? `/sedes/${sede.id}` : `/sedes/${sede.id}?seccion=${s}`;

  // El calendario solo aplica a sedes activas; una sede inactiva conserva su configuración.
  const cal = sede.activo ? await calendarioSede(db(), actorId, organizacion.id, sedeId) : null;
  const tiposRecurso = seccion === "recursos" && cal?.editable ? (await listarCatalogo(db(), actorId, organizacion.id)).tiposRecurso : [];
  const credenciales = config.puedeCredenciales ? await listarCredenciales(db(), actorId, organizacion.id, sedeId) : [];
  const cuentaMp = credenciales.find(c => c.proveedor === "MERCADO_PAGO" && c.ambiente === ambienteMp);
  const sinDefinir = (Object.keys(PARAMETROS) as Parametro[]).filter(p => config.efectiva[p].origen === "SIN_DEFINIR");
  const conHorario = !!cal && Object.values(cal.semana).some(r => r?.length);
  const inactiva = <article><p className="ayuda">La sede está inactiva: reactivala desde el Resumen para editar esta sección.</p></article>;

  return <section className="panel">
    <p className="eyebrow"><Link href="/sedes">SEDES</Link> · {sede.franquiciado.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>{sede.nombre}</h1><span className={sede.activo ? "tag estado-confirmada" : "tag"}>{sede.activo ? "Activa" : "Inactiva"}</span></div>

    <nav className="pestanas" aria-label="Secciones de la sede">
      {visibles.map(s => <Link key={s.id} href={enlace(s.id)} aria-current={s.id === seccion ? "page" : undefined}>{s.nombre}</Link>)}
    </nav>

    {seccion === "resumen" && <div className="secciones">
      <article>
        <h2>Puesta a punto</h2>
        <p className="ayuda">Lo que la sede necesita para tomar turnos y cobrar señas.</p>
        <ul className="pendientes">
          <li className={conHorario ? "listo" : "falta"}>
            <div><strong>Horario de atención</strong><span>{!cal ? "Sede inactiva" : textoSemana(cal.semana)}</span></div>
            <Link className="boton secundario" href={enlace("horarios")}>{conHorario ? "Ver" : "Cargar"}</Link>
          </li>
          <li className={sinDefinir.length ? "falta" : "listo"}>
            <div><strong>Reservas online</strong><span>{sinDefinir.length ? `Falta definir: ${sinDefinir.map(p => PARAMETROS[p].etiqueta.toLowerCase()).join(", ")}` : "Reglas definidas"}</span></div>
            <Link className="boton secundario" href={enlace("reservas")}>{sinDefinir.length ? "Completar" : "Ver"}</Link>
          </li>
          {config.puedeCredenciales && <li className={cuentaMp && !vencida(cuentaMp.tokenVenceEn) ? "listo" : "falta"}>
            <div><strong>Cobro de señas con Mercado Pago</strong><span>{!cuentaMp ? "Cuenta sin vincular" : vencida(cuentaMp.tokenVenceEn) ? "Vinculación vencida" : `Cuenta ${cuentaMp.publicos.cuentaId ?? ""} vinculada`}</span></div>
            <Link className="boton secundario" href={enlace("cobros")}>{cuentaMp ? "Ver" : "Conectar"}</Link>
          </li>}
        </ul>
      </article>

      <article>
        <h2>Datos de la sede</h2>
        <dl className="datos-sede">
          <div><dt>Nombre</dt><dd>{puede.editarSedes && sede.activo
            ? <Formulario accion={accionActualizarSede} boton="Guardar" className="en-linea sin-margen">
              <input type="hidden" name="sedeId" value={sede.id} />
              <input name="nombre" defaultValue={sede.nombre} required maxLength={120} aria-label="Nombre de la sede" />
            </Formulario>
            : sede.nombre}</dd></div>
          <div><dt>Franquiciado</dt><dd>{sede.franquiciado.nombre}</dd></div>
          <div><dt>Zona horaria</dt><dd>{sede.timezone.replace(/_/g, " ")}<small>Se elige al crear la sede y no se cambia: correría los horarios de los turnos ya tomados.</small></dd></div>
        </dl>
      </article>

      {puede.crearSedeEn(sede.franquiciadoId) && <article>
        <h2>{sede.activo ? "Desactivar la sede" : "Reactivar la sede"}</h2>
        <p className="ayuda">{sede.activo ? "Deja de aparecer en la operación diaria y en las reservas online. La configuración se conserva." : "Vuelve a aparecer en la operación diaria con la configuración que tenía."}</p>
        <Formulario accion={accionEstadoSede} boton={sede.activo ? "Desactivar sede" : "Reactivar sede"} className="en-linea" secundario
          confirmar={sede.activo ? `¿Desactivar ${sede.nombre}? Deja de aparecer en la operación diaria.` : undefined}>
          <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="activo" value={String(!sede.activo)} />
        </Formulario>
      </article>}
    </div>}

    {seccion === "horarios" && <div className="secciones">{!cal ? inactiva : <>
      <article>
        <h2>Horario de atención</h2>
        <p>{textoSemana(cal.semana)}</p>
        {cal.editable && <details><summary>Editar horario semanal</summary>
          <Formulario accion={accionHorarioSede} boton="Guardar horario">
            <input type="hidden" name="sedeId" value={sede.id} /><CamposSemana semana={cal.semana} />
            <p className="ayuda">Los turnos online se ofrecen dentro de este horario y de la jornada de cada profesional.</p>
          </Formulario>
        </details>}
      </article>

      <article>
        <h2>Feriados y fechas especiales</h2>
        <p className="ayuda">Si la sede tiene un horario propio para una fecha, reemplaza al feriado de la organización (por ejemplo, abrir medio día).</p>
        <ul className="lista">{cal.excepciones.map(e => <li key={e.id}>{e.fecha} · {e.cerrado ? "Cerrado" : `${aHora(e.inicio!)}-${aHora(e.fin!)}`}{e.motivo ? ` · ${e.motivo}` : ""}{e.deOrganizacion ? " · toda la organización" : ""}
          {((e.deOrganizacion && cal.editarFeriados) || (!e.deOrganizacion && cal.editable)) && <Formulario accion={accionEliminarExcepcion} boton="Quitar" className="en-linea" secundario>
            <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="excepcionId" value={e.id} />
          </Formulario>}</li>)}
          {!cal.excepciones.length && <li>Sin fechas especiales próximas.</li>}</ul>
        {cal.editable && <details><summary>Agregar fecha</summary>
          <Formulario accion={accionCrearExcepcion} boton="Agregar fecha" className="en-linea">
            <input type="hidden" name="sedeId" value={sede.id} />
            <input type="date" name="fecha" required aria-label="Fecha" />
            <label className="check"><input type="checkbox" name="cerrado" defaultChecked />Cerrado</label>
            <input name="desde" placeholder="Desde HH:MM" size={8} aria-label="Desde" /><input name="hasta" placeholder="Hasta HH:MM" size={8} aria-label="Hasta" />
            <input name="motivo" placeholder="Motivo" maxLength={120} aria-label="Motivo" />
            {cal.editarFeriados && <label className="check"><input type="checkbox" name="toda" />Para toda la organización</label>}
          </Formulario>
        </details>}
      </article>
    </>}</div>}

    {seccion === "reservas" && <div className="secciones">
      <article>
        <h2>Reservas online</h2>
        {sinDefinir.length > 0 && <p className="alerta error">Mientras falten valores, la sede no puede ofrecer turnos online (D17/D18).</p>}
        <dl className="datos-sede">{(Object.keys(PARAMETROS) as Parametro[]).map(p => {
          const e = config.efectiva[p];
          return <div key={p}><dt>{PARAMETROS[p].etiqueta}</dt><dd>{e.valor ?? "—"}{e.valor !== null ? ` ${PARAMETROS[p].unidad}` : ""}<small>{ORIGEN[e.origen]}</small></dd></div>;
        })}</dl>
        {config.puedeEditarSede && <details><summary>Cambiar para esta sede</summary>
          <Formulario accion={accionConfiguracionSede} boton="Guardar para esta sede" className="en-linea">
            <input type="hidden" name="sedeId" value={sede.id} /><CamposParametros valores={config.sede} />
          </Formulario>
          <p className="ayuda">Un campo vacío usa el valor de la organización.</p>
        </details>}
      </article>

      <article>
        <h2>Seña en reservas de recepción</h2>
        <p><strong>{config.senaRecepcion.efectiva ? "Se exige por Mercado Pago" : "No se exige: el turno se confirma"}</strong> · {config.senaRecepcion.sede !== null ? "definido en la sede" : config.senaRecepcion.organizacion !== null ? "heredado de la organización" : "valor por defecto"} (D6)</p>
        {config.puedeEditarSede && <Formulario accion={accionSenaRecepcion} boton="Guardar" className="en-linea">
          <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="nivel" value="sede" />
          <select name="valor" defaultValue={config.senaRecepcion.sede === null ? "" : String(config.senaRecepcion.sede)} aria-label="Seña en recepción">
            <option value="">Heredar de la organización</option><option value="false">Confirmar sin seña</option><option value="true">Exigir seña por Mercado Pago</option>
          </select>
        </Formulario>}
      </article>

      {config.puedeEditarOrganizacion && <details className="desplegable">
        <summary>Valores por defecto de {organizacion.nombre}</summary>
        <p className="ayuda">Se aplican a todas las sedes que no definan los suyos.</p>
        <Formulario accion={accionConfiguracionOrganizacion} boton="Guardar para la organización" className="en-linea"><CamposParametros valores={config.organizacion} /></Formulario>
        <Formulario accion={accionSenaRecepcion} boton="Guardar para la organización" className="en-linea" secundario>
          <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="nivel" value="organizacion" />
          <select name="valor" defaultValue={config.senaRecepcion.organizacion === null ? "" : String(config.senaRecepcion.organizacion)} aria-label="Seña en recepción para la organización">
            <option value="">Seña en recepción: sin definir (no exige)</option><option value="false">Seña en recepción: confirmar sin seña</option><option value="true">Seña en recepción: exigir por Mercado Pago</option>
          </select>
        </Formulario>
      </details>}
    </div>}

    {seccion === "recursos" && <div className="secciones">{!cal ? inactiva : <article>
      <h2>Recursos</h2>
      <p className="ayuda">Cabinas, sillones y equipos que algunos servicios necesitan. Un recurso fuera de servicio no se asigna a turnos nuevos.</p>
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
    </article>}</div>}

    {seccion === "cobros" && <div className="secciones">
      {resultadoMp && <p className={`alerta ${resultadoMp[0]}`} role="status">{resultadoMp[1]}</p>}
      <article>
        <div className="fila-cabecera"><h2>Mercado Pago · {AMBIENTES[ambienteMp]}</h2>
          <span className={`tag${cuentaMp && !vencida(cuentaMp.tokenVenceEn) ? " estado-confirmada" : ""}`}>{!cuentaMp ? "Sin vincular" : vencida(cuentaMp.tokenVenceEn) ? "Vencida" : "Vinculada"}</span></div>
        {cuentaMp ? <p>Cuenta {cuentaMp.publicos.cuentaId ?? "—"}
          {cuentaMp.tokenVenceEn ? ` · el acceso se renueva solo; vence el ${cuentaMp.tokenVenceEn.toLocaleDateString("es-AR")}` : " · cargada a mano: volvé a conectarla para que se renueve sola"}
          {cuentaMp.requiereRecifrado ? " · pendiente de rotación de clave" : ""}</p>
          : <p>Para cobrar señas online, quien administra la cuenta de Mercado Pago de la sede inicia sesión y autoriza a Sicurella.{ambienteMp === "PRUEBA" ? " En este entorno vinculá un usuario de prueba de Mercado Pago, no la cuenta real." : ""}</p>}
        <div className="acciones">
          {mpConfigurado ? <form action={accionConectarMercadoPago}>
            <input type="hidden" name="sedeId" value={sede.id} />
            <button className={cuentaMp ? "secundario" : undefined}>{cuentaMp ? "Volver a conectar" : "Conectar con Mercado Pago"}</button>
          </form> : <p className="ayuda">La integración con Mercado Pago no está configurada en este entorno (MP_APP_ID y MP_CLIENT_SECRET).</p>}
          {cuentaMp && <Formulario accion={accionEliminarCredencial} boton="Desvincular" className="en-linea" secundario confirmar="¿Desvincular la cuenta de Mercado Pago? La sede deja de cobrar señas online hasta que se vuelva a conectar.">
            <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="proveedor" value="MERCADO_PAGO" /><input type="hidden" name="ambiente" value={ambienteMp} />
          </Formulario>}
        </div>
      </article>

      <article>
        <h2>Facturación electrónica · Facturante</h2>
        <p className="ayuda">Credenciales de la cuenta de Facturante de la sede (D8). Se guardan cifradas y no se vuelven a mostrar: para cambiarlas, cargalas completas de nuevo.</p>
        <div className="tabla">{(Object.keys(AMBIENTES) as (keyof typeof AMBIENTES)[]).map(ambiente => {
          const actual = credenciales.find(c => c.proveedor === "FACTURANTE" && c.ambiente === ambiente);
          const esquema = ESQUEMAS.FACTURANTE;
          return <div key={ambiente} className="fila">
            <div className="fila-cabecera"><h2>{AMBIENTES[ambiente]}</h2>
              <span className="tag">{actual ? `Configurada ${actual.pista}` : "Sin configurar"}</span></div>
            {actual && <p>{esquema.publicos.map(c => `${c.etiqueta}: ${actual.publicos[c.nombre] ?? "—"}`).join(" · ")}
              {actual.requiereRecifrado ? " · pendiente de rotación de clave" : ""}</p>}
            <details><summary>{actual ? "Reemplazar" : "Configurar"}</summary>
              <Formulario accion={accionGuardarCredencial} boton="Guardar credencial" className="en-linea">
                <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="proveedor" value="FACTURANTE" /><input type="hidden" name="ambiente" value={ambiente} />
                {esquema.publicos.map(c => <input key={c.nombre} name={`c_${c.nombre}`} placeholder={c.etiqueta} aria-label={c.etiqueta} defaultValue={actual?.publicos[c.nombre] ?? ""} required autoComplete="off" />)}
                {esquema.secretos.map(c => <input key={c.nombre} name={`c_${c.nombre}`} type="password" placeholder={c.etiqueta} aria-label={c.etiqueta} required autoComplete="new-password" />)}
              </Formulario>
            </details>
            {actual && <Formulario accion={accionEliminarCredencial} boton="Eliminar" className="en-linea" secundario confirmar={`¿Eliminar la credencial de Facturante (${AMBIENTES[ambiente]})?`}>
              <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="proveedor" value="FACTURANTE" /><input type="hidden" name="ambiente" value={ambiente} />
            </Formulario>}
          </div>;
        })}</div>
      </article>
    </div>}
  </section>;
}
