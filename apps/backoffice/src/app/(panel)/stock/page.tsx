import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { UNIDADES } from "@nailnet/domain/stock";
import { stockSede } from "@nailnet/database/stock";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionConsumo, accionGuardarProducto } from "./acciones";
import { UNIDADES_ETIQUETA, cantidad, pesos } from "./formato";

export const metadata: Metadata = { title: "Stock · Sicurella" };

/** Stock de la sede elegida arriba: saldo de cada producto, consumo interno rápido y alta de productos (master). */
export default async function Stock() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verStock) notFound();
  if (!sede) return <section className="panel"><p className="eyebrow">STOCK</p><h1>Stock</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const stock = await stockSede(db(), sesion.usuario.id, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!stock) notFound();
  const activos = stock.productos.filter(p => p.activo);

  return <section className="panel">
    <p className="eyebrow">STOCK · {sede.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>Stock</h1><Link href="/stock/compras" className="boton secundario">Compras</Link></div>

    <div className="tabla">
      {stock.productos.map(p => <Link key={p.id} href={`/stock/${p.id}`} className={p.activo ? "fila fila-enlace" : "fila fila-enlace inactiva"}>
        <div className="fila-enlace-texto">
          <h2>{p.nombre}{p.sku && <span className="tag">{p.sku}</span>}</h2>
          <p>{p.vendible ? `Vendible · ${pesos(p.precio)}` : "Consumo interno"}{p.activo ? "" : " · inactivo"}</p>
        </div>
        <span className={p.cantidad === "0" ? "tag" : "tag estado-confirmada"}>{cantidad(p.cantidad, p.unidad)}</span>
        <span className="boton secundario">Ver ficha</span>
      </Link>)}
      {!stock.productos.length && <p>La organización todavía no cargó productos.</p>}
    </div>
    <p className="ayuda pie-tabla">El saldo de cada sede es la suma de sus movimientos. Nada se edita ni se borra: los errores se corrigen con un reverso desde la ficha del producto.</p>

    {stock.puede.consumir && activos.length > 0 && <details className="desplegable">
      <summary>+ Registrar consumo interno</summary>
      <Formulario accion={accionConsumo} boton="Registrar consumo">
        <input type="hidden" name="sedeId" value={sede.id} />
        <div className="grilla">
          <label>Producto<select name="productoId" required>{activos.map(p => <option key={p.id} value={p.id}>{p.nombre} ({cantidad(p.cantidad, p.unidad)})</option>)}</select></label>
          <label>Cantidad<input name="cantidad" required inputMode="decimal" placeholder="0,5" /></label>
          <label>Detalle (opcional)<input name="motivo" maxLength={300} placeholder="Gabinete 2, turno de la tarde" /></label>
        </div>
        <p className="ayuda">Hasta 3 decimales, en la unidad del producto. Si no alcanza el stock, no se registra nada.</p>
      </Formulario>
    </details>}

    {stock.puede.administrarProductos && <details className="desplegable">
      <summary>+ Nuevo producto</summary>
      <Formulario accion={accionGuardarProducto} boton="Crear producto">
        <div className="grilla">
          <label>Nombre<input name="nombre" required maxLength={120} placeholder="Esmalte semipermanente rojo 15 ml" /></label>
          <label>Código (opcional)<input name="sku" maxLength={40} /></label>
          <label>Unidad de medida<select name="unidad" defaultValue="UNIDAD">{UNIDADES.map(u => <option key={u} value={u}>{UNIDADES_ETIQUETA[u]}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" name="vendible" />Se vende en recepción (si no, es solo de consumo interno)</label>
        <p className="ayuda">Los productos son comunes a todas las sedes; cada sede tiene su stock y su precio de venta. La unidad no se puede cambiar una vez que hay movimientos.</p>
      </Formulario>
    </details>}
  </section>;
}
