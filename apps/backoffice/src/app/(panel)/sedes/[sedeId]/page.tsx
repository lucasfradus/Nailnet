import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { PARAMETROS, type Parametro } from "@nailnet/domain/configuracion";
import { ESQUEMAS, type Proveedor } from "@nailnet/domain/secretos";
import { listarSedes } from "@nailnet/database/access";
import { listarCredenciales, obtenerConfiguracion } from "@nailnet/database/configuracion";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionConfiguracionOrganizacion, accionConfiguracionSede, accionEliminarCredencial, accionGuardarCredencial } from "../../acciones";

export const metadata: Metadata = { title: "Configuración de sede · NailNet" };
const PROVEEDORES: Record<Proveedor, string> = { MERCADO_PAGO: "Mercado Pago", FACTURANTE: "Facturante" };
const AMBIENTES = { PRUEBA: "Prueba", PRODUCCION: "Producción" } as const;
const ORIGEN = { SEDE: "definido en la sede", ORGANIZACION: "heredado de la organización", SIN_DEFINIR: "sin definir" } as const;

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
  const credenciales = config.puedeCredenciales ? await listarCredenciales(db(), actorId, organizacion.id, sedeId) : [];

  return <section className="panel">
    <p className="eyebrow"><Link href="/sedes">SEDES</Link> · {sede.franquiciado.nombre.toUpperCase()}</p>
    <h1>{sede.nombre}</h1>

    <h2 className="subtitulo">Reservas online</h2>
    <ul className="lista">{(Object.keys(PARAMETROS) as Parametro[]).map(p => {
      const e = config.efectiva[p];
      return <li key={p}>{PARAMETROS[p].etiqueta}: <strong>{e.valor ?? "—"}</strong>{e.valor !== null ? ` ${PARAMETROS[p].unidad}` : ""} · {ORIGEN[e.origen]}</li>;
    })}</ul>
    {Object.values(config.efectiva).some(e => e.origen === "SIN_DEFINIR") && <p className="alerta error">Mientras falten valores, la sede no podrá ofrecer turnos online. Los valores iniciales están pendientes de definición (D18).</p>}
    {config.puedeEditarSede && <Formulario accion={accionConfiguracionSede} boton="Guardar para esta sede" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} /><CamposParametros valores={config.sede} />
    </Formulario>}
    {config.puedeEditarOrganizacion && <>
      <p className="ayuda">Valores por defecto para todas las sedes de {organizacion.nombre}:</p>
      <Formulario accion={accionConfiguracionOrganizacion} boton="Guardar para la organización" className="en-linea"><CamposParametros valores={config.organizacion} /></Formulario>
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
