import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { obtenerCaja } from "@nailnet/database/caja";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { instante } from "../../ventas/comun";
import { MovimientosCaja, ResumenCaja } from "../detalle";

export const metadata: Metadata = { title: "Cierre de caja · Sicurella" };

/** Una caja del historial: resumen, cierre y movimientos. Un cierre no se modifica. */
export default async function DetalleCaja({ params }: { params: Promise<{ cajaId: string }> }) {
  const { cajaId } = await params;
  const { sesion, organizacion, puede, sedes } = await requerirOrganizacion();
  if (!puede.verCaja) notFound();
  const caja = await obtenerCaja(db(), sesion.usuario.id, organizacion.id, cajaId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!caja) notFound();
  const sede = sedes.find(s => s.id === caja.sedeId);
  const tz = sede?.timezone ?? "America/Argentina/Buenos_Aires";

  return <section className="panel">
    <p className="eyebrow"><Link href="/caja">CAJA</Link> · {sede?.nombre.toUpperCase() ?? ""}</p>
    <h1>{caja.estado === "CERRADA" ? "Cierre de caja" : "Caja abierta"}</h1>
    <p className="intro">Abierta por {caja.abiertaPor} el {instante(caja.abiertaEn, tz)}{caja.cerradaEn ? ` · cerrada por ${caja.cerradaPor} el ${instante(caja.cerradaEn, tz)}` : ""}</p>
    <ResumenCaja caja={caja} />
    <h2 className="subtitulo">Movimientos de efectivo</h2>
    <MovimientosCaja caja={caja} tz={tz} puedeRevertir={caja.puedeOperar} />
    {caja.estado === "CERRADA" && <p className="ayuda pie-tabla">Un reverso de un movimiento de esta caja se registra en la caja abierta al momento de revertir: este cierre no cambia.</p>}
  </section>;
}
