"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { abrirCaja, cerrarCaja, registrarMovimientoManual, revertirMovimientoCaja } from "@nailnet/database/caja";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";
import { pesos } from "../gastos/comun";

// O02. Acciones delgadas: actor y organización salen de la sesión validada; los IDs del formulario
// solo indican el objetivo y el repositorio vuelve a autorizarlos contra el alcance.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

async function ejecutar(fn: (actorId: string, organizacionId: string) => Promise<string | void>, exito: string): Promise<Estado> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    const mensaje = await fn(sesion.usuario.id, organizacion.id);
    revalidatePath("/caja", "layout");
    return { ok: mensaje || exito };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
}

export async function accionAbrirCaja(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => { await abrirCaja(db(), actor, org, { sedeId: texto(form, "sedeId"), montoInicial: texto(form, "montoInicial") }); }, "Caja abierta");
}
export async function accionMovimientoCaja(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => {
    await registrarMovimientoManual(db(), actor, org, { sedeId: texto(form, "sedeId"), tipo: texto(form, "tipo"), monto: texto(form, "monto"), motivo: texto(form, "motivo") });
  }, "Movimiento registrado");
}
export async function accionRevertirMovimientoCaja(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => { await revertirMovimientoCaja(db(), actor, org, texto(form, "movimientoId"), texto(form, "motivo")); }, "Movimiento revertido");
}
export async function accionCerrarCaja(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => {
    const r = await cerrarCaja(db(), actor, org, { cajaId: texto(form, "cajaId"), contado: texto(form, "contado"), observaciones: texto(form, "observaciones") });
    const d = r.diferencia;
    return `Caja cerrada. Esperado ${pesos(r.esperado)}, contado ${pesos(r.contado)}: ${d === "0.00" ? "sin diferencia" : d.startsWith("-") ? `faltante de ${pesos(d.slice(1))}` : `sobrante de ${pesos(d)}`}`;
  }, "Caja cerrada");
}
