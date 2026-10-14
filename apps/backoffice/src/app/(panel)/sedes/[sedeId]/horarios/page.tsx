import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aHora } from "@nailnet/domain/agenda";
import { calendarioSede } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { CamposSemana, textoSemana } from "@/components/semana";
import { db } from "@/lib/db";
import { cargarSede, oNulo } from "@/lib/sede";
import { accionCrearExcepcion, accionEliminarExcepcion, accionHorarioSede } from "../../../acciones";

export const metadata: Metadata = { title: "Horarios de la sede · Sicurella" };

export default async function HorariosSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede } = await cargarSede(sedeId);
  if (!sede.activo) return <p className="ayuda">Disponible mientras la sede esté activa.</p>;
  const cal = await oNulo(calendarioSede(db(), actorId, organizacion.id, sede.id));
  if (!cal) notFound();

  return <>
    <h2 className="subtitulo">Horario de atención</h2>
    <p>{textoSemana(cal.semana)}</p>
    {cal.editable && <details><summary>Editar horario semanal</summary>
      <Formulario accion={accionHorarioSede} boton="Guardar horario">
        <input type="hidden" name="sedeId" value={sede.id} /><CamposSemana semana={cal.semana} />
        <p className="ayuda">Formato 10:00-14:00, 15:00-20:00. Los turnos online se ofrecen dentro de este horario y de la jornada de cada profesional.</p>
      </Formulario>
    </details>}

    <h2 className="subtitulo">Feriados y fechas especiales</h2>
    <ul className="lista">{cal.excepciones.map(e => <li key={e.id}>{e.fecha} · {e.cerrado ? "Cerrado" : `${aHora(e.inicio!)}-${aHora(e.fin!)}`}{e.motivo ? ` · ${e.motivo}` : ""}{e.deOrganizacion ? " · toda la organización" : ""}
      {((e.deOrganizacion && cal.editarFeriados) || (!e.deOrganizacion && cal.editable)) && <Formulario accion={accionEliminarExcepcion} boton="Quitar" className="en-linea" secundario>
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="excepcionId" value={e.id} />
      </Formulario>}</li>)}
      {!cal.excepciones.length && <li>Sin fechas especiales próximas.</li>}</ul>
    <p className="ayuda">Si la sede tiene filas propias para una fecha, reemplazan al feriado de la organización (por ejemplo, abrir medio día).</p>
    {cal.editable && <Formulario accion={accionCrearExcepcion} boton="Agregar fecha" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} />
      <input type="date" name="fecha" required aria-label="Fecha" />
      <label className="check"><input type="checkbox" name="cerrado" defaultChecked />Cerrado</label>
      <input name="desde" placeholder="Desde HH:MM" size={8} aria-label="Desde" /><input name="hasta" placeholder="Hasta HH:MM" size={8} aria-label="Hasta" />
      <input name="motivo" placeholder="Motivo" maxLength={120} aria-label="Motivo" />
      {cal.editarFeriados && <label className="check"><input type="checkbox" name="toda" />Para toda la organización</label>}
    </Formulario>}
  </>;
}
