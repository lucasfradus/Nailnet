import Link from "next/link";
import type { TipoMovimientoCaja } from "@nailnet/domain/caja";
import type { obtenerCaja } from "@nailnet/database/caja";
import { Formulario } from "@/components/formulario";
import { MEDIOS_COBRO_ETIQUETA, instante, pesos } from "../ventas/comun";
import { accionRevertirMovimientoCaja } from "./acciones";

export const TIPOS_MOVIMIENTO_CAJA: Record<TipoMovimientoCaja, string> = {
  INGRESO_COBRO: "Cobro en efectivo", EGRESO_GASTO: "Gasto en efectivo", ENTRADA: "Entrada", SALIDA: "Salida", REVERSO: "Reverso",
};

type Caja = Omit<Awaited<ReturnType<typeof obtenerCaja>>, "puedeOperar">;

/** Resumen de efectivo (lo que se cuenta) y, aparte, los cobros con otros medios (lo que no se cuenta). */
export function ResumenCaja({ caja }: { caja: Caja }) {
  return <div className="resumen gastos-totales">
    <article className="fila"><p>Efectivo esperado</p><strong>{pesos(caja.esperado)}</strong>
      <ul>
        <li>Inicial: {pesos(caja.montoInicial)}</li>
        <li>Cobros: {pesos(caja.porTipo.INGRESO_COBRO)}</li>
        <li>Gastos: {pesos(caja.porTipo.EGRESO_GASTO)}</li>
        <li>Entradas: {pesos(caja.porTipo.ENTRADA)} · salidas: {pesos(caja.porTipo.SALIDA)}</li>
        <li>Reversos: {pesos(caja.porTipo.REVERSO)}</li>
      </ul></article>
    <article className="fila"><p>Otros medios (no se cuentan)</p><strong>{pesos(caja.totalNoEfectivo)}</strong>
      <small>Tarjetas, transferencias y Mercado Pago cobrados con esta caja abierta. No suman al efectivo esperado.</small>
      {caja.noEfectivo.length > 0 && <ul>{caja.noEfectivo.map(m => <li key={m.medio}>{MEDIOS_COBRO_ETIQUETA[m.medio]}: {pesos(m.total)}</li>)}</ul>}</article>
    {caja.contado !== null && <article className="fila"><p>Cierre</p><strong>{pesos(caja.contado)}</strong>
      <small>Contado. Diferencia: <span className={caja.diferencia!.startsWith("-") ? "importe-negativo" : undefined}>{pesos(caja.diferencia!)}</span>{caja.observaciones ? ` · ${caja.observaciones}` : ""}</small></article>}
  </div>;
}

export function MovimientosCaja({ caja, tz, puedeRevertir }: { caja: Caja; tz: string; puedeRevertir: boolean }) {
  return <div className="tabla">
    {[...caja.movimientos].reverse().map(m => <article key={m.id} className={m.revertido ? "fila inactiva" : "fila"}>
      <div className="fila-cabecera">
        <span>{TIPOS_MOVIMIENTO_CAJA[m.tipo]}{m.gasto ? ` · ${m.gasto}` : ""}{m.motivo ? ` · ${m.motivo}` : ""}
          {m.ventaId && <> · <Link href={`/ventas/${m.ventaId}`}>ver venta</Link></>}</span>
        <span className={m.monto.startsWith("-") ? "tag importe-negativo" : "tag"}>{pesos(m.monto)}</span>
      </div>
      <p className="ayuda">{m.por} · {instante(m.fecha, tz)}{m.revertido ? " · revertido" : ""}</p>
      {puedeRevertir && m.revertible && <details><summary>Revertir</summary>
        <Formulario accion={accionRevertirMovimientoCaja} boton="Revertir" className="en-linea" secundario confirmar="¿Revertir el movimiento? Se registra el movimiento inverso en la caja abierta.">
          <input type="hidden" name="movimientoId" value={m.id} />
          <input name="motivo" required minLength={5} maxLength={500} placeholder="Motivo" aria-label="Motivo del reverso" />
        </Formulario>
      </details>}
    </article>)}
    {!caja.movimientos.length && <p>Sin movimientos todavía.</p>}
  </div>;
}
