import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { UNIDADES } from "@nailnet/domain/stock";
import { fichaProducto } from "@nailnet/database/stock";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionAjuste, accionConsumo, accionGuardarProducto, accionPrecioProducto, accionRevertir, accionTransferencia } from "../acciones";
import { TIPOS_MOVIMIENTO, UNIDADES_ETIQUETA, cantidad, fechaHora, pesos } from "../formato";

export const metadata: Metadata = { title: "Producto · Sicurella" };

/** Ficha del producto en la sede elegida: saldo, precio local, operaciones y movimientos. */
export default async function Producto({ params }: { params: Promise<{ productoId: string }> }) {
  const { productoId } = await params;
  const { sesion, organizacion, sede, sedes, puede } = await requerirOrganizacion();
  if (!puede.verStock || !sede) notFound();
  const ficha = await fichaProducto(db(), sesion.usuario.id, organizacion.id, productoId, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!ficha) notFound();
  const { producto: p } = ficha;
  const otras = sedes.filter(s => s.id !== sede.id);
  const ocultos = <><input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="productoId" value={p.id} /></>;

  return <section className="panel">
    <p className="eyebrow"><Link href="/stock">STOCK</Link> · {sede.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>{p.nombre}</h1><span className="tag estado-confirmada">{cantidad(ficha.cantidad, p.unidad)}</span></div>
    <p className="intro">{[p.sku, UNIDADES_ETIQUETA[p.unidad], p.vendible ? `Vendible · ${pesos(p.precio)} en esta sede` : "Solo consumo interno", p.activo ? null : "Inactivo"].filter(Boolean).join(" · ")}</p>

    {ficha.otrasSedes.length > 0 && <p className="ayuda">En otras sedes: {ficha.otrasSedes.map(s => `${s.sede} ${cantidad(s.cantidad, p.unidad)}`).join(" · ")}</p>}

    {ficha.puede.consumir && <details className="desplegable"><summary>Registrar consumo interno</summary>
      <Formulario accion={accionConsumo} boton="Registrar consumo" className="en-linea">
        {ocultos}
        <input name="cantidad" required inputMode="decimal" placeholder={`Cantidad (${UNIDADES_ETIQUETA[p.unidad].toLowerCase()})`} aria-label="Cantidad consumida" />
        <input name="motivo" maxLength={300} placeholder="Detalle (opcional)" aria-label="Detalle" />
      </Formulario>
    </details>}

    {ficha.puede.gestionar && <details className="desplegable"><summary>Ajuste por conteo físico</summary>
      <Formulario accion={accionAjuste} boton="Registrar ajuste" className="en-linea">
        {ocultos}
        <input name="contado" required inputMode="decimal" placeholder="Cantidad contada" aria-label="Cantidad contada" />
        <input name="motivo" required maxLength={300} placeholder="Motivo (obligatorio)" aria-label="Motivo del ajuste" />
      </Formulario>
      <p className="ayuda">Cargá lo que hay en la sede: se registra la diferencia con el stock actual ({cantidad(ficha.cantidad, p.unidad)}).</p>
    </details>}

    {ficha.puede.gestionar && otras.length > 0 && <details className="desplegable"><summary>Transferir a otra sede</summary>
      <Formulario accion={accionTransferencia} boton="Transferir" className="en-linea">
        {ocultos}
        <select name="destinoId" aria-label="Sede de destino">{otras.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
        <input name="cantidad" required inputMode="decimal" placeholder="Cantidad" aria-label="Cantidad a transferir" className="corto" />
        <input name="motivo" maxLength={300} placeholder="Detalle (opcional)" aria-label="Detalle" />
      </Formulario>
      <p className="ayuda">Sale de {sede.nombre} y entra en la otra sede en el mismo momento. Hace falta permiso de stock en las dos.</p>
    </details>}

    {ficha.puede.precio && p.vendible && <details className="desplegable"><summary>Precio de venta en {sede.nombre}</summary>
      <Formulario accion={accionPrecioProducto} boton="Guardar precio" className="en-linea">
        {ocultos}
        <input name="precio" defaultValue={p.precio ?? ""} inputMode="decimal" placeholder="Sin precio" aria-label="Precio de venta" />
      </Formulario>
    </details>}

    {ficha.puede.administrar && <details className="desplegable"><summary>Editar producto (todas las sedes)</summary>
      <Formulario accion={accionGuardarProducto} boton="Guardar producto">
        <input type="hidden" name="productoId" value={p.id} />
        <div className="grilla">
          <label>Nombre<input name="nombre" required maxLength={120} defaultValue={p.nombre} /></label>
          <label>Código<input name="sku" maxLength={40} defaultValue={p.sku ?? ""} /></label>
          <label>Unidad de medida<select name="unidad" defaultValue={p.unidad}>{UNIDADES.map(u => <option key={u} value={u}>{UNIDADES_ETIQUETA[u]}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" name="vendible" defaultChecked={p.vendible} />Se vende en recepción</label>
        <label className="check"><input type="checkbox" name="activo" defaultChecked={p.activo} />Activo</label>
      </Formulario>
    </details>}

    <h2 className="subtitulo">Movimientos en {sede.nombre}</h2>
    <div className="tabla">
      {ficha.movimientos.map(m => <article key={m.id} className={m.revertido ? "fila inactiva" : "fila"}>
        <div className="fila-cabecera">
          <h2>{TIPOS_MOVIMIENTO[m.tipo]}{m.revertido && <span className="tag">Revertido</span>}</h2>
          <span className="tag">{cantidad(m.cantidad, p.unidad, true)} → {cantidad(m.saldo, p.unidad)}</span>
        </div>
        <p>{[fechaHora(m.fecha, sede.timezone), m.actor,
          m.compra && `${m.compra.proveedor}${m.compra.comprobante ? ` (${m.compra.comprobante})` : ""} · ${pesos(m.compra.costoUnitario)} c/u`,
          m.otraSede && (m.tipo === "TRANSFERENCIA_SALIDA" ? `a ${m.otraSede}` : `desde ${m.otraSede}`), m.motivo].filter(Boolean).join(" · ")}</p>
        {ficha.puede.gestionar && m.reversible && <details><summary>Revertir</summary>
          <Formulario accion={accionRevertir} boton="Revertir movimiento" className="en-linea" secundario confirmar="¿Registrar un movimiento inverso que anule este?">
            <input type="hidden" name="movimientoId" value={m.id} />
            <input name="motivo" required maxLength={300} placeholder="Motivo (obligatorio)" aria-label="Motivo del reverso" />
          </Formulario>
        </details>}
      </article>)}
      {!ficha.movimientos.length && <p>Todavía no hay movimientos de este producto en la sede.</p>}
    </div>
    {ficha.movimientos.length === 200 && <p className="ayuda pie-tabla">Se muestran los últimos 200 movimientos.</p>}
  </section>;
}
