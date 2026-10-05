import type { Metadata } from "next";
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

export default async function Usuarios() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verUsuarios) notFound();
  const actorId = sesion.usuario.id;
  const usuarios = await listarUsuarios(db(), actorId, organizacion.id, { sedeId: sede?.id });
  const opciones = puede.administrarUsuarios ? await opcionesDeRol(db(), actorId, organizacion.id) : [];
  // Con una sede elegida, se ofrecen primero los roles de esa sede.
  const ordenadas = sede ? [...opciones].sort((a, b) => Number(b.asignacion.sedeId === sede.id) - Number(a.asignacion.sedeId === sede.id)) : opciones;

  return <section className="panel">
    <p className="eyebrow">EQUIPO{sede ? ` · ${sede.nombre.toUpperCase()}` : ""}</p><h1>Usuarios</h1>
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
      {!usuarios.length && <p>No hay usuarios en tu alcance{sede ? " para esta sede" : ""}.</p>}
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
