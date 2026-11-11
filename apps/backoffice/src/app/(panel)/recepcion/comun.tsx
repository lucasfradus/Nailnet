import Link from "next/link";
import type { tableroSede } from "@nailnet/database/tablero";
import { Formulario } from "@/components/formulario";
import { accionEntrada } from "./acciones";

// Piezas que comparten los dos universos del tablero de recepción (doc 31): la clienta con o sin ficha,
// lo que falta cobrar (la caja es una sola) y las profesionales que todavía no llegaron.

export type Tablero = Awaited<ReturnType<typeof tableroSede>>;
type ClienteBreve = { id: string; nombre: string; apellido: string | null } | null;

export const nombreCompleto = (c: { nombre: string; apellido: string | null }) => [c.nombre, c.apellido].filter(Boolean).join(" ");

/**
 * La clienta de un turno: con ficha, el nombre enlaza a ella; sin ficha (sentada con solo el nombre, doc 31
 * etapa 2), el nombre provisional y la etiqueta «Sin ficha».
 */
export function NombreClienta({ cliente, provisional, enlace = true }: { cliente: ClienteBreve; provisional: string | null; enlace?: boolean }) {
  if (cliente) return enlace ? <Link href={`/clientes/${cliente.id}`}>{nombreCompleto(cliente)}</Link> : <>{nombreCompleto(cliente)}</>;
  return <>{provisional ?? "Clienta"} <span className="tag sin-ficha">Sin ficha</span></>;
}

export function PorCobrar({ tablero, hora, verVentas }: { tablero: Tablero; hora: (d: Date) => string; verVentas: boolean }) {
  return <>
    <h2 className="subtitulo">Por cobrar</h2>
    {tablero.universo && tablero.porCobrar.length > 0 && <p className="ayuda">La caja es una sola: acá están las comandas de los dos universos.</p>}
    {!tablero.porCobrar.length ? <p className="intro">No hay comandas pendientes.</p> : <div className="tabla">{tablero.porCobrar.map(r => <article key={r.reservaId} className="fila">
      <div className="fila-cabecera"><h2><NombreClienta cliente={r.cliente} provisional={r.clienteProvisional} /></h2><span className="ayuda">terminó {hora(r.terminadaEn)}</span></div>
      <p>{r.servicios.join(" · ")}</p>
      {verVentas && <div className="acciones"><Link className="boton" href={`/ventas/nueva?reserva=${r.reservaId}`}>Cobrar</Link></div>}
    </article>)}</div>}
  </>;
}

/** Profesionales sin la entrada marcada (con su botón «Entrada») y las que están marcadas en otra sede. */
export function NoLlegaron({ ausentes, enOtraSede, sedeId }: { ausentes: Tablero["profesionales"]; enOtraSede: Tablero["profesionales"]; sedeId: string }) {
  return <>
    <h2 className="subtitulo">No llegaron</h2>
    {!ausentes.length && !enOtraSede.length ? <p className="intro">Están todas.</p> : <div className="tabla">
      {ausentes.map(p => <article key={p.id} className="fila"><div className="fila-cabecera"><h2>{p.nombre}</h2>
        <Formulario accion={accionEntrada} boton="Entrada" className="en-linea" secundario>
          <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="profesionalId" value={p.id} />
        </Formulario></div></article>)}
      {enOtraSede.map(p => <article key={p.id} className="fila inactiva"><div className="fila-cabecera"><h2>{p.nombre}</h2><span className="ayuda">en {p.presencia!.otraSede}</span></div></article>)}
    </div>}
  </>;
}

/**
 * Quién está en el local. Quien está atendiendo acá está en el local aunque recepción no le haya marcado
 * la entrada (una clienta con turno marcada «Llegó», o un «Atender ahora» desde la agenda): si no, la
 * atención no se vería en el tablero y no habría dónde tocar «Terminó».
 */
export function repartir(tablero: Tablero) {
  const atiendeAca = (p: Tablero["profesionales"][number]) => !!p.atencion && !p.atencion.enOtraSede;
  const presentes = tablero.profesionales.filter(p => (p.presencia && !p.presencia.otraSede) || atiendeAca(p));
  return {
    presentes,
    ausentes: tablero.profesionales.filter(p => !p.presencia && !atiendeAca(p)),
    enOtraSede: tablero.profesionales.filter(p => p.presencia?.otraSede && !atiendeAca(p)),
    libres: presentes.filter(p => !p.atencion),
    atendiendo: presentes.filter(p => p.atencion),
  };
}
