"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { atenderAhora } from "@nailnet/database/reservas";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// «Atender ahora» (O01): acción delgada; actor y organización salen de la sesión y el repositorio
// vuelve a autorizar sede, cliente, servicios y profesionales.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
const MAX_SERVICIOS_AHORA = 3;

export async function accionAtenderAhora(_: Estado, form: FormData): Promise<Estado> {
  const items: { servicioId: string; profesionalId: string; conAnterior: boolean }[] = [];
  for (let i = 0; i < MAX_SERVICIOS_AHORA; i++) {
    const servicioId = texto(form, `s_${i}`);
    // «A la vez»: empieza junto con el anterior, con otra profesional (doc 29, etapa 2).
    if (servicioId) items.push({ servicioId, profesionalId: texto(form, `p_${i}`), conAnterior: texto(form, `j_${i}`) === "1" });
  }
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    await atenderAhora(db(), sesion.usuario.id, organizacion.id, { sedeId: texto(form, "sedeId"), clienteId: texto(form, "clienteId"), items, notas: texto(form, "notas"), esperaId: texto(form, "esperaId") || null });
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
  revalidatePath("/agenda");
  revalidatePath("/recepcion");
  redirect(texto(form, "volver") === "recepcion" ? "/recepcion?ok=ahora" : "/agenda?ok=ahora");
}
