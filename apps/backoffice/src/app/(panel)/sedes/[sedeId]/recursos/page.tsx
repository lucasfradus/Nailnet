import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listarCatalogo } from "@nailnet/database/catalogo";
import { calendarioSede } from "@nailnet/database/profesionales";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { cargarSede, oNulo } from "@/lib/sede";
import { accionCrearRecurso, accionEstadoRecurso } from "../../../acciones";

export const metadata: Metadata = { title: "Recursos de la sede · Sicurella" };

export default async function RecursosSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede } = await cargarSede(sedeId);
  if (!sede.activo) return <p className="ayuda">Disponible mientras la sede esté activa.</p>;
  const cal = await oNulo(calendarioSede(db(), actorId, organizacion.id, sede.id));
  if (!cal) notFound();
  const tiposRecurso = cal.editable ? (await listarCatalogo(db(), actorId, organizacion.id)).tiposRecurso : [];

  return <>
    <h2 className="subtitulo">Cabinas y equipos</h2>
    <ul className="lista">{cal.recursos.map(r => <li key={r.id}>{r.tipo} · {r.nombre}{r.activo ? "" : " · fuera de servicio"}
      {cal.editable && <Formulario accion={accionEstadoRecurso} boton={r.activo ? "Fuera de servicio" : "Reactivar"} className="en-linea" secundario>
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="recursoId" value={r.id} /><input type="hidden" name="activo" value={String(!r.activo)} />
      </Formulario>}</li>)}
      {!cal.recursos.length && <li>Sin recursos cargados.</li>}</ul>
    <p className="ayuda">Un servicio que ocupa un tipo de recurso solo se ofrece si la sede tiene unidades libres de ese tipo.</p>
    {cal.editable && tiposRecurso.length > 0 && <Formulario accion={accionCrearRecurso} boton="Agregar recurso" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} />
      <select name="tipoRecursoId" aria-label="Tipo">{tiposRecurso.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
      <input name="nombre" placeholder="Nombre (Cabina 1)" required maxLength={80} aria-label="Nombre" />
    </Formulario>}
  </>;
}
