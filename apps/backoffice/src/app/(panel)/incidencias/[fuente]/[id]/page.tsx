import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { detalleIncidencia } from "@nailnet/database/incidencias";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionIncidencia } from "../../acciones";
import { ACCIONES, ESTADOS, FUENTES_ETIQUETA, FUENTE_DE_RUTA, RUTA_FUENTE, TIPOS, fechaHora, pesos } from "../../formato";

export const metadata: Metadata = { title: "Incidencia · Sicurella" };

/** Ficha de una incidencia: datos de la fuente, qué hacer, acciones con nota obligatoria e historial. */
export default async function Incidencia({ params }: { params: Promise<{ fuente: string; id: string }> }) {
  const { fuente: ruta, id } = await params;
  const fuente = FUENTE_DE_RUTA[ruta];
  if (!fuente) notFound();
  const { sesion, organizacion } = await requerirOrganizacion();
  const ficha = await detalleIncidencia(db(), sesion.usuario.id, organizacion.id, fuente, id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!ficha) notFound();
  const { incidencia: i, historial, envio, trabajo } = ficha;
  const datos: [string, React.ReactNode][] = [
    ["Sede", i.sede ?? (i.organizacionId ? "Organización (sin sede)" : "Sistema (sin organización)")],
    ["Estado de la fuente", i.estadoFuente],
    ["Último cambio", fechaHora(i.desde)],
    ["Creado", fechaHora(i.creado)],
    ...i.trabajo ? [
      ["Trabajo", i.trabajo.tipo],
      ["Intentos", `${i.trabajo.intentos} de ${i.trabajo.maxIntentos}`],
      ["Próximo intento", fechaHora(i.trabajo.proximoIntento)],
    ] as [string, React.ReactNode][] : [],
    ...i.pago ? [
      ["Pago de Mercado Pago", i.pago.externoId],
      ["Monto", `${pesos(i.pago.monto)} ${i.pago.moneda}`],
      ["Estado en Mercado Pago", [i.pago.estadoExterno, i.pago.detalleExterno].filter(Boolean).join(" · ")],
      ["Turno", i.pago.estadoReserva.toLowerCase().replace(/_/g, " ") + (i.pago.reprogramadaA ? " (reprogramado)" : "")],
    ] as [string, React.ReactNode][] : [],
    ...i.email ? [
      ["Email", i.email.tipo],
      ["Destinatario", i.email.destinatario ?? "—"],
      ["Asunto", i.email.asunto ?? "—"],
    ] as [string, React.ReactNode][] : [],
    ...i.detalle ? [[i.fuente === "PAGO" ? "Motivo" : "Detalle", i.detalle]] as [string, React.ReactNode][] : [],
  ];

  return <section className="panel">
    <p className="eyebrow"><Link href="/incidencias">INCIDENCIAS</Link> · {FUENTES_ETIQUETA[i.fuente].toUpperCase()}</p>
    <div className="fila-cabecera">
      <h1>{i.tipo ? TIPOS[i.tipo].titulo : "Sin incidencia vigente"}</h1>
      {i.tipo && <span className={ESTADOS[i.estado].clase}>{ESTADOS[i.estado].etiqueta}</span>}
    </div>
    <p className="intro">{i.tipo ? TIPOS[i.tipo].ayuda : "La fuente ya se normalizó (por ejemplo, el trabajo se completó o el pago se reembolsó). Queda el historial."}</p>

    <div className="tabla">
      {datos.map(([k, v]) => <div key={k} className="fila fila-cabecera"><span>{k}</span><span>{v}</span></div>)}
    </div>
    {envio && <p className="ayuda pie-tabla">Evidencia del email: <Link href={`/incidencias/email/${envio.id}`}>{envio.estado.toLowerCase()}</Link>{envio.destinatario ? ` · ${envio.destinatario}` : ""}{envio.motivo ? ` · ${envio.motivo}` : ""}.</p>}
    {trabajo && <p className="ayuda pie-tabla">Trabajo de la cola: <Link href={`/incidencias/${RUTA_FUENTE.TRABAJO}/${trabajo.id}`}>{trabajo.estado.toLowerCase()}</Link>.</p>}

    {i.acciones.length > 0 && <>
      <h2 className="subtitulo">Acciones</h2>
      {i.acciones.map(a => <details key={a} className="desplegable">
        <summary>{ACCIONES[a].boton}</summary>
        <Formulario accion={accionIncidencia} boton={ACCIONES[a].boton} confirmar={a === "REINTENTADA" ? "¿Devolver el trabajo a la cola? Se ejecuta otra vez con los intentos en cero." : undefined}>
          <input type="hidden" name="fuente" value={i.fuente} />
          <input type="hidden" name="id" value={i.id} />
          <input type="hidden" name="accion" value={a} />
          <label>Nota (obligatoria)<textarea name="nota" required minLength={5} maxLength={1000} rows={3}
            placeholder={a === "DEVOLUCION_GESTIONADA" ? "Devuelto desde el panel de Mercado Pago, operación…" : "Qué se revisó o qué se hizo"} /></label>
          <p className="ayuda">{ACCIONES[a].ayuda}</p>
        </Formulario>
      </details>)}
    </>}

    <h2 className="subtitulo">Historial</h2>
    <div className="tabla">
      {historial.map(h => <article key={h.id} className={h.anterior ? "fila inactiva" : "fila"}>
        <div className="fila-cabecera"><h2>{ACCIONES[h.accion].etiqueta}</h2><span className="tag">{fechaHora(h.fecha)}</span></div>
        <p>{h.actor} · {h.nota}</p>
        {h.anterior && <p className="ayuda">Sobre una ocurrencia anterior (la fuente cambió después).</p>}
      </article>)}
      {!historial.length && <p>Nadie actuó todavía sobre esta incidencia.</p>}
    </div>
  </section>;
}
