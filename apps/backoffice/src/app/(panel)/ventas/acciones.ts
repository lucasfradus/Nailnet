"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { DatosInvalidos } from "@nailnet/database/access";
import { anularVenta, registrarCobro, registrarVenta } from "@nailnet/database/ventas";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";
import { FILAS_COBRO, FILAS_PRODUCTO, FILAS_SERVICIO } from "./comun";

// O01. Acciones delgadas: actor y organización salen de la sesión validada; los IDs del formulario
// solo indican el objetivo y el repositorio vuelve a autorizarlos contra el alcance.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

async function ejecutar<T>(fn: (actorId: string, organizacionId: string) => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    const r = await fn(sesion.usuario.id, organizacion.id);
    revalidatePath("/ventas", "layout");
    revalidatePath("/caja", "layout");
    revalidatePath("/agenda");
    return { ok: r };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
}

/** Filas de productos (producto_N, cantidad_N) y de cobros (medio_N, monto_N, referencia_N). Las vacías se ignoran. */
function productos(form: FormData) {
  const lista: { productoId: string; cantidad: string }[] = [];
  for (let i = 0; i < FILAS_PRODUCTO; i++) {
    const productoId = texto(form, `producto_${i}`);
    if (productoId) lista.push({ productoId, cantidad: texto(form, `cantidad_${i}`) || "1" });
  }
  return lista;
}
function cobros(form: FormData) {
  const lista: { medio: string; monto: string; referencia: string }[] = [];
  for (let i = 0; i < FILAS_COBRO; i++) {
    const monto = texto(form, `monto_${i}`).trim();
    if (monto) lista.push({ medio: texto(form, `medio_${i}`), monto, referencia: texto(form, `referencia_${i}`) });
  }
  return lista;
}

/**
 * Comanda (filas servicio_N, profesional_N, precio_N, reservaItem_N). Una fila sin servicio es un servicio
 * que no se hizo (se quita); las filas con reservaItem vienen del turno.
 */
function servicios(form: FormData) {
  const lista: { servicioId: string; profesionalId: string; precio: string; reservaItemId: string | null }[] = [];
  for (let i = 0; i < FILAS_SERVICIO; i++) {
    const servicioId = texto(form, `servicio_${i}`);
    if (servicioId) lista.push({ servicioId, profesionalId: texto(form, `profesional_${i}`), precio: texto(form, `precio_${i}`), reservaItemId: texto(form, `reservaItem_${i}`) || null });
  }
  return lista;
}

export async function accionRegistrarVenta(_: Estado, form: FormData): Promise<Estado> {
  const reservaId = texto(form, "reservaId") || null;
  if (reservaId && servicios(form).some(s => !s.profesionalId)) return { error: "Elegí la profesional de cada servicio" };
  const r = await ejecutar((actor, org) => registrarVenta(db(), actor, org, {
    sedeId: texto(form, "sedeId"), reservaId, servicios: reservaId ? servicios(form) : undefined, productos: productos(form),
    descuento: texto(form, "descuento"), cobros: cobros(form), claveIdempotencia: texto(form, "clave"),
  }));
  if ("error" in r) return r;
  redirect(`/ventas/${r.ok.id}`);
}

export async function accionRegistrarCobro(_: Estado, form: FormData): Promise<Estado> {
  const r = await ejecutar((actor, org) => registrarCobro(db(), actor, org, texto(form, "ventaId"), {
    medio: texto(form, "medio"), monto: texto(form, "monto"), referencia: texto(form, "referencia"), claveIdempotencia: texto(form, "clave"),
  }));
  if ("error" in r) return r;
  return { ok: r.ok.estado === "COMPLETADA" ? "Cobro registrado: la venta quedó cobrada por completo" : "Cobro registrado" };
}

export async function accionAnularVenta(_: Estado, form: FormData): Promise<Estado> {
  const r = await ejecutar((actor, org) => anularVenta(db(), actor, org, texto(form, "ventaId"), { motivo: texto(form, "motivo"), reponerStock: form.get("reponerStock") === "on" }));
  if ("error" in r) return r;
  return { ok: `Venta anulada${r.ok.cobrosRevertidos ? ` (${r.ok.cobrosRevertidos} cobro${r.ok.cobrosRevertidos === 1 ? "" : "s"} revertido${r.ok.cobrosRevertidos === 1 ? "" : "s"})` : ""}` };
}
