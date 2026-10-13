import { Lateral, type GrupoMenu } from "@/components/lateral";
import { contextoPanel } from "@/lib/contexto";
import { ROLES } from "@/lib/etiquetas";
import { salir } from "../acceso/actions";
import { elegirContexto } from "./acciones";

const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join("") || "?";

export default async function Panel({ children }: { children: React.ReactNode }) {
  const { sesion, organizaciones, organizacion, sedes, sede, puede, asignaciones } = await contextoPanel();
  const rol = asignaciones?.[0] ? ROLES[asignaciones[0].rol] ?? asignaciones[0].rol : sesion.usuario.email;
  const grupos: GrupoMenu[] = [
    { items: [{ href: "/", etiqueta: "Inicio", icono: "inicio" }] },
    { titulo: "Operación", items: [
      ...puede.verSedes ? [{ href: "/agenda", etiqueta: "Agenda", icono: "agenda" } as const] : [],
      ...puede.verClientes ? [{ href: "/clientes", etiqueta: "Clientes", icono: "clientes" } as const] : [],
    ] },
    { titulo: "Configuración", items: [
      ...puede.verSedes ? [
        { href: "/sedes", etiqueta: "Sedes", icono: "sedes" } as const,
        { href: "/catalogo", etiqueta: "Catálogo", icono: "catalogo" } as const,
        { href: "/profesionales", etiqueta: "Profesionales", icono: "profesionales" } as const,
      ] : [],
      ...puede.verUsuarios ? [{ href: "/usuarios", etiqueta: "Usuarios", icono: "usuarios" } as const] : [],
      ...puede.administrarConsentimientos ? [{ href: "/consentimientos", etiqueta: "Consentimientos", icono: "consentimientos" } as const] : [],
    ] },
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
        {organizacion && <form action={elegirContexto} className="contexto">
          {organizaciones.length > 1
            ? <select name="organizacionId" defaultValue={organizacion.id} aria-label="Organización">{organizaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
            : <strong>{organizacion.nombre}</strong>}
          {sedes.length > 0 && <><span className="separador" aria-hidden="true">/</span>
            <select name="sedeId" defaultValue={sede?.id ?? ""} aria-label="Sede">
              <option value="">{sedes.length > 1 ? `Todas mis sedes (${sedes.length})` : "Mi sede"}</option>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select></>}
          {(sedes.length > 1 || organizaciones.length > 1) && <button className="secundario">Aplicar</button>}
        </form>}
      </header>
      <main className="contenido">{children}</main>
    </div>
  </div>;
}
