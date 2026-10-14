import type { Metadata } from "next";
import { PARAMETROS, type Parametro } from "@nailnet/domain/configuracion";
import { obtenerConfiguracion } from "@nailnet/database/configuracion";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { cargarSede } from "@/lib/sede";
import { accionConfiguracionOrganizacion, accionConfiguracionSede, accionSenaRecepcion } from "../../../acciones";

export const metadata: Metadata = { title: "Reservas online · Sicurella" };
const ORIGEN = { SEDE: "definido en la sede", ORGANIZACION: "heredado de la organización", POR_DEFECTO: "valor por defecto", SIN_DEFINIR: "sin definir" } as const;

function CamposParametros({ valores }: { valores: Partial<Record<Parametro, number | null>> | null }) {
  return <>{(Object.keys(PARAMETROS) as Parametro[]).map(p => <label key={p} className="campo">{PARAMETROS[p].etiqueta} ({PARAMETROS[p].unidad})
    <input name={p} type="number" min={PARAMETROS[p].min} max={PARAMETROS[p].max} step={1} defaultValue={valores?.[p] ?? ""} placeholder="heredar" />
  </label>)}</>;
}

export default async function ReservasSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede } = await cargarSede(sedeId);
  const config = await obtenerConfiguracion(db(), actorId, organizacion.id, sede.id);

  return <>
    <h2 className="subtitulo">Reglas de reserva</h2>
    <ul className="lista">{(Object.keys(PARAMETROS) as Parametro[]).map(p => {
      const e = config.efectiva[p];
      return <li key={p}>{PARAMETROS[p].etiqueta}: <strong>{e.valor ?? "—"}</strong>{e.valor !== null ? ` ${PARAMETROS[p].unidad}` : ""} · {ORIGEN[e.origen]}</li>;
    })}</ul>
    {Object.values(config.efectiva).some(e => e.origen === "SIN_DEFINIR") && <p className="alerta error">Mientras falten valores, la sede no podrá ofrecer turnos online. Los valores iniciales están pendientes de definición (D17/D18).</p>}
    {config.puedeEditarSede && <Formulario accion={accionConfiguracionSede} boton="Guardar para esta sede" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} /><CamposParametros valores={config.sede} />
    </Formulario>}

    <h2 className="subtitulo">Seña en reservas de recepción</h2>
    <p><strong>{config.senaRecepcion.efectiva ? "Se exige por Mercado Pago" : "No se exige, el turno se confirma"}</strong> · {config.senaRecepcion.sede !== null ? "definido en la sede" : config.senaRecepcion.organizacion !== null ? "heredado de la organización" : "valor por defecto"} (D6)</p>
    {config.puedeEditarSede && <Formulario accion={accionSenaRecepcion} boton="Guardar" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="nivel" value="sede" />
      <select name="valor" defaultValue={config.senaRecepcion.sede === null ? "" : String(config.senaRecepcion.sede)} aria-label="Seña en recepción">
        <option value="">Heredar de la organización</option><option value="false">Confirmar sin seña</option><option value="true">Exigir seña por Mercado Pago</option>
      </select>
    </Formulario>}

    {config.puedeEditarOrganizacion && <>
      <h2 className="subtitulo">Valores de la organización</h2>
      <p className="ayuda">Aplican a todas las sedes de {organizacion.nombre} que no definan los suyos.</p>
      <Formulario accion={accionConfiguracionOrganizacion} boton="Guardar para la organización" className="en-linea"><CamposParametros valores={config.organizacion} /></Formulario>
      <Formulario accion={accionSenaRecepcion} boton="Guardar para la organización" className="en-linea" secundario>
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="nivel" value="organizacion" />
        <select name="valor" defaultValue={config.senaRecepcion.organizacion === null ? "" : String(config.senaRecepcion.organizacion)} aria-label="Seña en recepción para la organización">
          <option value="">Sin definir (no exige)</option><option value="false">Confirmar sin seña</option><option value="true">Exigir seña por Mercado Pago</option>
        </select>
      </Formulario>
    </>}
  </>;
}
