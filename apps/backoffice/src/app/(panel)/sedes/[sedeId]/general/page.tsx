import type { Metadata } from "next";
import { obtenerConfiguracion } from "@nailnet/database/configuracion";
import { Formulario } from "@/components/formulario";
import { SelectorZona } from "@/components/zona";
import { db } from "@/lib/db";
import { cargarSede } from "@/lib/sede";
import { accionActualizarSede, accionEstadoSede } from "../../../acciones";

export const metadata: Metadata = { title: "Datos de la sede · Sicurella" };

export default async function GeneralSede({ params }: { params: Promise<{ sedeId: string }> }) {
  const { sedeId } = await params;
  const { actorId, organizacion, sede, puede } = await cargarSede(sedeId);
  const { puedeEditarSede } = await obtenerConfiguracion(db(), actorId, organizacion.id, sede.id);
  const puedeEstado = puede.crearSedeEn(sede.franquiciadoId);

  return <>
    <h2 className="subtitulo">Datos generales</h2>
    <ul className="lista">
      <li>Nombre: <strong>{sede.nombre}</strong></li>
      <li>Franquiciado: <strong>{sede.franquiciado.nombre}</strong>{sede.franquiciado.activo ? "" : " · inactivo"}</li>
      <li>Zona horaria: <strong>{sede.timezone.replace(/_/g, " ")}</strong></li>
    </ul>
    <p className="ayuda">La zona horaria define cómo se leen el horario, las jornadas y los turnos de la sede.</p>
    {puedeEditarSede && sede.activo && <Formulario accion={accionActualizarSede} boton="Guardar" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} />
      <input name="nombre" defaultValue={sede.nombre} required maxLength={120} aria-label="Nombre" />
      <SelectorZona valor={sede.timezone} />
    </Formulario>}

    {puedeEstado && <>
      <h2 className="subtitulo">Estado</h2>
      <p className="ayuda">{sede.activo ? "Desactivarla la saca de la agenda y del portal. No borra su configuración, equipo ni historial." : "Al reactivarla vuelve a la operación diaria con la configuración que tenía."}</p>
      <Formulario accion={accionEstadoSede} boton={sede.activo ? "Desactivar sede" : "Reactivar sede"} className="en-linea" secundario
        confirmar={sede.activo ? `¿Desactivar ${sede.nombre}? Deja de aparecer en la operación diaria.` : undefined}>
        <input type="hidden" name="sedeId" value={sede.id} /><input type="hidden" name="activo" value={String(!sede.activo)} />
      </Formulario>
    </>}
  </>;
}
