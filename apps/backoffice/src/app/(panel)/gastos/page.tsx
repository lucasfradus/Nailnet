import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal } from "@nailnet/domain/agenda";
import { MEDIOS_PAGO_GASTO } from "@nailnet/domain/gastos";
import { DatosInvalidos } from "@nailnet/database/access";
import { hayCajaAbierta } from "@nailnet/database/caja";
import { listarCategoriasGasto, listarGastos } from "@nailnet/database/gastos";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionAnularGasto, accionRegistrarGasto } from "./acciones";
import { MEDIOS, Pestanas, pesos } from "./comun";

export const metadata: Metadata = { title: "Gastos · Sicurella" };
type Params = { desde?: string; hasta?: string; categoria?: string };

/** Gastos de la sede elegida arriba: filtros por período y categoría, totales, alta y anulación. */
export default async function Gastos({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verGastos) notFound();
  if (!sede) return <section className="panel"><h1>Gastos</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const actorId = sesion.usuario.id;
  const tz = sede.timezone;
  const hoy = aLocal(new Date(), tz).fecha;

  const cats = await listarCategoriasGasto(db(), actorId, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!cats) notFound();
  const filtro = { sedeId: sede.id, desde: q.desde || undefined, hasta: q.hasta || undefined, categoriaId: cats.categorias.some(c => c.id === q.categoria) ? q.categoria! : null };
  // Un período inválido (al revés, demasiado largo) no rompe la pantalla: avisa y muestra el mes en curso.
  const consulta = await listarGastos(db(), actorId, organizacion.id, filtro).then(lista => ({ lista, error: null }), (e: unknown) => {
    if (e instanceof DatosInvalidos) return { lista: null, error: e.message };
    throw e;
  });
  const error = consulta.error;
  const lista = consulta.lista ?? await listarGastos(db(), actorId, organizacion.id, { sedeId: sede.id });
  const activas = cats.categorias.filter(c => c.activo);
  const cajaAbierta = await hayCajaAbierta(db(), actorId, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return false; throw e; });
  const instante = (d: Date) => d.toLocaleString("es-AR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fecha = (f: string) => f.split("-").reverse().join("/");

  return <section className="panel">
    <p className="eyebrow">GASTOS · {sede.nombre.toUpperCase()}</p>
    <h1>Gastos</h1>
    <Pestanas actual="gastos" />

    <form className="en-linea">
      <label>Desde<input type="date" name="desde" defaultValue={lista.desde} max={hoy} /></label>
      <label>Hasta<input type="date" name="hasta" defaultValue={lista.hasta} /></label>
      <select name="categoria" defaultValue={filtro.categoriaId ?? ""} aria-label="Categoría">
        <option value="">Todas las categorías</option>
        {cats.categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? "" : " (inactiva)"}</option>)}
      </select>
      <button className="secundario">Filtrar</button>
    </form>
    {error && <p className="alerta error" role="alert">{error} Se muestra el mes en curso.</p>}

    <div className="resumen gastos-totales">
      <article className="fila"><p>Total del período</p><strong>{pesos(lista.total)}</strong><small>{fecha(lista.desde)} al {fecha(lista.hasta)} · sin anulados</small></article>
      <article className="fila"><p>En efectivo</p><strong>{pesos(lista.efectivo)}</strong><small>Los pagados con la caja abierta salen de ella (ver Caja)</small></article>
      {lista.porCategoria.length > 0 && <article className="fila"><p>Por categoría</p>
        <ul>{lista.porCategoria.map(c => <li key={c.id}>{c.nombre}: {pesos(c.total)}</li>)}</ul></article>}
    </div>

    {lista.puedeRegistrar && <details className="desplegable">
      <summary>+ Registrar gasto</summary>
      {activas.length ? <Formulario accion={accionRegistrarGasto} boton="Registrar gasto">
        <input type="hidden" name="sedeId" value={sede.id} />
        <div className="grilla">
          <label>Fecha<input type="date" name="fecha" required defaultValue={hoy} max={hoy} /></label>
          <label>Monto ($)<input name="monto" required inputMode="decimal" placeholder="12500,50" pattern="\d{1,10}([.,]\d{1,2})?" title="Pesos, con hasta 2 decimales y sin separador de miles" /></label>
          <label>Categoría<select name="categoriaId" required>{activas.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.global ? "" : " (de la sede)"}</option>)}</select></label>
          <label>Medio de pago<select name="medioPago" defaultValue="EFECTIVO">{MEDIOS_PAGO_GASTO.map(m => <option key={m} value={m}>{MEDIOS[m]}</option>)}</select></label>
        </div>
        <label>Descripción<input name="descripcion" required minLength={3} maxLength={500} placeholder="Qué se pagó y a quién" /></label>
        <label>Comprobante (opcional)<input name="comprobante" maxLength={120} placeholder="Tipo y número, p. ej. Factura B 0003-00012345" /></label>
        {cajaAbierta ? <><input type="hidden" name="conCaja" value="1" /><label className="check"><input type="checkbox" name="desdeCaja" defaultChecked />Si es en efectivo, sale de la caja abierta</label></>
          : <p className="ayuda">La caja de la sede está cerrada: un gasto en efectivo no se descuenta de ninguna caja.</p>}
        <p className="ayuda">Un gasto no se edita ni se borra. Si te equivocaste, anulalo (queda registrado quién, cuándo y por qué) y cargalo de nuevo.</p>
      </Formulario> : <p className="ayuda">No hay categorías activas para esta sede. Creá una en la pestaña Categorías.</p>}
    </details>}

    <div className="tabla">
      {lista.gastos.map(g => <article key={g.id} className={g.anulacion ? "fila inactiva" : "fila"}>
        <div className="fila-cabecera">
          <h2>{g.descripcion}</h2>
          <span className={g.anulacion ? "tag gasto-anulado" : "tag"}>{pesos(g.monto)}</span>
        </div>
        <p>{fecha(g.fecha)} · {g.categoria} · {MEDIOS[g.medioPago]}{g.comprobante ? ` · ${g.comprobante}` : ""}</p>
        <p className="ayuda">Registrado por {g.registradoPor} el {instante(g.registradoEn)}</p>
        {g.anulacion && <p className="ayuda"><strong>Anulado</strong> por {g.anulacion.por} el {instante(g.anulacion.en)}: {g.anulacion.motivo}</p>}
        {!g.anulacion && lista.puedeAnular && <details><summary>Anular</summary>
          <Formulario accion={accionAnularGasto} boton="Anular gasto" className="en-linea" secundario confirmar="¿Anular este gasto? Se registra un reverso y no se puede deshacer.">
            <input type="hidden" name="gastoId" value={g.id} />
            <input name="motivo" required minLength={5} maxLength={500} placeholder="Motivo de la anulación" aria-label="Motivo de la anulación" />
          </Formulario>
        </details>}
      </article>)}
      {!lista.gastos.length && <p>Sin gastos en el período.</p>}
    </div>
  </section>;
}
