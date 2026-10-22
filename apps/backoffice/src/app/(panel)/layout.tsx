import { Lateral, type GrupoMenu } from "@/components/lateral";
import { SelectorContexto } from "@/components/selector-contexto";
import { contextoPanel } from "@/lib/contexto";
import { incidenciasAbiertas } from "@/lib/incidencias";
import { ROLES } from "@/lib/etiquetas";
import { salir } from "../acceso/actions";
import { elegirContexto } from "./acciones";

const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join("") || "?";

export default async function Panel({ children }: { children: React.ReactNode }) {
  const { sesion, organizaciones, organizacion, sedes, sede, puede, asignaciones } = await contextoPanel();
  const incidencias = await incidenciasAbiertas();
  const rol = asignaciones?.[0] ? ROLES[asignaciones[0].rol] ?? asignaciones[0].rol : sesion.usuario.email;
  const grupos: GrupoMenu[] = [
    { items: [
      { href: "/", etiqueta: "Inicio", icono: "inicio" },
      ...puede.verSedes ? [{ href: "/agenda", etiqueta: "Agenda", icono: "agenda" } as const] : [],
      ...puede.verClientes ? [{ href: "/clientes", etiqueta: "Clientes", icono: "clientes" } as const] : [],
      ...puede.verVentas ? [{ href: "/ventas", etiqueta: "Ventas", icono: "ventas" } as const] : [],
      ...puede.verCaja ? [{ href: "/caja", etiqueta: "Caja", icono: "caja" } as const] : [],
      ...puede.verGastos ? [{ href: "/gastos", etiqueta: "Gastos", icono: "gastos" } as const] : [],
      ...puede.verStock ? [{ href: "/stock", etiqueta: "Stock", icono: "stock" } as const] : [],
      ...puede.verReportes ? [{ href: "/reportes", etiqueta: "Reportes", icono: "reportes" } as const] : [],
    ] },
    { titulo: "Configuración", icono: "configuracion", items: [
      ...puede.verSedes ? [
        { href: "/sedes", etiqueta: "Sedes", icono: "sedes" } as const,
        { href: "/catalogo", etiqueta: "Catálogo", icono: "catalogo" } as const,
        { href: "/profesionales", etiqueta: "Profesionales", icono: "profesionales" } as const,
      ] : [],
      ...puede.verUsuarios ? [{ href: "/usuarios", etiqueta: "Usuarios", icono: "usuarios" } as const] : [],
      ...puede.administrarConsentimientos ? [{ href: "/consentimientos", etiqueta: "Consentimientos", icono: "consentimientos" } as const] : [],
    ] },
    // Incidencias (M04): null si el rol no accede; el número es lo que nadie revisó todavía.
    { items: incidencias === null ? [] : [{ href: "/incidencias", etiqueta: "Incidencias", icono: "incidencias", aviso: incidencias }] },
  ];
  return <div className="app">
    <Lateral grupos={grupos}>
      <form action={salir} className="usuario">
        <span className="avatar" aria-hidden="true">{iniciales(sesion.usuario.nombre)}</span>
        <span className="usuario-datos"><strong>{sesion.usuario.nombre}</strong><span>{rol}</span></span>
        <button className="secundario">Salir</button>
      </form>
    </Lateral>
    <div className="cuerpo">
      <header className="barra">
        {organizacion && <SelectorContexto accion={elegirContexto} organizaciones={organizaciones} organizacion={organizacion}
          sedes={sedes.map(s => ({ id: s.id, nombre: s.nombre }))} sede={sede && { id: sede.id, nombre: sede.nombre }} />}
      </header>
      <main className="contenido">{children}</main>
    </div>
  </div>;
}
