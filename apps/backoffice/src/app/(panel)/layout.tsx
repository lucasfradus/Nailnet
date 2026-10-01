import Link from "next/link";
import { contextoPanel } from "@/lib/contexto";
import { salir } from "../acceso/actions";
import { elegirContexto } from "./acciones";

export default async function Panel({ children }: { children: React.ReactNode }) {
  const { sesion, organizaciones, organizacion, sedes, sede, puede } = await contextoPanel();
  return <main>
    <header>
      <span className="brand">NailNet<span> / gestión</span></span>
      <nav className="nav">
        <Link href="/">Inicio</Link>
        {puede.verSedes && <Link href="/sedes">Sedes</Link>}
        {puede.verSedes && <Link href="/agenda">Agenda</Link>}
        {puede.verSedes && <Link href="/catalogo">Catálogo</Link>}
        {puede.verSedes && <Link href="/profesionales">Profesionales</Link>}
        {puede.verClientes && <Link href="/clientes">Clientes</Link>}
        {puede.verUsuarios && <Link href="/usuarios">Usuarios</Link>}
        {puede.administrarConsentimientos && <Link href="/consentimientos">Consentimientos</Link>}
      </nav>
      <form action={salir} className="usuario"><span>{sesion.usuario.nombre}</span><button className="secundario">Salir</button></form>
    </header>
    {organizacion && <form action={elegirContexto} className="contexto">
      {organizaciones.length > 1
        ? <select name="organizacionId" defaultValue={organizacion.id} aria-label="Organización">{organizaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        : <strong>{organizacion.nombre}</strong>}
      {sedes.length > 0 && <select name="sedeId" defaultValue={sede?.id ?? ""} aria-label="Sede">
        <option value="">{sedes.length > 1 ? `Todas mis sedes (${sedes.length})` : "Mi sede"}</option>
        {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>}
      {(sedes.length > 1 || organizaciones.length > 1) && <button className="secundario">Aplicar</button>}
    </form>}
    {children}
    <footer>Base técnica inicial · Sin datos operativos</footer>
  </main>;
}
