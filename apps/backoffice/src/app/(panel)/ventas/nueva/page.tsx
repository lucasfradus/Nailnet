import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AccesoDenegado } from "@nailnet/domain";
import { listarClientes } from "@nailnet/database/clientes";
import { prepararVenta } from "@nailnet/database/ventas";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionAtendida } from "../../acciones";
import { cantidad } from "../../stock/formato";
import { accionAsignarFicha, accionCrearFichaTurno, accionRegistrarVenta } from "../acciones";
import { FILAS_PRODUCTO, FILAS_SERVICIO, PestanasVentas, pesos } from "../comun";
import { CobroRapido } from "./cobro-rapido";

export const metadata: Metadata = { title: "Cobrar · Sicurella" };

/**
 * Cobro en recepción. Con un turno (?reserva=…, con o sin reserva previa) se carga la comanda: los
 * servicios realmente hechos, con la profesional de cada uno y el precio cobrado (se propone el pactado
 * o el de lista), más productos opcionales. Sin turno: venta de productos sueltos. Se pueden cargar
 * varios cobros (medios distintos) o dejar saldo para cobrar después desde la venta.
 */
export default async function NuevaVenta({ searchParams }: { searchParams: Promise<{ reserva?: string; buscar?: string }> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verVentas || !sede) notFound();
  const datos = await prepararVenta(db(), sesion.usuario.id, organizacion.id, sede.id, q.reserva || null).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!datos) notFound();
  const turno = datos.turno;
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: sede.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // Filas de la comanda: primero los servicios del turno (precio pactado), después filas vacías para agregar.
  // Doc 31, etapa 2: turno de una clienta sentada con solo el nombre. Antes de cobrar se le busca o se le
  // crea la ficha (con el nombre y el teléfono que dejó en la espera); se puede cobrar igual, con aviso.
  const sinFicha = turno && !turno.cliente;
  const buscar = q.buscar?.trim() ?? "";
  const candidatos = sinFicha && buscar ? await listarClientes(db(), sesion.usuario.id, organizacion.id, { texto: buscar }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }) : [];

  return <section className="panel">
    <p className="eyebrow"><Link href="/ventas">VENTAS</Link> · {sede.nombre.toUpperCase()}</p>
    <h1>{turno ? "Cobrar turno" : "Venta de productos"}</h1>
    {!turno && <PestanasVentas actual="nueva" />}

    {turno && <div className="tabla">
      <article className="fila">
        <div className="fila-cabecera"><h2>{turno.cliente ? <Link href={`/clientes/${turno.cliente.id}`}>{turno.cliente.nombre} {turno.cliente.apellido ?? ""}</Link> : <>{turno.clienteProvisional ?? turno.espera?.nombre ?? "Clienta"} <span className="tag sin-ficha">Sin ficha</span></>}</h2><span className="tag">Turno {pesos(turno.subtotal)}</span></div>
        <ul>{turno.items.map((i, n) => <li key={n}>{hora(i.inicio)} · {i.servicio} con {i.profesional}: {pesos(i.precio)}</li>)}</ul>
        {turno.anticipo !== "0.00" && <p>Seña cobrada por Mercado Pago: <strong>{pesos(turno.anticipo)}</strong>. Se aplica como anticipo: no se vuelve a cobrar ni entra en la caja.</p>}
        {turno.errorAnticipo && <p className="alerta error">{turno.errorAnticipo}</p>}
      </article>
    </div>}

    {sinFicha && !turno.ventaId && <section className="form-seccion ficha-turno" aria-labelledby="t-ficha">
      <h2 id="t-ficha">Ficha de la clienta</h2>
      <p className="ayuda">Se sentó sin ficha. Buscala o creala para que la venta quede a su nombre.</p>
      <form className="en-linea" action="/ventas/nueva">
        <input type="hidden" name="reserva" value={turno.id} />
        <input name="buscar" defaultValue={buscar || turno.espera?.telefono || turno.clienteProvisional || ""} placeholder="Nombre, teléfono o email" aria-label="Buscar ficha" />
        <button className="secundario">Buscar</button>
      </form>
      {buscar && (candidatos.length ? <div className="tabla">{candidatos.slice(0, 8).map(c => <article key={c.id} className="fila">
        <div className="fila-cabecera">
          <div><h2>{c.nombre} {c.apellido ?? ""}</h2><p>{[c.telefono, c.email].filter(Boolean).join(" · ") || "Sin contacto"}</p></div>
          <Formulario accion={accionAsignarFicha} boton="Asignar" className="en-linea" secundario>
            <input type="hidden" name="reservaId" value={turno.id} /><input type="hidden" name="clienteId" value={c.id} />
          </Formulario>
        </div>
      </article>)}</div> : <p className="ayuda">Ninguna ficha coincide con «{buscar}».</p>)}
      <details className="desplegable" open={!!buscar && !candidatos.length}>
        <summary>+ Crear la ficha</summary>
        <Formulario accion={accionCrearFichaTurno} boton="Crear y asignar">
          <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="reservaId" value={turno.id} />
          <div className="grilla">
            <label>Nombre<input name="nombre" required maxLength={80} defaultValue={turno.espera?.nombre ?? turno.clienteProvisional ?? ""} autoComplete="off" /></label>
            <label><span>Apellido <span className="opcional">(opcional)</span></span><input name="apellido" maxLength={80} autoComplete="off" /></label>
            <label>Teléfono<input name="telefono" inputMode="tel" defaultValue={turno.espera?.telefono ?? ""} autoComplete="off" /></label>
            <label><span>Email <span className="opcional">(opcional si hay teléfono)</span></span><input name="email" type="email" autoComplete="off" /></label>
          </div>
          <p className="ayuda">Alcanza con el nombre y un teléfono o email. El resto se completa después en la ficha.</p>
        </Formulario>
      </details>
      <p className="alerta aviso">Si la clienta no quiere dar sus datos, podés cobrar igual: la venta queda sin ficha.</p>
    </section>}

    {turno?.ventaId ? <p className="alerta ok">Este turno ya tiene una venta. <Link href={`/ventas/${turno.ventaId}`}>Ver la venta</Link></p>
      : turno && turno.estado !== "ATENDIDA" ? <div className="tabla">
        <p className="alerta error">El turno no está marcado como atendido. Se cobra después de atender.</p>
        {turno.estado === "CONFIRMADA" && <Formulario accion={accionAtendida} boton="Marcar atendido" className="en-linea" secundario><input type="hidden" name="reservaId" value={turno.id} /></Formulario>}
      </div>
      : <CobroRapido accion={accionRegistrarVenta} sedeId={sede.id} reservaId={turno?.id ?? null}
        // Clave de idempotencia: un doble envío de este formulario devuelve la misma venta.
        clave={randomUUID()}
        turnoItems={turno?.items.map(i => ({ reservaItemId: i.reservaItemId, servicioId: i.servicioId, profesionalId: i.profesionalId, precio: i.precio })) ?? []}
        servicios={datos.servicios} profesionales={datos.profesionales}
        productos={datos.productos.map(p => ({ id: p.id, nombre: p.nombre, precio: p.precio, stock: cantidad(p.stock, p.unidad) }))}
        medios={datos.medios.map(m => ({ id: m.id, nombre: m.nombre, tipo: m.tipo, ajuste: m.ajuste.toString() }))}
        redondeo={datos.redondeo} anticipo={turno?.anticipo ?? "0.00"} cajaAbierta={datos.cajaAbierta}
        maxServicios={FILAS_SERVICIO} maxProductos={FILAS_PRODUCTO} />}
  </section>;
}
