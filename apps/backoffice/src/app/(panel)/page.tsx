import Link from "next/link";
import { Svg, type Icono } from "@/components/iconos";
import { contextoPanel } from "@/lib/contexto";
import { ROLES } from "@/lib/etiquetas";
import { incidenciasAbiertas } from "@/lib/incidencias";

export default async function Home() {
  const { sesion, asignaciones, organizacion, sede, puede } = await contextoPanel();
  const incidencias = await incidenciasAbiertas();
  const atajos: [href: string, icono: Icono, titulo: string, detalle: string, visible: boolean][] = [
    ["/agenda", "agenda", "Agenda", "Turnos del día y de la semana por sede.", puede.verSedes],
    ["/clientes", "clientes", "Clientes", "Fichas, contacto y vínculo con sedes.", puede.verClientes],
    ["/ventas", "ventas", "Ventas", "Cobros del día, turnos atendidos y productos.", puede.verVentas],
    ["/caja", "caja", "Caja", "Apertura, movimientos de efectivo y cierres.", puede.verCaja],
    ["/stock", "stock", "Stock", "Productos, compras y consumo interno por sede.", puede.verStock],
    ["/sedes", "sedes", "Sedes", "Datos, horarios e integraciones.", puede.verSedes],
    ["/catalogo", "catalogo", "Catálogo", "Servicios, precios y señas.", puede.verSedes],
    ["/profesionales", "profesionales", "Profesionales", "Equipo, habilidades y disponibilidad.", puede.verSedes],
    ["/usuarios", "usuarios", "Usuarios", "Accesos y roles del backoffice.", puede.verUsuarios],
    ["/consentimientos", "consentimientos", "Consentimientos", "Textos legales que firman los clientes.", puede.administrarConsentimientos],
    ["/incidencias", "incidencias", "Incidencias", "Pagos a devolver, emails y trabajos fallidos.", incidencias !== null],
  ];
  return <section className="panel">
    <p className="eyebrow">{organizacion?.nombre ?? "Sin organización"}{sede ? ` · ${sede.nombre}` : ""}</p>
    <h1>Inicio</h1>
    {!!incidencias && <p className="alerta error" role="status">
      {incidencias === 1 ? "Hay 1 incidencia sin revisar" : `Hay ${incidencias} incidencias sin revisar`} (pagos, emails o trabajos de la cola). <Link href="/incidencias">Ver incidencias</Link>
    </p>}

    <h2 className="subtitulo">Tu acceso</h2>
    <div className="tabla">
      {asignaciones?.map((a, i) => <div key={i} className="fila fila-cabecera">
        <span>{ROLES[a.rol] ?? a.rol}</span>
        <span className="tag">{a.sede ? a.sede.nombre : a.franquiciado ? a.franquiciado.nombre : "Toda la organización"}</span>
      </div>)}
      {!asignaciones?.length && <p>Sin roles asignados: pedí acceso a un administrador.</p>}
    </div>
    <p className="ayuda pie-tabla">Sesión de {sesion.usuario.email}.</p>

    <h2 className="subtitulo">Accesos directos</h2>
    <div className="resumen">
      {atajos.filter(a => a[4]).map(([href, icono, titulo, detalle]) => <Link key={href} href={href} className="atajo">
        <Svg icono={icono} /><span><strong>{titulo}</strong><span>{detalle}</span></span>
      </Link>)}
    </div>
  </section>;
}
