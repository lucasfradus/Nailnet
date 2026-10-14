import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { listarCompras, stockSede } from "@nailnet/database/stock";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionRegistrarCompra } from "../acciones";
import { UNIDADES_ETIQUETA, cantidad, hoy, pesos } from "../formato";

export const metadata: Metadata = { title: "Compras · Sicurella" };
const FILAS = 8;

/** Compras a proveedores de la sede elegida. Cada ítem ingresa stock con un movimiento COMPRA. */
export default async function Compras() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verStock || !sede) notFound();
  const actorId = sesion.usuario.id;
  const datos = await Promise.all([stockSede(db(), actorId, organizacion.id, sede.id), listarCompras(db(), actorId, organizacion.id, sede.id)])
    .catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!datos) notFound();
  const [stock, compras] = datos;
  const activos = stock.productos.filter(p => p.activo);

  return <section className="panel">
    <p className="eyebrow"><Link href="/stock">STOCK</Link> · {sede.nombre.toUpperCase()}</p>
    <h1>Compras</h1>

    {stock.puede.gestionar && activos.length > 0 && <details className="desplegable">
      <summary>+ Nueva compra</summary>
      <Formulario accion={accionRegistrarCompra} boton="Registrar compra">
        <input type="hidden" name="sedeId" value={sede.id} />
        <div className="grilla">
          <label>Proveedor<input name="proveedor" required maxLength={120} /></label>
          <label>Comprobante (opcional)<input name="comprobante" maxLength={60} placeholder="Factura A 0001-00001234" /></label>
          <label>Fecha<input name="fecha" type="date" required defaultValue={hoy(sede.timezone)} /></label>
        </div>
        <fieldset className="servicios"><legend>Productos</legend>
          {Array.from({ length: FILAS }, (_, i) => <div key={i} className="grilla">
            <select name={`producto_${i}`} aria-label={`Producto ${i + 1}`} defaultValue="">
              <option value="">{i === 0 ? "Elegí un producto" : "—"}</option>
              {activos.map(p => <option key={p.id} value={p.id}>{p.nombre} · {UNIDADES_ETIQUETA[p.unidad].toLowerCase()}</option>)}
            </select>
            <input name={`cantidad_${i}`} inputMode="decimal" placeholder="Cantidad" aria-label={`Cantidad ${i + 1}`} />
            <input name={`costo_${i}`} inputMode="decimal" placeholder="Costo unitario $" aria-label={`Costo unitario ${i + 1}`} />
          </div>)}
        </fieldset>
        <p className="ayuda">El costo es por unidad de medida del producto (por ml, por gramo o por unidad). Las filas sin producto se ignoran. Una compra no se edita: si hubo un error, revertí el ingreso desde la ficha del producto y cargala de nuevo.</p>
      </Formulario>
    </details>}

    <div className="tabla">
      {compras.map(c => <article key={c.id} className="fila">
        <div className="fila-cabecera"><h2>{c.proveedor}{c.comprobante && <span className="tag">{c.comprobante}</span>}</h2><span className="tag">{pesos(c.total)}</span></div>
        <p>{c.fecha.split("-").reverse().join("/")} · {c.items.map(i => `${i.producto} ${cantidad(i.cantidad, i.unidad)} × ${pesos(i.costoUnitario)}${i.revertido ? " (revertido)" : ""}`).join(" · ")}</p>
      </article>)}
      {!compras.length && <p>Todavía no hay compras registradas en esta sede.</p>}
    </div>
  </section>;
}
