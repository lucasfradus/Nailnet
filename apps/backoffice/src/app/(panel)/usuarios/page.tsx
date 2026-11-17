import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarUsuarios, opcionesDeRol } from "@nailnet/database/usuarios";
import { normalizarEmail } from "@nailnet/domain/credenciales";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { ROLES, ultimoIngreso } from "@/lib/etiquetas";
import { accionCrearUsuario } from "../acciones";
import { SelectorRol, etiquetaRol } from "./selector-rol";

export const metadata: Metadata = { title: "Usuarios · Sicurella", referrer: "no-referrer" };

// Filtro por rol. «admin» agrupa los tres roles con poder de administración.
const ADMINISTRACION = ["MASTER_FRANQUICIADOR", "FRANQUICIADO", "ADMIN_SEDE"];
const FILTROS: Record<string, { etiqueta: string; roles: string[] }> = {
  admin: { etiqueta: "Administración (todos)", roles: ADMINISTRACION },
  ...Object.fromEntries(Object.entries(ROLES).map(([rol, etiqueta]) => [rol, { etiqueta, roles: [rol] }])),
};
// Búsqueda sin tildes ni mayúsculas: «maria» encuentra a «María».
const plano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default async function Usuarios({ searchParams }: { searchParams: Promise<{ rol?: string; q?: string }> }) {
  const { rol, q = "" } = await searchParams;
  const filtro = rol && Object.hasOwn(FILTROS, rol) ? FILTROS[rol] : undefined;
  const busqueda = plano(q.trim()).slice(0, 100);
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verUsuarios) notFound();
  const actorId = sesion.usuario.id;
  const todos = await listarUsuarios(db(), actorId, organizacion.id, { sedeId: sede?.id });
  // Se filtra sobre las asignaciones visibles para el actor, así no se revelan roles fuera de su alcance.
  const usuarios = todos
    .filter(u => !filtro || u.asignaciones.some(a => filtro.roles.includes(a.rol)))
    .filter(u => !busqueda || plano(u.nombre).includes(busqueda) || normalizarEmail(u.email).includes(busqueda));
  const opciones = puede.administrarUsuarios ? await opcionesDeRol(db(), actorId, organizacion.id) : [];
  // Con una sede elegida, se ofrecen primero los roles de esa sede.
  const ordenadas = sede ? [...opciones].sort((a, b) => Number(b.asignacion.sedeId === sede.id) - Number(a.asignacion.sedeId === sede.id)) : opciones;
  const filtrando = !!filtro || !!busqueda;

  return <section className="panel">
    <p className="eyebrow">EQUIPO{sede ? ` · ${sede.nombre.toUpperCase()}` : ""}</p><h1>Usuarios</h1>
    <form className="en-linea" role="search">
      <input name="q" type="search" defaultValue={q} placeholder="Buscar por nombre o email" maxLength={100} aria-label="Buscar usuario" />
      <select name="rol" defaultValue={filtro ? rol : ""} aria-label="Filtrar por rol">
        <option value="">Todos los roles</option>
        {Object.entries(FILTROS).map(([clave, f]) => <option key={clave} value={clave}>{f.etiqueta}</option>)}
      </select>
      <button className="secundario">Buscar</button>
      {filtrando && <Link href="/usuarios">Limpiar</Link>}
    </form>
    {filtrando && <p className="ayuda">{usuarios.length} de {todos.length} usuarios.</p>}
    <div className="tabla">
      {usuarios.map(u => <article key={u.id} className={u.activo ? "fila" : "fila inactiva"}>
        <div className="fila-cabecera">
          <h2><Link href={u.id === actorId ? "/cuenta" : `/usuarios/${u.id}`}>{u.nombre}</Link>{u.id === actorId && <span className="ayuda"> (vos)</span>}</h2>
          <span className="tag">{!u.activo ? "Inactivo" : u.tienePassword ? "Activo" : "Sin activar"}</span>
        </div>
        <p>{u.email}</p>
        <p className="ayuda">{u.asignaciones.length ? u.asignaciones.map(etiquetaRol).join(" · ") : "Sin roles"} — {ultimoIngreso(u.ultimoIngreso)}</p>
      </article>)}
      {!usuarios.length && <p>{filtrando ? "Nadie coincide con la búsqueda" : "No hay usuarios"} en tu alcance{sede ? " para esta sede" : ""}.</p>}
    </div>

    {ordenadas.length > 0 && <>
      <h2 className="subtitulo">Nuevo usuario</h2>
      <Formulario accion={accionCrearUsuario} boton="Crear usuario" className="en-linea">
        <input name="nombre" placeholder="Nombre y apellido" required maxLength={120} aria-label="Nombre" />
        <input name="email" type="email" placeholder="Email" required maxLength={254} aria-label="Email" />
        <SelectorRol opciones={ordenadas} />
      </Formulario>
      <p className="ayuda">El usuario elige su contraseña con el enlace de activación, que vence en 72 horas. Generalo desde su ficha.</p>
    </>}
  </section>;
}
