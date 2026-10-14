import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { estadoCaja } from "@nailnet/database/caja";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { instante, pesos } from "../ventas/comun";
import { accionAbrirCaja, accionCerrarCaja, accionMovimientoCaja } from "./acciones";
import { MovimientosCaja, ResumenCaja } from "./detalle";

export const metadata: Metadata = { title: "Caja · Sicurella" };

/** Caja de la sede elegida arriba: apertura, movimientos de efectivo, cierre con conteo e historial de cierres. */
export default async function Caja() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verCaja) notFound();
  if (!sede) return <section className="panel"><h1>Caja</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const estado = await estadoCaja(db(), sesion.usuario.id, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!estado) notFound();
  const tz = sede.timezone;
  const caja = estado.abierta;

  return <section className="panel">
    <p className="eyebrow">CAJA · {sede.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>{caja ? "Caja abierta" : "Caja cerrada"}</h1>
      {caja && <span className="tag estado-completada">Abierta por {caja.abiertaPor} el {instante(caja.abiertaEn, tz)}</span>}</div>

    {!caja && (estado.puedeOperar ? <details className="desplegable" open>
      <summary>Abrir caja</summary>
      <Formulario accion={accionAbrirCaja} boton="Abrir caja">
        <input type="hidden" name="sedeId" value={sede.id} />
        <label>Efectivo inicial ($)<input name="montoInicial" required inputMode="decimal" placeholder="0" pattern="\d{1,10}([.,]\d{1,2})?" /></label>
        <p className="ayuda">Contá el efectivo con que arranca el día (el cambio). Mientras la caja esté cerrada no se puede cobrar en efectivo; con tarjeta, transferencia o Mercado Pago sí.</p>
      </Formulario>
    </details> : <p className="intro">No hay una caja abierta en la sede.</p>)}

    {caja && <>
      <ResumenCaja caja={caja} />
      {estado.puedeOperar && <div className="resumen">
        <details className="desplegable">
          <summary>+ Entrada o salida de efectivo</summary>
          <Formulario accion={accionMovimientoCaja} boton="Registrar">
            <input type="hidden" name="sedeId" value={sede.id} />
            <div className="grilla">
              <label>Tipo<select name="tipo" defaultValue="SALIDA"><option value="SALIDA">Salida (retiro, depósito)</option><option value="ENTRADA">Entrada (cambio, aporte)</option></select></label>
              <label>Monto ($)<input name="monto" required inputMode="decimal" pattern="\d{1,10}([.,]\d{1,2})?" /></label>
            </div>
            <label>Motivo<input name="motivo" required minLength={5} maxLength={300} placeholder="Retiro para depositar en el banco" /></label>
            <p className="ayuda">Los gastos en efectivo se cargan en Gastos y salen de la caja solos. Un movimiento no se edita: se revierte.</p>
          </Formulario>
        </details>
        <details className="desplegable">
          <summary>Cerrar caja</summary>
          <Formulario accion={accionCerrarCaja} boton="Cerrar caja" confirmar="¿Cerrar la caja? El cierre queda fijo y no se puede reabrir.">
            <input type="hidden" name="cajaId" value={caja.id} />
            <label>Efectivo contado ($)<input name="contado" required inputMode="decimal" pattern="\d{1,10}([.,]\d{1,2})?" /></label>
            <label>Observaciones (opcional)<input name="observaciones" maxLength={500} placeholder="Explicá la diferencia, si la hay" /></label>
            <p className="ayuda">Contá solo el efectivo. La diferencia es contado − esperado ({pesos(caja.esperado)}). Los cobros con otros medios no se cuentan.</p>
          </Formulario>
        </details>
      </div>}
      <h2 className="subtitulo">Movimientos de efectivo</h2>
      <MovimientosCaja caja={caja} tz={tz} puedeRevertir={estado.puedeOperar} />
    </>}

    <h2 className="subtitulo">Cierres anteriores</h2>
    <div className="tabla">
      {estado.cierres.map(c => <Link key={c.id} href={`/caja/${c.id}`} className="fila fila-enlace">
        <div className="fila-enlace-texto">
          <h2>{instante(c.abiertaEn, tz)} → {instante(c.cerradaEn, tz)}</h2>
          <p>Esperado {pesos(c.esperado)} · contado {pesos(c.contado)} · cerró {c.cerradaPor}{c.observaciones ? ` · ${c.observaciones}` : ""}</p>
        </div>
        <span className={c.diferencia === "0.00" ? "tag estado-completada" : "tag estado-anulada"}>{c.diferencia === "0.00" ? "Sin diferencia" : pesos(c.diferencia)}</span>
        <span className="boton secundario">Ver</span>
      </Link>)}
      {!estado.cierres.length && <p>Todavía no hay cierres.</p>}
    </div>
  </section>;
}
