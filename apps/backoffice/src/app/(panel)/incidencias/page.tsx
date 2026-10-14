import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { FUENTES, type FuenteIncidencia } from "@nailnet/domain/incidencias";
import { listarIncidencias, type FiltroEstado } from "@nailnet/database/incidencias";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { ACCIONES, ESTADOS, FUENTES_ETIQUETA, RUTA_FUENTE, TIPOS, fechaHora } from "./formato";

export const metadata: Metadata = { title: "Incidencias · Sicurella" };

type Params = { fuente?: string; sede?: string; estado?: string };
const FILTROS_ESTADO: Record<FiltroEstado, string> = { pendientes: "Pendientes", abiertas: "Sin revisar", resueltas: "Resueltas", todas: "Todas" };

/**
 * Bandeja de incidencias (M04): trabajos de la cola, pagos y emails que necesitan a una persona.
 * Muestra todas las sedes del alcance; se filtra por tipo, sede y estado. Las filas llevan a la ficha,
 * donde están el historial y las acciones.
 */
export default async function Incidencias({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion } = await requerirOrganizacion();
  const fuente = FUENTES.includes(q.fuente as FuenteIncidencia) ? q.fuente as FuenteIncidencia : undefined;
  const estado = (q.estado && q.estado in FILTROS_ESTADO ? q.estado : "pendientes") as FiltroEstado;
  const datos = await listarIncidencias(db(), sesion.usuario.id, organizacion.id, { fuente, sedeId: q.sede || undefined, estado })
    .catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!datos) notFound();
  const { incidencias, sedes, organizacional, truncado } = datos;

  return <section className="panel">
    <p className="eyebrow">{organizacion.nombre.toUpperCase()}</p>
    <h1>Incidencias</h1>
    <p className="intro">Trabajos de la cola que fallaron o se atrasaron, pagos que requieren una devolución o una revisión, y emails que no llegaron. Toda acción pide una nota y queda registrada con quién y cuándo; nada se borra.</p>

    <form className="en-linea">
      <select name="fuente" defaultValue={fuente ?? ""} aria-label="Tipo"><option value="">Todos los tipos</option>{FUENTES.map(f => <option key={f} value={f}>{FUENTES_ETIQUETA[f]}</option>)}</select>
      <select name="sede" defaultValue={q.sede ?? ""} aria-label="Sede">
        <option value="">Todas mis sedes</option>
        {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}{s.activo ? "" : " (inactiva)"}</option>)}
        {organizacional && <option value="sin-sede">Sin sede (organización y sistema)</option>}
      </select>
      <select name="estado" defaultValue={estado} aria-label="Estado">{Object.entries(FILTROS_ESTADO).map(([v, e]) => <option key={v} value={v}>{e}</option>)}</select>
      <button className="secundario">Filtrar</button>
    </form>

    <div className="tabla">
      {incidencias.map(i => <Link key={`${i.fuente}:${i.id}`} href={`/incidencias/${RUTA_FUENTE[i.fuente]}/${i.id}`} className={i.estado === "RESUELTA" ? "fila fila-enlace inactiva" : "fila fila-enlace"}>
        <div className="fila-enlace-texto">
          <h2>{i.tipo ? TIPOS[i.tipo].titulo : "Sin incidencia"}<span className="tag">{i.sede ?? (i.organizacionId ? "Organización" : "Sistema")}</span></h2>
          <p>{[
            i.trabajo && `${i.trabajo.tipo} · intento ${i.trabajo.intentos} de ${i.trabajo.maxIntentos}`,
            i.pago && `Mercado Pago ${i.pago.externoId} · $ ${Number(i.pago.monto).toLocaleString("es-AR")}`,
            i.email && `${i.email.tipo}${i.email.destinatario ? ` · ${i.email.destinatario}` : ""}`,
            `desde ${fechaHora(i.desde)}`,
            i.ultimaAccion && `${ACCIONES[i.ultimaAccion.accion].etiqueta.toLowerCase()} el ${fechaHora(i.ultimaAccion.fecha)}`,
          ].filter(Boolean).join(" · ")}</p>
          {i.detalle && <p className="ayuda">{i.detalle.length > 160 ? `${i.detalle.slice(0, 160)}…` : i.detalle}</p>}
        </div>
        <span className={ESTADOS[i.estado].clase}>{ESTADOS[i.estado].etiqueta}</span>
        <span className="boton secundario">Ver</span>
      </Link>)}
      {!incidencias.length && <p>{estado === "pendientes" ? "No hay incidencias pendientes." : "No hay incidencias con esos filtros."}</p>}
    </div>
    {truncado && <p className="ayuda pie-tabla">Se muestran las 200 más recientes de cada fuente.</p>}
    <p className="ayuda pie-tabla">Las incidencias se cierran solas cuando la fuente se normaliza (por ejemplo, el trabajo reintentado se completa o Mercado Pago informa el reembolso). Los comprobantes fiscales se suman con Facturante.</p>
  </section>;
}
