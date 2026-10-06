import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { listarCatalogo } from "@nailnet/database/catalogo";
import { obtenerProfesional } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { EditorImagen } from "@/components/imagen";
import { CamposSemana, textoSemana } from "@/components/semana";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionActualizarProfesional, accionFotoProfesional, accionCrearBloqueo, accionEliminarBloqueo, accionHabilidades, accionHorarioProfesional, accionVincularSedeProfesional } from "../../acciones";

export const metadata: Metadata = { title: "Profesional · Sicurella" };

export default async function Profesional({ params }: { params: Promise<{ profesionalId: string }> }) {
  const { profesionalId } = await params;
  const { sesion, organizacion, sedes } = await requerirOrganizacion();
  const actorId = sesion.usuario.id;
  const p = await obtenerProfesional(db(), actorId, organizacion.id, profesionalId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!p) notFound();
  const catalogo = p.editable ? await listarCatalogo(db(), actorId, organizacion.id) : null;
  const sinVincular = sedes.filter(s => !p.sedes.some(v => v.sedeId === s.id));
  // Los bloqueos se cargan y muestran en la zona de la primera sede visible.
  const tz = sedes.find(s => s.id === p.sedes[0]?.sedeId)?.timezone ?? "America/Argentina/Buenos_Aires";
  const fmt = (d: Date) => d.toLocaleString("es-AR", { timeZone: tz, dateStyle: "short", timeStyle: "short", hourCycle: "h23" });
  const skillsDe = (ids: string[]) => new Set(ids);
  const tiene = skillsDe(p.skillIds);

  return <section className="panel">
    <p className="eyebrow"><Link href="/profesionales">PROFESIONALES</Link></p>
    <h1>{p.nombre} {p.apellido}</h1>
    {!p.activo && <p className="alerta error">Inactivo: no aparece en la agenda.</p>}
    {p.otrasSedes > 0 && <p className="ayuda">También trabaja en {p.otrasSedes} {p.otrasSedes === 1 ? "sede" : "sedes"} fuera de tu alcance; su jornada allí bloquea esos horarios.</p>}

    {p.editable ? <EditorImagen accion={accionFotoProfesional} ocultos={{ profesionalId: p.id }} imagenId={p.fotoId} titulo={`Foto de ${p.nombre}`} retrato />
      : p.fotoId && <img src={`/api/public/v1/imagenes/${p.fotoId}`} alt={`Foto de ${p.nombre}`} className="miniatura retrato" />}
    <p className="ayuda">La foto y el nombre con la inicial del apellido se muestran en el portal de reservas.</p>

    {p.editable && <details><summary>Editar datos</summary>
      <Formulario accion={accionActualizarProfesional} boton="Guardar" className="en-linea">
        <input type="hidden" name="profesionalId" value={p.id} />
        <input name="nombre" defaultValue={p.nombre} required maxLength={80} aria-label="Nombre" />
        <input name="apellido" defaultValue={p.apellido ?? ""} maxLength={80} aria-label="Apellido" />
        <label className="check"><input type="checkbox" name="activo" defaultChecked={p.activo} />Activo</label>
      </Formulario>
    </details>}

    <h2 className="subtitulo">Jornada por sede</h2>
    <div className="tabla">{p.sedes.map(s => <article key={s.sedeId} className={s.activo ? "fila" : "fila inactiva"}>
      <div className="fila-cabecera"><h2>{s.nombre}</h2><span className="tag">{s.activo ? "Activa" : "Desvinculada"}</span></div>
      <p>{textoSemana(s.semana)}</p>
      {s.editable && <details><summary>Editar jornada</summary>
        <Formulario accion={accionHorarioProfesional} boton="Guardar jornada">
          <input type="hidden" name="profesionalId" value={p.id} /><input type="hidden" name="sedeId" value={s.sedeId} />
          <CamposSemana semana={s.semana} />
          <p className="ayuda">Formato 09:00-13:00, 14:00-20:00. Los cortes entre rangos son pausas.</p>
        </Formulario>
      </details>}
      {s.editable && <Formulario accion={accionVincularSedeProfesional} boton={s.activo ? "Desvincular de la sede" : "Volver a vincular"} className="en-linea" secundario>
        <input type="hidden" name="profesionalId" value={p.id} /><input type="hidden" name="sedeId" value={s.sedeId} /><input type="hidden" name="activo" value={String(!s.activo)} />
      </Formulario>}
    </article>)}</div>
    {p.editable && sinVincular.length > 0 && <Formulario accion={accionVincularSedeProfesional} boton="Vincular a otra sede" className="en-linea" secundario>
      <input type="hidden" name="profesionalId" value={p.id} />
      <select name="sedeId" aria-label="Sede">{sinVincular.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
    </Formulario>}

    {catalogo && <>
      <h2 className="subtitulo">Habilidades y servicios</h2>
      <Formulario accion={accionHabilidades} boton="Guardar habilidades">
        <input type="hidden" name="profesionalId" value={p.id} />
        <fieldset><legend>Habilidades</legend>{catalogo.skills.map(s => <label key={s.id} className="check"><input type="checkbox" name="skillId" value={s.id} defaultChecked={tiene.has(s.id)} />{s.nombre}</label>)}
          {!catalogo.skills.length && <span className="ayuda">El master todavía no cargó habilidades.</span>}</fieldset>
        <fieldset><legend>Servicios habilitados (además necesita todas las habilidades que el servicio requiere)</legend>
          {catalogo.categorias.flatMap(c => c.servicios).filter(s => s.activo).map(s => {
            const faltan = s.skills.filter(x => !tiene.has(x.skillId)).length;
            return <label key={s.id} className="check"><input type="checkbox" name="servicioId" value={s.id} defaultChecked={p.servicioIds.includes(s.id)} />{s.nombre}{faltan ? ` (le faltan ${faltan} habilidad${faltan > 1 ? "es" : ""})` : ""}</label>;
          })}</fieldset>
      </Formulario>
    </>}

    <h2 className="subtitulo">Ausencias</h2>
    <p className="ayuda">Valen para todas sus sedes. Horario de {tz.replace(/_/g, " ")}.</p>
    <ul className="lista">{p.bloqueos.map(b => <li key={b.id}>{fmt(b.inicio)} → {fmt(b.fin)}{b.motivo ? ` · ${b.motivo}` : ""}
      {p.editable && <Formulario accion={accionEliminarBloqueo} boton="Quitar" className="en-linea" secundario>
        <input type="hidden" name="profesionalId" value={p.id} /><input type="hidden" name="bloqueoId" value={b.id} />
      </Formulario>}</li>)}
      {!p.bloqueos.length && <li>Sin ausencias próximas.</li>}</ul>
    {p.editable && <Formulario accion={accionCrearBloqueo} boton="Agregar ausencia" className="en-linea">
      <input type="hidden" name="profesionalId" value={p.id} /><input type="hidden" name="tz" value={tz} />
      <label className="campo">Desde<input type="datetime-local" name="inicio" required step={300} /></label>
      <label className="campo">Hasta<input type="datetime-local" name="fin" required step={300} /></label>
      <input name="motivo" placeholder="Motivo (opcional)" maxLength={200} aria-label="Motivo" />
    </Formulario>}
  </section>;
}
