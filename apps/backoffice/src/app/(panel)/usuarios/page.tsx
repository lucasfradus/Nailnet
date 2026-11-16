import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listarUsuarios, opcionesDeRol } from "@nailnet/database/usuarios";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { ROLES } from "@/lib/etiquetas";
import { accionCrearUsuario, accionEstadoUsuario, accionInvitar, accionOtorgarRol, accionRevocarRol } from "../acciones";

export const metadata: Metadata = { title: "Usuarios · Sicurella", referrer: "no-referrer" };

type Opcion = Awaited<ReturnType<typeof opcionesDeRol>>[number];
const valor = ({ asignacion: a }: Opcion) => [a.rol, a.alcance, a.franquiciadoId ?? "", a.sedeId ?? ""].join("|");
function SelectorRol({ opciones }: { opciones: Opcion[] }) {
  return <select name="asignacion" aria-label="Rol">{opciones.map(o => <option key={valor(o)} value={valor(o)}>{o.etiqueta}</option>)}</select>;
}

// Filtro por rol. «admin» agrupa los tres roles con poder de administración.
const ADMINISTRACION = ["MASTER_FRANQUICIADOR", "FRANQUICIADO", "ADMIN_SEDE"];
const FILTROS: Record<string, { etiqueta: string; roles: string[] }> = {
  admin: { etiqueta: "Administración (todos)", roles: ADMINISTRACION },
  ...Object.fromEntries(Object.entries(ROLES).map(([rol, etiqueta]) => [rol, { etiqueta, roles: [rol] }])),
};

export default async function Usuarios({ searchParams }: { searchParams: Promise<{ rol?: string }> }) {
  const { rol } = await searchParams;
  const filtro = rol && Object.hasOwn(FILTROS, rol) ? FILTROS[rol] : undefined;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verUsuarios) notFound();
  const actorId = sesion.usuario.id;
  const todos = await listarUsuarios(db(), actorId, organizacion.id, { sedeId: sede?.id });
  // Se filtra sobre las asignaciones visibles para el actor, así no se revelan roles fuera de su alcance.
  const usuarios = filtro ? todos.filter(u => u.asignaciones.some(a => filtro.roles.includes(a.rol))) : todos;
  const opciones = puede.administrarUsuarios ? await opcionesDeRol(db(), actorId, organizacion.id) : [];
  // Con una sede elegida, se ofrecen primero los roles de esa sede.
  const ordenadas = sede ? [...opciones].sort((a, b) => Number(b.asignacion.sedeId === sede.id) - Number(a.asignacion.sedeId === sede.id)) : opciones;

  return <section className="panel">
    <p className="eyebrow">EQUIPO{sede ? ` · ${sede.nombre.toUpperCase()}` : ""}</p><h1>Usuarios</h1>
    <form className="en-linea" role="search">
      <select name="rol" defaultValue={filtro ? rol : ""} aria-label="Filtrar por rol">
        <option value="">Todos los roles</option>
        {Object.entries(FILTROS).map(([clave, f]) => <option key={clave} value={clave}>{f.etiqueta}</option>)}
      </select>
      <button className="secundario">Filtrar</button>
      {filtro && <Link href="/usuarios">Quitar filtro</Link>}
    </form>
    {filtro && <p className="ayuda">{usuarios.length} de {todos.length} usuarios con rol {filtro.etiqueta.toLowerCase()}.</p>}
    <div className="tabla">
      {usuarios.map(u => <article key={u.id} className={u.activo ? "fila" : "fila inactiva"}>
        <div className="fila-cabecera"><h2>{u.nombre}</h2>
          <span className="tag">{!u.activo ? "Inactivo" : u.tienePassword ? "Activo" : "Sin activar"}</span></div>
        <p>{u.email}</p>
        <ul className="roles">{u.asignaciones.map(a => <li key={a.id}>
          {ROLES[a.rol] ?? a.rol}{a.sede ? ` · ${a.sede}` : a.franquiciado ? ` · ${a.franquiciado}` : ""}
          {a.revocable && u.id !== actorId && <Formulario accion={accionRevocarRol} boton="Quitar" className="en-linea" secundario confirmar={`¿Quitar ${ROLES[a.rol] ?? a.rol} a ${u.nombre}?`}>
            <input type="hidden" name="asignacionId" value={a.id} />
          </Formulario>}
        </li>)}{!u.asignaciones.length && <li>Sin roles</li>}</ul>
        {u.activo && ordenadas.length > 0 && <Formulario accion={accionOtorgarRol} boton="Agregar rol" className="en-linea" secundario>
          <input type="hidden" name="usuarioId" value={u.id} /><SelectorRol opciones={ordenadas} />
        </Formulario>}
        {u.administrable && <div className="acciones">
          {u.activo && !u.tienePassword && <Formulario accion={accionInvitar} boton="Generar enlace de activación" className="en-linea" secundario>
            <input type="hidden" name="usuarioId" value={u.id} />
          </Formulario>}
          <Formulario accion={accionEstadoUsuario} boton={u.activo ? "Desactivar" : "Reactivar"} className="en-linea" secundario
            confirmar={u.activo ? `¿Desactivar a ${u.nombre}? Pierde el acceso a ${organizacion.nombre} de inmediato.` : undefined}>
            <input type="hidden" name="usuarioId" value={u.id} /><input type="hidden" name="activo" value={String(!u.activo)} />
          </Formulario>
        </div>}
      </article>)}
      {!usuarios.length && <p>{filtro ? `Nadie con rol ${filtro.etiqueta.toLowerCase()}` : "No hay usuarios"} en tu alcance{sede ? " para esta sede" : ""}.</p>}
    </div>

    {ordenadas.length > 0 && <>
      <h2 className="subtitulo">Nuevo usuario</h2>
      <Formulario accion={accionCrearUsuario} boton="Crear usuario" className="en-linea">
        <input name="nombre" placeholder="Nombre y apellido" required maxLength={120} aria-label="Nombre" />
        <input name="email" type="email" placeholder="Email" required maxLength={254} aria-label="Email" />
        <SelectorRol opciones={ordenadas} />
      </Formulario>
      <p className="ayuda">El usuario elige su contraseña con el enlace de activación, que vence en 72 horas. Mientras no haya envío de emails, copialo y compartilo por un canal privado.</p>
    </>}
  </section>;
}
