import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { calendarioSede, listarProfesionales, ocupacionProfesionales } from "@nailnet/database/profesionales";
import { EditorSemana } from "@/components/editor-semana";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearProfesional } from "../acciones";

export const metadata: Metadata = { title: "Profesionales · Sicurella" };
const DIAS = 7;
const sinPermiso = (e: unknown) => { if (e instanceof AccesoDenegado) return null; throw e; };
const etiquetaDia = (fecha: string) => new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric" });
const horas = (min: number) => `${Math.round(min / 6) / 10} h`.replace(".", ",");

function Celda({ disponible, ocupado, turnos }: { disponible: number; ocupado: number; turnos: number }) {
  if (!disponible) return <td className="ocupacion-celda libre"><span className="ayuda">No trabaja</span></td>;
  const pct = Math.round((ocupado / disponible) * 100);
  const nivel = pct >= 85 ? "alta" : pct >= 50 ? "media" : "baja";
  return <td className={`ocupacion-celda ${nivel}`} title={`${horas(ocupado)} de ${horas(disponible)} ocupadas`}>
    <strong>{pct}%</strong><span className="barra-ocupacion"><span style={{ width: `${Math.min(pct, 100)}%` }} /></span>
    <span className="ayuda">{turnos} {turnos === 1 ? "turno" : "turnos"}</span>
  </td>;
}

export default async function Profesionales() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  const lista = await listarProfesionales(db(), actorId, organizacion.id, { sedeId: sede?.id }).catch(sinPermiso);
  if (!lista) notFound();
  const [ocupacion, cal] = sede ? await Promise.all([
    ocupacionProfesionales(db(), actorId, organizacion.id, sede.id, DIAS).catch(sinPermiso),
    calendarioSede(db(), actorId, organizacion.id, sede.id).catch(sinPermiso),
  ]) : [null, null];
  const porId = new Map(ocupacion?.profesionales.map(p => [p.id, p.dias]));
  const sinHorario = cal && !Object.values(cal.semana).some(r => r?.length);

  return <section className="panel">
    <p className="eyebrow">EQUIPO{sede ? ` · ${sede.nombre.toUpperCase()}` : ""}</p><h1>Profesionales</h1>

    <h2 className="subtitulo">Ocupación · próximos {DIAS} días</h2>
    <div className="tabla tabla-desplazable">
      <table className="ocupacion">
        <thead><tr><th scope="col">Profesional</th>{ocupacion?.fechas.map(f => <th key={f} scope="col">{etiquetaDia(f)}</th>)}<th scope="col">Semana</th></tr></thead>
        <tbody>
          {lista.map(p => {
            const dias = porId.get(p.id);
            const total = dias?.reduce((t, d) => ({ disponible: t.disponible + d.disponibleMinutos, ocupado: t.ocupado + d.ocupadoMinutos, turnos: t.turnos + d.turnos }), { disponible: 0, ocupado: 0, turnos: 0 });
            return <tr key={p.id} className={p.activo ? undefined : "inactiva"}>
              <th scope="row"><Link href={`/profesionales/${p.id}`}>{p.nombre} {p.apellido}</Link>
                <span className="ayuda">{p.activo ? p.skills.join(" · ") || "Sin habilidades cargadas" : "Inactivo"}</span></th>
              {dias ? dias.map(d => <Celda key={d.fecha} disponible={d.disponibleMinutos} ocupado={d.ocupadoMinutos} turnos={d.turnos} />)
                : ocupacion?.fechas.map(f => <td key={f} className="ocupacion-celda libre"><span className="ayuda">—</span></td>)}
              {total ? <Celda {...total} /> : <td className="ocupacion-celda libre" />}
            </tr>;
          })}
          {!lista.length && <tr><td colSpan={DIAS + 2}><span className="ayuda">No hay profesionales en esta sede.</span></td></tr>}
        </tbody>
      </table>
    </div>
    <p className="ayuda pie-tabla">Porcentaje del tiempo de trabajo (dentro del horario de la sede y sin ausencias) que ya tiene turnos tomados, preparación incluida.</p>

    {puede.editarSedes && sede && <>
      <h2 className="subtitulo">Nuevo profesional</h2>
      {sinHorario ? <p className="alerta error">La sede todavía no tiene horario de atención. <Link href={`/sedes/${sede.id}/horarios`}>Cargalo primero</Link> para poder asignar jornadas.</p>
        : <article>
          <Formulario accion={accionCrearProfesional} boton="Crear profesional">
            <input type="hidden" name="sedeId" value={sede.id} />
            <div className="grilla">
              <label>Nombre<input name="nombre" required maxLength={80} /></label>
              <label>Apellido<input name="apellido" maxLength={80} /></label>
            </div>
            <fieldset className="bloque"><legend>Jornada en {sede.nombre}</legend>
              <EditorSemana semana={cal?.semana ?? {}} limite={cal?.semana ?? {}} />
            </fieldset>
          </Formulario>
          <p className="ayuda pie-tabla">Arranca con el horario completo de la sede: destildá los días que no trabaja y ajustá las horas. La ficha es de la organización; después podés vincularla a otras sedes.</p>
        </article>}
    </>}
  </section>;
}
