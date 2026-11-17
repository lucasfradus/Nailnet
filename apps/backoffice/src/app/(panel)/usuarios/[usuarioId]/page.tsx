import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { obtenerUsuario, opcionesDeRol } from "@nailnet/database/usuarios";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { recuperacionPorEmail } from "@/lib/emails";
import { ROLES, ultimoIngreso } from "@/lib/etiquetas";
import { accionCambiarRol, accionEditarUsuario, accionEstadoUsuario, accionInvitar, accionOtorgarRol, accionRestablecer, accionRevocarRol } from "../../acciones";
import { SelectorRol, etiquetaRol, valorRol } from "../selector-rol";

export const metadata: Metadata = { title: "Usuario · Sicurella", referrer: "no-referrer" };

export default async function Usuario({ params }: { params: Promise<{ usuarioId: string }> }) {
  const { usuarioId } = await params;
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verUsuarios) notFound();
  const actorId = sesion.usuario.id;
  // Lo propio se edita en Mi cuenta, que pide la contraseña actual.
  if (usuarioId === actorId) redirect("/cuenta");
  const u = await obtenerUsuario(db(), actorId, organizacion.id, usuarioId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!u) notFound();
  const opciones = puede.administrarUsuarios ? await opcionesDeRol(db(), actorId, organizacion.id) : [];
  const ordenadas = sede ? [...opciones].sort((a, b) => Number(b.asignacion.sedeId === sede.id) - Number(a.asignacion.sedeId === sede.id)) : opciones;
  const estado = !u.activo ? "Inactivo" : u.tienePassword ? "Activo" : "Sin activar";

  return <section className="panel ficha-form">
    <p className="eyebrow"><Link href="/usuarios">USUARIOS</Link></p>
    <div className="fila-cabecera"><h1>{u.nombre}</h1><span className="tag">{estado}</span></div>
    <p className="intro">{u.email} · {ultimoIngreso(u.ultimoIngreso)}</p>

    {u.administrable && <>
      <h2 className="subtitulo">Datos</h2>
      <Formulario accion={accionEditarUsuario} boton="Guardar datos">
        <input type="hidden" name="usuarioId" value={u.id} />
        <label>Nombre y apellido<input name="nombre" defaultValue={u.nombre} required maxLength={120} /></label>
        <label>Email de ingreso<input name="email" type="email" defaultValue={u.email} required maxLength={254} /></label>
      </Formulario>
      <p className="ayuda">Si cambiás el email, se cierran sus sesiones y tiene que volver a ingresar con el nuevo. Su contraseña no cambia.</p>
    </>}

    <h2 className="subtitulo">Roles en {organizacion.nombre}</h2>
    <div className="tabla">
      {u.asignaciones.map(a => <article key={a.id} className="fila">
        <div className="fila-cabecera"><h2>{etiquetaRol(a)}</h2>
          {a.revocable && <Formulario accion={accionRevocarRol} boton="Quitar" className="en-linea" secundario confirmar={`¿Quitar ${etiquetaRol(a)} a ${u.nombre}?`}>
            <input type="hidden" name="asignacionId" value={a.id} />
          </Formulario>}
        </div>
        {a.revocable && u.activo && ordenadas.length > 1 && <Formulario accion={accionCambiarRol} boton="Cambiar" className="en-linea" secundario>
          <input type="hidden" name="asignacionId" value={a.id} />
          <SelectorRol opciones={ordenadas} valor={valorRol(a)} etiqueta={`Cambiar ${ROLES[a.rol] ?? a.rol} por`} />
        </Formulario>}
      </article>)}
      {!u.asignaciones.length && <p>Sin roles en tu alcance.</p>}
    </div>
    {u.activo && ordenadas.length > 0 && <Formulario accion={accionOtorgarRol} boton="Agregar rol" className="en-linea" secundario>
      <input type="hidden" name="usuarioId" value={u.id} /><SelectorRol opciones={ordenadas} />
    </Formulario>}

    {u.administrable && <>
      <h2 className="subtitulo">Acceso</h2>
      <div className="acciones">
        {u.activo && !u.tienePassword && <Formulario accion={accionInvitar} boton="Generar enlace de activación" className="en-linea" secundario>
          <input type="hidden" name="usuarioId" value={u.id} />
        </Formulario>}
        {u.activo && u.tienePassword && recuperacionPorEmail() && <Formulario accion={accionRestablecer} boton="Restablecer contraseña" className="en-linea" secundario
          confirmar={`¿Enviar a ${u.email} un enlace para elegir una nueva contraseña?`}>
          <input type="hidden" name="usuarioId" value={u.id} />
        </Formulario>}
        <Formulario accion={accionEstadoUsuario} boton={u.activo ? "Desactivar" : "Reactivar"} className="en-linea" secundario
          confirmar={u.activo ? `¿Desactivar a ${u.nombre}? Pierde el acceso a ${organizacion.nombre} de inmediato.` : undefined}>
          <input type="hidden" name="usuarioId" value={u.id} /><input type="hidden" name="activo" value={String(!u.activo)} />
        </Formulario>
      </div>
    </>}
  </section>;
}
