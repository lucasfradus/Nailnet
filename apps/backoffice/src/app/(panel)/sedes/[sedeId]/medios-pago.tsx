import { MEDIOS_COBRO, type MedioCobro } from "@nailnet/domain/ventas";
import { PASOS_REDONDEO, SENTIDOS_REDONDEO, SENTIDO_ETIQUETA, TIPO_MEDIO_ETIQUETA, ajusteEditable, precioConAjuste, textoAjuste, textoRedondeo, type Redondeo } from "@nailnet/domain/medios-pago";
import { Formulario } from "@/components/formulario";
import { accionCrearMedioPago, accionGuardarMediosPago } from "../../acciones";

type Medio = { id: string; nombre: string; tipo: MedioCobro; habilitado: boolean; orden: number; ajuste: bigint; conCobros: boolean };

/** Precio de lista de ejemplo: muestra el ajuste y el redondeo con un número concreto (el del doc 32). */
const LISTA_EJEMPLO = 1_550_000n;
const pesos = (c: bigint) => `$${(c / 100n).toLocaleString("es-AR")}${c % 100n ? `,${(c % 100n).toString().padStart(2, "0")}` : ""}`;
const AJUSTE_PATRON = "[\\-+−]?\\d{1,3}([.,]\\d{1,2})?";
const mayuscula = (t: string) => t[0]!.toUpperCase() + t.slice(1);

/**
 * Medios de pago de la sede (D22, doc 32): el precio de lista es el de referencia y cada medio tiene un
 * porcentaje sobre ella. Quien administra la sede los edita todos de una vez, junto con el redondeo.
 */
export function MediosPago({ sedeId, medios, redondeo, puedeEditar }: { sedeId: string; medios: Medio[]; redondeo: Redondeo; puedeEditar: boolean }) {
  const ejemplo = (m: Medio) => pesos(precioConAjuste(LISTA_EJEMPLO, m.ajuste, redondeo));
  const cabecera = (editable: boolean) => <div className={`medio cabecera${editable ? "" : " solo-lectura"}`} role="row">
    {editable && <span role="columnheader">Orden</span>}
    <span role="columnheader">Nombre</span><span role="columnheader" className="tipo">Tipo</span>
    <span role="columnheader">Ajuste %</span><span role="columnheader" className="ejemplo">Con lista {pesos(LISTA_EJEMPLO)}</span>
    <span role="columnheader">Activo</span>
  </div>;
  return <>
    <article>
      <h2>Medios de pago</h2>
      <p className="ayuda">El precio cargado en el catálogo es el de lista. Cada medio cobra la lista o un porcentaje sobre ella: negativo es descuento (−10 para efectivo) y positivo, recargo. Los precios con ajuste se redondean {textoRedondeo(redondeo)}.</p>
      {puedeEditar ? <Formulario accion={accionGuardarMediosPago} boton="Guardar medios de pago">
        <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="cantidad" value={medios.length} />
        <div className="medios-pago" role="table" aria-label="Medios de pago de la sede">
          {cabecera(true)}
          {medios.map((m, i) => <div key={m.id} className={`medio${m.habilitado ? "" : " apagado"}`} role="row">
            <input type="hidden" name={`medio_${i}`} value={m.id} />
            <input name={`orden_${i}`} type="number" min={0} max={999} step={1} defaultValue={i + 1} aria-label={`Orden de ${m.nombre}`} />
            <input name={`nombre_${i}`} defaultValue={m.nombre} required maxLength={40} aria-label="Nombre" />
            <span className="tipo">{TIPO_MEDIO_ETIQUETA[m.tipo]}</span>
            <input name={`ajuste_${i}`} defaultValue={ajusteEditable(m.ajuste)} inputMode="decimal" pattern={AJUSTE_PATRON} title="Porcentaje: −10, 0 o 15,5" aria-label={`Ajuste de ${m.nombre} en %`} />
            <span className="ejemplo">{ejemplo(m)}</span>
            <label className="check"><input type="checkbox" name={`habilitado_${i}`} defaultChecked={m.habilitado} aria-label={`${m.nombre} activo`} />Sí</label>
          </div>)}
        </div>
        <div className="en-linea">
          <label className="campo">Redondeo de los precios con ajuste
            <select name="paso" defaultValue={String(redondeo.paso)}>{PASOS_REDONDEO.map(p => <option key={p} value={p}>{p === 0 ? "Sin redondeo (al centavo)" : `A $${p.toLocaleString("es-AR")}`}</option>)}</select>
          </label>
          <label className="campo">Sentido
            <select name="sentido" defaultValue={redondeo.sentido}>{SENTIDOS_REDONDEO.map(s => <option key={s} value={s}>{mayuscula(SENTIDO_ETIQUETA[s])}</option>)}</select>
          </label>
        </div>
        <p className="ayuda">El ejemplo se actualiza al guardar. Un medio inactivo no aparece al cobrar y sus cobros anteriores se conservan. El tipo define qué entra en la caja (solo el efectivo) y no se cambia.</p>
      </Formulario>
        : <div className="medios-pago" role="table" aria-label="Medios de pago de la sede">
          {cabecera(false)}
          {medios.map(m => <div key={m.id} className={`medio solo-lectura${m.habilitado ? "" : " apagado"}`} role="row">
            <span>{m.nombre}</span><span className="tipo">{TIPO_MEDIO_ETIQUETA[m.tipo]}</span><span>{textoAjuste(m.ajuste)}</span>
            <span className="ejemplo">{ejemplo(m)}</span><span>{m.habilitado ? "Sí" : "No"}</span>
          </div>)}
        </div>}
    </article>

    {puedeEditar && <article>
      <h2>Agregar un medio</h2>
      <p className="ayuda">Por ejemplo, «Cuenta DNI» como transferencia. Se agrega activo y al final de la lista.</p>
      <Formulario accion={accionCrearMedioPago} boton="Agregar medio" className="en-linea">
        <input type="hidden" name="sedeId" value={sedeId} />
        <input name="nombre" placeholder="Cuenta DNI" required maxLength={40} aria-label="Nombre del medio" />
        <select name="tipo" defaultValue="TRANSFERENCIA" aria-label="Tipo">{MEDIOS_COBRO.map(t => <option key={t} value={t}>{TIPO_MEDIO_ETIQUETA[t]}</option>)}</select>
        <input name="ajuste" placeholder="Ajuste % (−10)" inputMode="decimal" pattern={AJUSTE_PATRON} aria-label="Ajuste en %" className="corto" />
      </Formulario>
    </article>}
  </>;
}
