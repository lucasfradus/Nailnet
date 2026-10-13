import type { Metadata } from "next";
import { ESQUEMAS, type Proveedor } from "@nailnet/domain/secretos";
import { formatearCuit } from "@nailnet/domain/fiscal";
import { configuracionFiscal, estadoIntegraciones, listarCredenciales, obtenerConfiguracion } from "@nailnet/database/configuracion";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { cargarSede } from "@/lib/sede";
import { accionEliminarCredencial, accionEliminarFiscal, accionGuardarCredencial, accionGuardarFiscal } from "../../../acciones";

export const metadata: Metadata = { title: "Pagos y facturación · Sicurella" };
const PROVEEDORES: Record<Proveedor, string> = { MERCADO_PAGO: "Mercado Pago", FACTURANTE: "Facturante" };
const AMBIENTES = { PRUEBA: "Prueba", PRODUCCION: "Producción" } as const;
type Ambiente = keyof typeof AMBIENTES;
const ambientes = Object.keys(AMBIENTES) as Ambiente[];
const proveedores = Object.keys(ESQUEMAS) as Proveedor[];

export default async function PagosSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede } = await cargarSede(sedeId);
  const org = organizacion.id;
  const [config, integraciones, fiscal] = await Promise.all([
    obtenerConfiguracion(db(), actorId, org, sede.id),
    estadoIntegraciones(db(), actorId, org, sede.id),
    configuracionFiscal(db(), actorId, org, sede.id),
  ]);
  const credenciales = config.puedeCredenciales ? await listarCredenciales(db(), actorId, org, sede.id) : [];

  return <>
    <h2 className="subtitulo">Cuentas de proveedores</h2>
    <p className="ayuda pie-tabla">Cada sede usa sus propias cuentas (D8). Mercado Pago cobra las señas; Facturante emite los comprobantes.
      {config.puedeCredenciales ? " Los secretos se guardan cifrados y no se vuelven a mostrar: para cambiarlos, cargalos completos de nuevo." : " Solo el franquiciado o el master pueden ver el detalle y cambiarlas."}</p>
    <div className="tabla">{proveedores.flatMap(proveedor => ambientes.map(ambiente => {
      const actual = credenciales.find(c => c.proveedor === proveedor && c.ambiente === ambiente);
      const cargada = integraciones.credenciales.some(c => c.proveedor === proveedor && c.ambiente === ambiente);
      const esquema = ESQUEMAS[proveedor];
      return <article key={proveedor + ambiente} className="fila">
        <div className="fila-cabecera"><h2>{PROVEEDORES[proveedor]} · {AMBIENTES[ambiente]}</h2>
          <span className={cargada ? "tag estado-confirmada" : "tag"}>{actual ? `Configurada ${actual.pista}` : cargada ? "Configurada" : "Sin configurar"}</span></div>
        {actual && <p>{esquema.publicos.map(c => `${c.etiqueta}: ${actual.publicos[c.nombre] ?? "—"}`).join(" · ")}
          {actual.requiereRecifrado ? " · pendiente de rotación de clave" : ""}</p>}
        {config.puedeCredenciales && <>
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
        </>}
      </article>;
    }))}</div>

    <h2 className="subtitulo">Datos fiscales</h2>
    <p className="ayuda pie-tabla">CUIT emisor y punto de venta con los que factura la sede. Varias sedes pueden compartir CUIT, cada una con su propio punto de venta.</p>
    <div className="tabla">{ambientes.map(ambiente => {
      const actual = fiscal.porAmbiente[ambiente];
      return <article key={ambiente} className="fila">
        <div className="fila-cabecera"><h2>Facturación · {AMBIENTES[ambiente]}</h2>
          <span className={actual ? "tag estado-confirmada" : "tag"}>{actual ? `PV ${String(actual.puntoVenta).padStart(5, "0")}` : "Sin configurar"}</span></div>
        {actual && <p>{actual.razonSocial} · CUIT {formatearCuit(actual.cuit)} · punto de venta {actual.puntoVenta}</p>}
        {fiscal.puedeEditar && <>
          <details><summary>{actual ? "Cambiar" : "Configurar"}</summary>
            <Formulario accion={accionGuardarFiscal} boton="Guardar datos fiscales" className="en-linea">
              <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="ambiente" value={ambiente} />
              <label className="campo">CUIT<input name="cuit" defaultValue={actual ? formatearCuit(actual.cuit) : ""} required inputMode="numeric" placeholder="30-12345678-9" list={`emisores-${ambiente}`} autoComplete="off" /></label>
              <label className="campo">Razón social<input name="razonSocial" defaultValue={actual?.razonSocial ?? ""} maxLength={200} placeholder="La registrada, si el CUIT ya existe" /></label>
              <label className="campo">Punto de venta<input name="puntoVenta" type="number" min={1} max={99999} required defaultValue={actual?.puntoVenta ?? ""} className="corto" /></label>
              <datalist id={`emisores-${ambiente}`}>{fiscal.emisores.map(e => <option key={e.cuit} value={formatearCuit(e.cuit)}>{e.razonSocial}</option>)}</datalist>
            </Formulario>
          </details>
          {actual && <Formulario accion={accionEliminarFiscal} boton="Quitar" className="en-linea" secundario confirmar={`¿Quitar los datos fiscales de ${AMBIENTES[ambiente].toLowerCase()}? La sede no podrá facturar en ese ambiente.`}>
            <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="ambiente" value={ambiente} />
          </Formulario>}
        </>}
      </article>;
    })}</div>
  </>;
}
