import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { equipoSede } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { CamposSemana, textoSemana } from "@/components/semana";
import { db } from "@/lib/db";
import { cargarSede, oNulo } from "@/lib/sede";
import { accionCrearProfesional, accionHorarioProfesional, accionVincularSedeProfesional } from "../../../acciones";

export const metadata: Metadata = { title: "Equipo de la sede · Sicurella" };

export default async function EquipoSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede } = await cargarSede(sedeId);
  if (!sede.activo) return <p className="ayuda">Disponible mientras la sede esté activa.</p>;
  const equipo = await oNulo(equipoSede(db(), actorId, organizacion.id, sede.id));
  if (!equipo) notFound();
  const { editable, profesionales, disponibles } = equipo;

  return <>
    <h2 className="subtitulo">Profesionales</h2>
    <div className="tabla">
      {profesionales.map(p => {
        const atiende = p.activo && p.vinculado;
        return <article key={p.id} className={atiende ? "fila" : "fila inactiva"}>
          <div className="fila-cabecera">
            <h2><Link href={`/profesionales/${p.id}`}>{p.nombre} {p.apellido}</Link></h2>
            <span className="tag">{!p.activo ? "Inactivo" : p.vinculado ? "Atiende en la sede" : "Desvinculado"}</span>
          </div>
          <p>{textoSemana(p.semana)} · {p.servicios} {p.servicios === 1 ? "servicio habilitado" : "servicios habilitados"}</p>
          {editable && atiende && <details><summary>Editar jornada en {sede.nombre}</summary>
            <Formulario accion={accionHorarioProfesional} boton="Guardar jornada">
              <input type="hidden" name="profesionalId" value={p.id} /><input type="hidden" name="sedeId" value={sede.id} />
              <CamposSemana semana={p.semana} />
              <p className="ayuda">Formato 09:00-13:00, 14:00-20:00. No puede superponerse con su jornada en otra sede.</p>
            </Formulario>
          </details>}
          {editable && p.activo && <Formulario accion={accionVincularSedeProfesional} boton={p.vinculado ? "Desvincular de la sede" : "Volver a vincular"} className="en-linea" secundario
            confirmar={p.vinculado ? `¿Desvincular a ${p.nombre} de ${sede.nombre}? Deja de recibir turnos en esta sede.` : undefined}>
            <input type="hidden" name="profesionalId" value={p.id} /><input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="activo" value={String(!p.vinculado)} />
          </Formulario>}
        </article>;
      })}
      {!profesionales.length && <p>Todavía no hay profesionales en esta sede.</p>}
    </div>
    <p className="ayuda pie-tabla">Foto, habilidades, servicios habilitados y ausencias se editan en la ficha de cada profesional y valen para todas sus sedes.</p>

    {editable && <>
      {disponibles.length > 0 && <>
        <h2 className="subtitulo">Sumar a alguien del equipo</h2>
        <Formulario accion={accionVincularSedeProfesional} boton="Vincular a la sede" className="en-linea">
          <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="activo" value="true" />
          <select name="profesionalId" aria-label="Profesional">{disponibles.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}</select>
        </Formulario>
        <p className="ayuda">Profesionales que ya trabajan en otras sedes tuyas. Después de vincular, cargale la jornada en esta sede.</p>
      </>}
      <h2 className="subtitulo">Nuevo profesional</h2>
      <Formulario accion={accionCrearProfesional} boton="Crear profesional" className="en-linea">
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="volver" value={`/sedes/${sede.id}/equipo`} />
        <input name="nombre" placeholder="Nombre" required maxLength={80} aria-label="Nombre" />
        <input name="apellido" placeholder="Apellido" maxLength={80} aria-label="Apellido" />
      </Formulario>
    </>}
  </>;
}
