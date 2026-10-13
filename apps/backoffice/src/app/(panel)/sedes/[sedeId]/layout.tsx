import Link from "next/link";
import { Pestanas, type Pestana } from "@/components/pestanas";
import { cargarSede } from "@/lib/sede";

const PESTANAS: Pestana[] = [
  { ruta: "", etiqueta: "Resumen" },
  { ruta: "general", etiqueta: "General" },
  { ruta: "horarios", etiqueta: "Horarios" },
  { ruta: "servicios", etiqueta: "Servicios" },
  { ruta: "equipo", etiqueta: "Equipo" },
  { ruta: "recursos", etiqueta: "Recursos" },
  { ruta: "reservas", etiqueta: "Reservas online" },
  { ruta: "pagos", etiqueta: "Pagos y facturación" },
];

/** Ficha de la sede: encabezado común y una pestaña (sub-ruta) por área de configuración. */
export default async function FichaSede({ children, params }: { children: React.ReactNode; params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { sede } = await cargarSede(sedeId);
  return <section className="panel">
    <p className="eyebrow"><Link href="/sedes">SEDES</Link> · {sede.franquiciado.nombre.toUpperCase()}</p>
    <div className="fila-cabecera"><h1>{sede.nombre}</h1><span className={sede.activo ? "tag estado-confirmada" : "tag estado-cancelada"}>{sede.activo ? "Activa" : "Inactiva"}</span></div>
    {!sede.activo && <p className="alerta error">Sede inactiva: no aparece en la operación diaria ni ofrece turnos. Su configuración se conserva; se reactiva desde General.</p>}
    <Pestanas base={`/sedes/${sede.id}`} items={PESTANAS} etiqueta="Secciones de la sede" />
    {children}
  </section>;
}
