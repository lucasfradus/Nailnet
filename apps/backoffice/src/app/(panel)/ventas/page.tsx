import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { DatosInvalidos } from "@nailnet/database/access";
import { listarVentas } from "@nailnet/database/ventas";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { ESTADOS_VENTA, MEDIOS_COBRO_ETIQUETA, PestanasVentas, fechaCorta, instante, pesos } from "./comun";

export const metadata: Metadata = { title: "Ventas · Sicurella" };
const sumar = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Ventas del día de la sede elegida arriba, con lo vendido, las señas aplicadas y lo cobrado por medio. */
export default async function Ventas({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verVentas) notFound();
  if (!sede) return <section className="panel"><h1>Ventas</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const hoy = aLocal(new Date(), sede.timezone).fecha;
  const consulta = await listarVentas(db(), sesion.usuario.id, organizacion.id, { sedeId: sede.id, fecha: q.fecha || undefined }).then(lista => ({ lista, error: null }), (e: unknown) => {
    if (e instanceof AccesoDenegado) return null;
    if (e instanceof DatosInvalidos) return { lista: null, error: e.message };
    throw e;
  });
  if (!consulta) notFound();
  const lista = consulta.lista ?? await listarVentas(db(), sesion.usuario.id, organizacion.id, { sedeId: sede.id });
  const t = lista.totales;

  return <section className="panel">
    <p className="eyebrow">VENTAS · {sede.nombre.toUpperCase()}</p>
    <h1>Ventas del {fechaCorta(lista.fecha)}</h1>
    <PestanasVentas actual="ventas" />
    <nav className="en-linea">
      <Link href={`/ventas?fecha=${sumar(lista.fecha, -1)}`}>← Anterior</Link>
      <Link href="/ventas">Hoy</Link>
      {lista.fecha < hoy && <Link href={`/ventas?fecha=${sumar(lista.fecha, 1)}`}>Siguiente →</Link>}
    </nav>
    {consulta.error && <p className="alerta error" role="alert">{consulta.error} Se muestra el día de hoy.</p>}

    <div className="resumen gastos-totales">
      <article className="fila"><p>Vendido</p><strong>{pesos(t.vendido)}</strong><small>{t.cantidad} venta{t.cantidad === 1 ? "" : "s"} sin anuladas</small></article>
      <article className="fila"><p>Señas aplicadas</p><strong>{pesos(t.senasAplicadas)}</strong><small>Cobradas antes por Mercado Pago: no entran en la caja</small></article>
      <article className="fila"><p>Cobrado en recepción</p><strong>{pesos(t.cobrado)}</strong><small>Efectivo {pesos(t.efectivo)} · otros medios {pesos(t.noEfectivo)}</small>
        {t.porMedio.length > 0 && <ul>{t.porMedio.map(m => <li key={m.medio}>{MEDIOS_COBRO_ETIQUETA[m.medio]}: {pesos(m.total)}</li>)}</ul>}</article>
      <article className="fila"><p>Pendiente de cobro</p><strong>{pesos(t.pendiente)}</strong><small>Ventas con saldo</small></article>
    </div>

    <div className="tabla">
      {lista.ventas.map(v => <Link key={v.id} href={`/ventas/${v.id}`} className={v.estado === "ANULADA" ? "fila fila-enlace inactiva" : "fila fila-enlace"}>
        <div className="fila-enlace-texto">
          <h2>{v.items.map(i => i.descripcion).join(" + ")}</h2>
          <p>{instante(v.creadaEn, sede.timezone)} · {v.cliente ? `${v.cliente.nombre} ${v.cliente.apellido ?? ""}` : "Sin cliente"} · {pesos(v.total)}
            {v.anticipo !== "0.00" ? ` (seña ${pesos(v.anticipo)})` : ""}{v.estado === "PENDIENTE" ? ` · falta ${pesos(v.saldo)}` : ""}</p>
        </div>
        <span className={`tag estado-${v.estado.toLowerCase()}`}>{ESTADOS_VENTA[v.estado]}</span>
        <span className="boton secundario">Ver</span>
      </Link>)}
      {!lista.ventas.length && <p>Sin ventas este día.</p>}
    </div>
    <p className="ayuda pie-tabla">Los turnos se cobran desde la agenda, una vez marcados como atendidos. Una venta no se edita ni se borra: se anula con un reverso.</p>
  </section>;
}
