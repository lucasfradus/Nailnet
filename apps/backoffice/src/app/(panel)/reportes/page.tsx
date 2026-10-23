import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { mesDe, sumarDias } from "@nailnet/domain/gastos";
import type { Celda } from "@nailnet/domain/reportes";
import { formatoPesos } from "@nailnet/domain/ventas";
import { DatosInvalidos } from "@nailnet/database/access";
import { reporteSede } from "@nailnet/database/reportes";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { TABLAS, type Seccion } from "./tablas";

export const metadata: Metadata = { title: "Reportes · Sicurella" };
type Params = { desde?: string; hasta?: string };

const fecha = (f: string) => f.split("-").reverse().join("/");
const numero = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const pct = (n: number | null) => (n === null ? "—" : `${numero(n)} %`);
const celda = (c: Celda) => (c === null ? "—" : typeof c === "bigint" ? formatoPesos(c) : typeof c === "number" ? numero(c) : c);

/** Reportes de la sede elegida arriba para un período (L03). Cada tabla se descarga en CSV. */
export default async function Reportes({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verReportes) notFound();
  if (!sede) return <section className="panel"><h1>Reportes</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const hoy = aLocal(new Date(), sede.timezone).fecha;
  const esteMes = mesDe(hoy), mesAnterior = mesDe(sumarDias(esteMes.desde, -1));
  const pedir = (desde: string, hasta: string) => reporteSede(db(), sesion.usuario.id, organizacion.id, { sedeId: sede.id, desde, hasta });
  // Un período inválido no rompe la pantalla: avisa y muestra el mes en curso.
  const consulta = await pedir(q.desde || esteMes.desde, q.hasta || esteMes.hasta).then(r => ({ r, error: null }), (e: unknown) => {
    if (e instanceof AccesoDenegado) notFound();
    if (e instanceof DatosInvalidos) return { r: null, error: e.message };
    throw e;
  });
  const r = consulta.r ?? await pedir(esteMes.desde, esteMes.hasta);
  const periodo = `${fecha(r.desde)} al ${fecha(r.hasta)}`;

  const Tabla = ({ seccion, vacio }: { seccion: Seccion; vacio: string }) => {
    const t = TABLAS[seccion](r);
    return <>
      <div className="fila-cabecera"><h3 className="reporte-titulo">{t.titulo}</h3>
        {t.filas.length > 0 && <a className="boton secundario" href={`/reportes/csv?${new URLSearchParams({ seccion, desde: r.desde, hasta: r.hasta })}`} download>Descargar CSV</a>}</div>
      {t.filas.length ? <div className="reporte-tabla"><table>
        <thead><tr>{t.encabezados.map((e, i) => <th key={e} scope="col" className={i ? "num" : undefined}>{e}</th>)}</tr></thead>
        <tbody>{t.filas.map((f, k) => <tr key={k}>{f.map((c, i) => i ? <td key={i} className="num">{celda(c)}</td> : <th key={i} scope="row">{celda(c)}</th>)}</tr>)}</tbody>
      </table></div> : <p className="intro">{vacio}</p>}
    </>;
  };
  const Dato = ({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) =>
    <article className="fila"><p>{titulo}</p><strong>{valor}</strong>{detalle && <small>{detalle}</small>}</article>;

  return <section className="panel">
    <p className="eyebrow">REPORTES · {sede.nombre.toUpperCase()}</p>
    <h1>Reportes</h1>
    <form className="en-linea">
      <label>Desde<input type="date" name="desde" defaultValue={r.desde} /></label>
      <label>Hasta<input type="date" name="hasta" defaultValue={r.hasta} /></label>
      <button className="secundario">Ver período</button>
      <Link href={`/reportes?desde=${esteMes.desde}&hasta=${esteMes.hasta}`}>Este mes</Link>
      <Link href={`/reportes?desde=${mesAnterior.desde}&hasta=${mesAnterior.hasta}`}>Mes anterior</Link>
    </form>
    {consulta.error && <p className="alerta error" role="alert">{consulta.error}. Se muestra el mes en curso.</p>}

    <h2 className="subtitulo">Ventas</h2>
    <p className="ayuda">Por fecha de venta, {periodo}. Importes netos de descuento; las anuladas no suman.</p>
    <div className="resumen indicadores">
      <Dato titulo="Vendido" valor={formatoPesos(r.ventas.total)} detalle={`${r.ventas.cantidad} ventas · ${r.ventas.pendientes} con saldo pendiente`} />
      <Dato titulo="Ticket promedio" valor={r.ventas.ticketPromedio === null ? "—" : formatoPesos(r.ventas.ticketPromedio)} detalle={`Sobre ${r.ventas.completadas} ventas cobradas completas`} />
      <Dato titulo="Servicios / productos" valor={formatoPesos(r.ventas.servicios)} detalle={`Productos: ${formatoPesos(r.ventas.productos)} · descuentos: ${formatoPesos(r.ventas.descuentos)}`} />
      <Dato titulo="Anuladas" valor={formatoPesos(r.ventas.anuladas.total)} detalle={`${r.ventas.anuladas.cantidad} ventas`} />
    </div>
    <Tabla seccion="profesionales" vacio="Sin servicios vendidos en el período." />
    <Tabla seccion="servicios" vacio="Sin servicios vendidos en el período." />

    <h2 className="subtitulo">Cobros</h2>
    <p className="ayuda">Por fecha del cobro, {periodo}. Las devoluciones de ventas anuladas figuran como revertido.</p>
    <div className="resumen indicadores">
      <Dato titulo="Cobrado neto" valor={formatoPesos(r.cobros.neto)} detalle={`Revertido: ${formatoPesos(r.cobros.revertido)}`} />
      <Dato titulo="Señas por Mercado Pago" valor={formatoPesos(r.cobros.senas.total)} detalle={`${r.cobros.senas.cantidad} señas aprobadas · en la venta se aplican como anticipo`} />
    </div>
    <Tabla seccion="cobros" vacio="Sin cobros en el período." />

    <h2 className="subtitulo">Turnos y clientes</h2>
    <p className="ayuda">Por día del turno, {periodo}. Una reprogramación no cuenta como cancelación.</p>
    <div className="resumen indicadores">
      <Dato titulo="Turnos" valor={numero(r.turnos.total)} detalle={`${r.turnos.atendidos} atendidos · ${r.turnos.sinTurnoPrevio} sin turno previo`} />
      <Dato titulo="Ausentismo" valor={pct(r.turnos.tasaAusentismo)} detalle={`${r.turnos.ausentes} ausentes sobre ${r.turnos.atendidos + r.turnos.ausentes} que debían venir`} />
      <Dato titulo="Cancelación" valor={pct(r.turnos.tasaCancelacion)} detalle={`${r.turnos.cancelados} cancelados sobre ${r.turnos.total} turnos`} />
      <Dato titulo="Clientes atendidos" valor={numero(r.clientes.atendidos)} detalle={`${r.clientes.nuevos} nuevos · ${r.clientes.recurrentes} recurrentes en la sede`} />
    </div>
    <Tabla seccion="turnos" vacio="Sin turnos en el período." />

    <h2 className="subtitulo">Ocupación</h2>
    <p className="ayuda">Horas con turnos sobre horas disponibles (jornada dentro del horario de la sede, menos ausencias). Los turnos pendientes de pago se muestran aparte.</p>
    <div className="resumen indicadores">
      <Dato titulo="Ocupación" valor={pct(r.ocupacion.porcentaje)} detalle={`${numero(r.ocupacion.ocupadoMinutos / 60)} h de ${numero(r.ocupacion.disponibleMinutos / 60)} h disponibles`} />
    </div>
    <Tabla seccion="ocupacion" vacio="Ningún profesional tiene jornada en el período." />

    <h2 className="subtitulo">Recepción</h2>
    <p className="ayuda">Lo que registra el tablero de recepción, {periodo}. En el local: entre la entrada y la salida que marca recepción. Atendiendo: desde que empieza cada servicio hasta «Terminó». Las atenciones cuentan por el día en que terminaron; la espera, por el día en que se anotó la clienta.</p>
    <div className="resumen indicadores">
      <Dato titulo="Duración real promedio" valor={r.recepcion.atenciones.duracionReal === null ? "—" : `${numero(r.recepcion.atenciones.duracionReal)} min`}
        detalle={`Estimada: ${r.recepcion.atenciones.duracionEstimada === null ? "—" : `${numero(r.recepcion.atenciones.duracionEstimada)} min`} · ${r.recepcion.atenciones.demoradas} de ${r.recepcion.atenciones.cantidad} se pasaron`} />
      <Dato titulo="Espera promedio" valor={r.recepcion.espera.promedioMinutos === null ? "—" : `${numero(r.recepcion.espera.promedioMinutos)} min`} detalle={`${r.recepcion.espera.atendidas} atendidas de la lista`} />
      <Dato titulo="Se fueron sin atenderse" valor={numero(r.recepcion.espera.seFueron)} detalle={`Abandono: ${pct(r.recepcion.espera.tasaAbandono)}`} />
    </div>
    <Tabla seccion="recepcion" vacio="Sin presencias ni atenciones terminadas en el tablero en el período." />
    <Tabla seccion="espera" vacio="Nadie se anotó en la lista de espera en el período." />

    <h2 className="subtitulo">Comisiones</h2>
    <p className="ayuda">Base comisionable: servicios de ventas que quedaron cobradas completas en el período, después de descuentos, sin productos. El porcentaje a pagar todavía no está definido; cuando se defina se agrega el importe.</p>
    <div className="resumen indicadores">
      <Dato titulo="Base comisionable" valor={formatoPesos(r.comisiones.base)} detalle={`${r.comisiones.servicios} servicios`} />
    </div>
    <Tabla seccion="comisiones" vacio="Ninguna venta quedó cobrada completa en el período." />
  </section>;
}
