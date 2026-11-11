import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { UNIVERSOS } from "@nailnet/domain/catalogo";
import { catalogoSede } from "@nailnet/database/catalogo";
import { tableroSede } from "@nailnet/database/tablero";
import { RecordarUniverso } from "@/components/recordar-universo";
import { Refresco } from "@/components/refresco";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { COOKIE_UNIVERSO, UNIVERSO, UNIVERSO_SLUG } from "@/lib/etiquetas";
import { NoLlegaron, PorCobrar, repartir } from "./comun";
import { TableroSalon } from "./salon";
import { TableroTratamientos } from "./tratamientos";

export const metadata: Metadata = { title: "Recepción · Sicurella" };
// Tratamientos suma los suyos: `fecha`, `vista` y `mover` (los lee la grilla del día).
type Params = { servicio?: string; ok?: string; u?: string; fecha?: string; vista?: string; mover?: string };
const universoDe = (slug: string | undefined) => UNIVERSOS.find(x => UNIVERSO_SLUG[x] === slug);

/**
 * Tablero de recepción (doc 29): quién está en el local y quién está libre para qué. Recepción marca la
 * entrada y la salida de cada profesional, despacha a la clienta que llega sin turno («Atender ahora»),
 * marca la llegada de la que tiene turno y «Terminó» cuando la profesional queda libre. Lo terminado sin
 * venta queda por cobrar. Se actualiza solo, porque lo usan varias recepcionistas a la vez.
 *
 * Universos (doc 31): si la sede ofrece servicios de los dos, el tablero se separa en dos pestañas.
 * Manos y pies es el salón, para sentar con un toque. Tratamientos trabaja con turno previo y muestra la
 * grilla del día. Lo que falta cobrar se ve en las dos: la caja es una sola.
 */
export default async function Recepcion({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  if (!sede) return <section className="panel"><h1>Recepción</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const ahora = new Date();
  // El universo de la URL o, si no viene, el último que miró esta recepcionista en este navegador.
  const pedido = universoDe(q.u) ?? universoDe((await cookies()).get(COOKIE_UNIVERSO)?.value) ?? "MANOS_PIES";
  const tablero = await tableroSede(db(), sesion.usuario.id, organizacion.id, sede.id, ahora, { universo: pedido }).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!tablero) notFound();
  const tz = tablero.timezone;
  const hora = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // null: la sede tiene un solo universo y el tablero no se separa.
  const universo = tablero.universo;
  const tratamientos = universo === "TRATAMIENTOS";

  const { ausentes, enOtraSede } = repartir(tablero);
  // Manos y pies usa el buscador de servicios de «Atender ahora», que agrupa por categoría.
  const categorias = tratamientos ? {} : await catalogoSede(db(), sesion.usuario.id, organizacion.id, sede.id)
    .then(c => Object.fromEntries(c.servicios.map(s => [s.id, s.categoria])))
    .catch(e => { if (e instanceof AccesoDenegado) return {}; throw e; });

  return <section className="panel">
    <Refresco segundos={20} />
    <p className="eyebrow">RECEPCIÓN · {sede.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>Tablero</h1>
      <div className="en-linea">
        {tratamientos && <Link className="boton" href="/agenda/nuevo">Nuevo turno</Link>}
        <Link className={tratamientos ? "boton secundario" : "boton"} href="/agenda/ahora?volver=recepcion">Atender ahora</Link>
        <Link className="boton secundario" href="/agenda">Agenda</Link>
      </div></div>
    {universo && <nav className="universos" aria-label="Universo">{tablero.universos.map(x =>
      <Link key={x.universo} href={`/recepcion?u=${UNIVERSO_SLUG[x.universo]}`} aria-current={x.universo === universo ? "page" : undefined}>
        <strong>{UNIVERSO[x.universo]}</strong>
        <span>{x.universo === "TRATAMIENTOS" ? `${x.atendiendo} en sesión · ${x.porLlegar} por llegar` : `${x.libres} ${x.libres === 1 ? "libre" : "libres"} · ${x.esperas} en espera`}</span>
      </Link>)}</nav>}
    {universo && <RecordarUniverso valor={UNIVERSO_SLUG[universo]} />}
    {q.ok === "ahora" && <p className="alerta ok">Clienta en atención. Cuando la profesional termine, tocá «Terminó» en su tarjeta.</p>}

    {tratamientos
      ? <TableroTratamientos tablero={tablero} ahora={ahora} sedeId={sede.id} q={q} verVentas={puede.verVentas} />
      : <TableroSalon tablero={tablero} ahora={ahora.getTime()} sedeId={sede.id} categorias={categorias}
        porCobrar={<PorCobrar tablero={tablero} hora={hora} verVentas={puede.verVentas} />}
        noLlegaron={<NoLlegaron ausentes={ausentes} enOtraSede={enOtraSede} sedeId={sede.id} />} />}
  </section>;
}
