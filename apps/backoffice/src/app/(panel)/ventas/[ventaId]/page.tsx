import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { MEDIOS_COBRO } from "@nailnet/domain/ventas";
import { obtenerVenta } from "@nailnet/database/ventas";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { cantidad } from "../../stock/formato";
import { accionAnularVenta, accionRegistrarCobro } from "../acciones";
import { ESTADOS_VENTA, MEDIOS_COBRO_ETIQUETA, fechaCorta, instante, pesos } from "../comun";

export const metadata: Metadata = { title: "Venta · Sicurella" };

/** Detalle de una venta: ítems, seña aplicada, cobros (con sus reversos), cobro del saldo y anulación. */
export default async function Venta({ params }: { params: Promise<{ ventaId: string }> }) {
  const { ventaId } = await params;
  const { sesion, organizacion, puede, sedes } = await requerirOrganizacion();
  if (!puede.verVentas) notFound();
  const v = await obtenerVenta(db(), sesion.usuario.id, organizacion.id, ventaId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!v) notFound();
  const sede = sedes.find(s => s.id === v.sedeId);
  const tz = sede?.timezone ?? "America/Argentina/Buenos_Aires";

  return <section className="panel">
    <p className="eyebrow"><Link href={`/ventas?fecha=${v.fecha}`}>VENTAS</Link> · {sede?.nombre.toUpperCase() ?? ""}</p>
    <div className="fila-cabecera"><h1>Venta del {fechaCorta(v.fecha)}</h1><span className={`tag estado-${v.estado.toLowerCase()}`}>{ESTADOS_VENTA[v.estado]}</span></div>
    <p className="intro">{v.cliente ? <Link href={`/clientes/${v.cliente.id}`}>{v.cliente.nombre} {v.cliente.apellido}</Link> : "Sin cliente"} · registrada por {v.registradoPor} el {instante(v.creadaEn, tz)}</p>

    <div className="tabla">
      {v.items.map((i, n) => <article key={n} className="fila fila-cabecera">
        <span>{i.descripcion}{i.tipo === "PRODUCTO" && i.unidad ? ` × ${cantidad(i.cantidad, i.unidad)} a ${pesos(i.precioUnitario)}` : ""}{i.tipo === "SERVICIO" && i.precioLista && i.precioLista !== i.precioUnitario ? ` (lista ${pesos(i.precioLista)})` : ""}</span>
        <span className="tag">{pesos(i.subtotal)}</span>
      </article>)}
    </div>

    <div className="resumen gastos-totales">
      <article className="fila"><p>Total</p><strong>{pesos(v.total)}</strong><small>Subtotal {pesos(v.subtotal)}{v.descuento !== "0.00" ? ` − descuento ${pesos(v.descuento)}` : ""}</small></article>
      {v.anticipo !== "0.00" && <article className="fila"><p>Seña aplicada</p><strong>{pesos(v.anticipo)}</strong><small>Cobrada por Mercado Pago al reservar: no es un ingreso de caja</small></article>}
      <article className="fila"><p>Cobrado en recepción</p><strong>{pesos(v.cobrado)}</strong><small>Neto de reversos</small></article>
      <article className="fila"><p>Saldo</p><strong>{pesos(v.saldo)}</strong><small>{v.estado === "COMPLETADA" ? "Cobrada por completo" : v.estado === "ANULADA" ? "Venta anulada" : "Falta cobrar"}</small></article>
    </div>

    <h2 className="subtitulo">Cobros</h2>
    <div className="tabla">
      {v.cobros.map(c => <article key={c.id} className={c.revertido ? "fila inactiva" : "fila"}>
        <div className="fila-cabecera">
          <span>{c.tipo === "REVERSO" ? "Reverso · " : ""}{MEDIOS_COBRO_ETIQUETA[c.medio]}{c.referencia ? ` · ${c.referencia}` : ""}</span>
          <span className={c.tipo === "REVERSO" ? "tag importe-negativo" : c.revertido ? "tag gasto-anulado" : "tag"}>{pesos(c.monto)}</span>
        </div>
        <p className="ayuda">{c.por} · {instante(c.en, tz)}{c.motivo ? ` · ${c.motivo}` : ""}</p>
      </article>)}
      {!v.cobros.length && <p>{v.anticipo !== "0.00" ? "Sin cobros en recepción: solo la seña." : "Sin cobros todavía."}</p>}
    </div>

    {v.puede.cobrar && <details className="desplegable" open>
      <summary>+ Registrar cobro</summary>
      <Formulario accion={accionRegistrarCobro} boton="Registrar cobro">
        <input type="hidden" name="ventaId" value={v.id} />
        <input type="hidden" name="clave" value={randomUUID()} />
        <div className="grilla">
          <label>Medio<select name="medio" defaultValue="EFECTIVO">{MEDIOS_COBRO.map(m => <option key={m} value={m}>{MEDIOS_COBRO_ETIQUETA[m]}</option>)}</select></label>
          <label>Monto ($)<input name="monto" required inputMode="decimal" defaultValue={v.saldo.replace(".", ",")} pattern="\d{1,10}([.,]\d{1,2})?" /></label>
          <label>Referencia (opcional)<input name="referencia" maxLength={120} placeholder="N.º de operación, cupón…" /></label>
        </div>
        <p className="ayuda">Hasta {pesos(v.saldo)}. {v.cajaAbierta ? "El efectivo entra en la caja abierta." : "La caja está cerrada: solo se puede cobrar con otros medios."}</p>
      </Formulario>
    </details>}

    {v.anulacion && <p className="alerta error">Anulada por {v.anulacion.por} el {instante(v.anulacion.en, tz)}: {v.anulacion.motivo}</p>}
    {v.puede.anular && <details className="desplegable">
      <summary>Anular venta</summary>
      <Formulario accion={accionAnularVenta} boton="Anular venta" secundario confirmar="¿Anular la venta? Se revierten todos sus cobros y no se puede deshacer.">
        <input type="hidden" name="ventaId" value={v.id} />
        <label>Motivo<input name="motivo" required minLength={5} maxLength={500} placeholder="Por qué se anula" /></label>
        {v.tieneProductos && <label className="check"><input type="checkbox" name="reponerStock" />Los productos vuelven al stock (solo si se devolvieron físicamente)</label>}
        <p className="ayuda">Cada cobro recibe un reverso: el efectivo sale de la caja abierta (tiene que estar abierta), los demás medios se devuelven por fuera del sistema. La seña de Mercado Pago queda libre para volver a cobrar el turno; devolverla es manual.</p>
      </Formulario>
    </details>}
  </section>;
}
