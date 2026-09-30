import { cache } from "react";
import { cookies } from "next/headers";
import { AccesoDenegado, puedeCrearSede, tienePermiso } from "@nailnet/domain";
import { asignacionesActor, listarSedes } from "@nailnet/database/access";
import { resumenAcceso } from "@nailnet/database/auth";
import { db } from "./db";
import { requerirSesion } from "./sesion";

export const COOKIE_ORGANIZACION = "nailnet_organizacion";
export const COOKIE_SEDE = "nailnet_sede";

/**
 * Contexto del panel. Organización y sede elegidas son solo filtros visuales: se validan contra el
 * alcance en cada request y un valor que ya no corresponde se ignora (vuelve a «todas mis sedes»),
 * nunca amplía resultados. Cada operación vuelve a autorizar en el repositorio.
 */
export const contextoPanel = cache(async () => {
  const sesion = await requerirSesion();
  const usuarioId = sesion.usuario.id;
  const membresias = await resumenAcceso(db(), usuarioId);
  const almacen = await cookies();
  const pedida = almacen.get(COOKIE_ORGANIZACION)?.value;
  const organizacion = (membresias.find(m => m.organizacion.id === pedida) ?? membresias[0])?.organizacion;
  if (!organizacion) return { sesion, organizaciones: [], organizacion: null, sedes: [], sede: null, puede: sinPermisos };

  const actor = await asignacionesActor(db(), usuarioId, organizacion.id);
  const sedes = await listarSedes(db(), usuarioId, organizacion.id).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; });
  const sede = sedes.find(s => s.id === almacen.get(COOKIE_SEDE)?.value) ?? null;
  const puede = {
    verSedes: actor.some(a => tienePermiso(a, "sede:leer")),
    editarSedes: actor.some(a => tienePermiso(a, "sede:administrar")),
    crearSedes: actor.some(a => tienePermiso(a, "sede:crear")),
    administrarFranquiciados: actor.some(a => tienePermiso(a, "franquiciado:administrar")),
    verUsuarios: actor.some(a => tienePermiso(a, "usuario:leer")),
    administrarUsuarios: actor.some(a => tienePermiso(a, "usuario:administrar")),
    crearSedeEn: (franquiciadoId: string) => puedeCrearSede(actor, franquiciadoId),
  };
  return { sesion, organizaciones: membresias.map(m => m.organizacion), organizacion, sedes, sede, puede, asignaciones: membresias.find(m => m.organizacion.id === organizacion.id)?.asignaciones ?? [] };
});

const sinPermisos = { verSedes: false, editarSedes: false, crearSedes: false, administrarFranquiciados: false, verUsuarios: false, administrarUsuarios: false, crearSedeEn: () => false };

export async function requerirOrganizacion() {
  const ctx = await contextoPanel();
  if (!ctx.organizacion) throw new AccesoDenegado();
  return { ...ctx, organizacion: ctx.organizacion };
}
