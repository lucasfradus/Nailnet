import { cache } from "react";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { listarSedes } from "@nailnet/database/access";
import { db } from "./db";
import { requerirOrganizacion } from "./contexto";

/**
 * Sede de la ficha /sedes/[sedeId], compartida por el layout y cada pestaña dentro del mismo request.
 * Fuera de alcance (o inactiva sin poder reactivarla) responde 404, igual que un ID inexistente.
 */
export const cargarSede = cache(async (sedeId: string) => {
  const ctx = await requerirOrganizacion();
  const actorId = ctx.sesion.usuario.id;
  const [sede] = await listarSedes(db(), actorId, ctx.organizacion.id, { sedeId, incluirInactivas: true }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; });
  if (!sede) notFound();
  return { ...ctx, actorId, sede };
});

/** Repositorios que niegan por alcance devuelven null: la pestaña lo trata como 404. */
export async function oNulo<T>(p: Promise<T>): Promise<T | null> {
  return p.catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
}
