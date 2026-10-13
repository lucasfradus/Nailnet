import type { Metadata } from "next";
import Link from "next/link";
import { PARAMETROS } from "@nailnet/domain/configuracion";
import { aHora } from "@nailnet/domain/agenda";
import { estadoIntegraciones, obtenerConfiguracion } from "@nailnet/database/configuracion";
import { catalogoSede } from "@nailnet/database/catalogo";
import { calendarioSede, equipoSede } from "@nailnet/database/profesionales";
import { textoSemana } from "@/components/semana";
import { db } from "@/lib/db";
import { cargarSede, oNulo } from "@/lib/sede";

export const metadata: Metadata = { title: "Sede · Sicurella" };

// Lo que el motor de disponibilidad exige para ofrecer turnos online (ver ConfiguracionIncompleta).
const REQUERIDOS = ["pasoGrillaMinutos", "horizonteReservaDias", "anticipacionMinimaMinutos"] as const;
type Item = { ok: boolean; titulo: string; detalle: string; href: string };
const conRangos = (semana: Partial<Record<number, unknown[]>>) => Object.values(semana).some(r => r?.length);

function Checklist({ items }: { items: Item[] }) {
  return <ul className="lista checklist">{items.map(i => <li key={i.titulo} className={i.ok ? "ok" : "falta"}>
    <span className="marca" aria-hidden="true">{i.ok ? "✓" : "!"}</span>
    <span className="checklist-texto"><strong>{i.titulo}</strong><span>{i.detalle}</span></span>
    <Link href={i.href} aria-label={`${i.ok ? "Ver" : "Configurar"}: ${i.titulo}`}>{i.ok ? "Ver" : "Configurar"}</Link>
  </li>)}</ul>;
}

export default async function ResumenSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede } = await cargarSede(sedeId);
  const org = organizacion.id, base = `/sedes/${sede.id}`;
  // Calendario, catálogo y equipo solo existen para sedes activas.
  const [config, integraciones, cal, catalogo, equipo] = await Promise.all([
    obtenerConfiguracion(db(), actorId, org, sede.id),
    estadoIntegraciones(db(), actorId, org, sede.id),
    sede.activo ? oNulo(calendarioSede(db(), actorId, org, sede.id)) : null,
    sede.activo ? oNulo(catalogoSede(db(), actorId, org, sede.id)) : null,
    sede.activo ? oNulo(equipoSede(db(), actorId, org, sede.id)) : null,
  ]);

  const cargada = (proveedor: string, ambiente: string) => integraciones.credenciales.some(c => c.proveedor === proveedor && c.ambiente === ambiente);
  const faltan = REQUERIDOS.filter(p => config.efectiva[p].valor === null).map(p => PARAMETROS[p].etiqueta.toLowerCase());
  const servicios = catalogo?.servicios ?? [];
  const online = servicios.filter(s => s.efectivo.reservableOnline).length;
  const atienden = equipo?.profesionales.filter(p => p.activo && p.vinculado) ?? [];
  const conJornada = atienden.filter(p => conRangos(p.semana)).length;
  const recursos = cal?.recursos ?? [];

  const operacion: Item[] = [
    { ok: sede.activo, titulo: "Sede activa", detalle: sede.activo ? "Aparece en la agenda y en el portal" : "Reactivala para operar", href: `${base}/general` },
    { ok: !!cal && conRangos(cal.semana), titulo: "Horario de atención", detalle: cal ? textoSemana(cal.semana) : "—", href: `${base}/horarios` },
    { ok: !faltan.length, titulo: "Reglas de reserva online", detalle: faltan.length ? `Falta definir: ${faltan.join(", ")}` : REQUERIDOS.map(p => `${PARAMETROS[p].etiqueta}: ${config.efectiva[p].valor} ${PARAMETROS[p].unidad}`).join(" · "), href: `${base}/reservas` },
    { ok: online > 0, titulo: "Servicios online", detalle: `${online} de ${servicios.length} servicios se ofrecen online`, href: `${base}/servicios` },
    { ok: conJornada > 0, titulo: "Equipo", detalle: `${conJornada} de ${atienden.length} profesionales con jornada cargada en la sede`, href: `${base}/equipo` },
    { ok: cargada("MERCADO_PAGO", "PRODUCCION"), titulo: "Mercado Pago", detalle: cargada("MERCADO_PAGO", "PRODUCCION") ? "Cuenta de producción configurada para cobrar señas" : cargada("MERCADO_PAGO", "PRUEBA") ? "Solo hay cuenta de prueba: falta la de producción" : "Sin cuenta: no se pueden cobrar señas online", href: `${base}/pagos` },
  ];
  const facturacion: Item[] = [
    { ok: cargada("FACTURANTE", "PRODUCCION"), titulo: "Facturante", detalle: cargada("FACTURANTE", "PRODUCCION") ? "Credencial de producción configurada" : "Falta la credencial de producción", href: `${base}/pagos` },
    { ok: integraciones.fiscal.includes("PRODUCCION"), titulo: "Emisor y punto de venta", detalle: integraciones.fiscal.includes("PRODUCCION") ? "Definidos para producción" : "Falta definir CUIT y punto de venta de producción", href: `${base}/pagos` },
  ];
  const listos = operacion.filter(i => i.ok).length;

  return <>
    <h2 className="subtitulo">Lista para operar <span className="tag">{listos} de {operacion.length}</span></h2>
    <Checklist items={operacion} />
    <h2 className="subtitulo">Facturación</h2>
    <Checklist items={facturacion} />

    <h2 className="subtitulo">De un vistazo</h2>
    <div className="grilla">
      <article className="dato"><span>Zona horaria</span><strong>{sede.timezone.replace(/_/g, " ")}</strong><Link href={`${base}/general`}>Datos generales</Link></article>
      <article className="dato"><span>Equipo</span><strong>{atienden.length} {atienden.length === 1 ? "profesional" : "profesionales"}</strong><Link href={`${base}/equipo`}>Ver equipo</Link></article>
      <article className="dato"><span>Recursos</span><strong>{recursos.filter(r => r.activo).length} en servicio{recursos.some(r => !r.activo) ? ` · ${recursos.filter(r => !r.activo).length} fuera` : ""}</strong><Link href={`${base}/recursos`}>Ver recursos</Link></article>
      <article className="dato"><span>Próximas fechas especiales</span>
        <strong>{cal?.excepciones.length ? cal.excepciones.slice(0, 3).map(e => `${e.fecha.slice(8, 10)}/${e.fecha.slice(5, 7)} ${e.cerrado ? "cerrado" : `${aHora(e.inicio!)}-${aHora(e.fin!)}`}`).join(" · ") : "Ninguna"}</strong>
        <Link href={`${base}/horarios`}>Ver horarios</Link></article>
    </div>
  </>;
}
