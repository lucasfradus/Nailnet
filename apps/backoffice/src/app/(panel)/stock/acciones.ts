"use server";
import { revalidatePath } from "next/cache";
import { AccesoDenegado } from "@nailnet/domain";
import type { UnidadMedida } from "@nailnet/domain/stock";
import { DatosInvalidos } from "@nailnet/database/access";
import { ajustarStock, guardarPrecioProducto, guardarProducto, registrarCompra, registrarConsumo, revertirMovimiento, transferirStock } from "@nailnet/database/stock";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import type { Estado } from "@/components/formulario";

// Stock (O03). Acciones delgadas: actor y organización salen de la sesión validada; los IDs del
// formulario solo indican el objetivo y el repositorio vuelve a autorizarlos.
const texto = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
const marcado = (f: FormData, k: string) => f.get(k) === "on";

async function ejecutar(fn: (actorId: string, organizacionId: string) => Promise<string | void>, exito: string): Promise<Estado> {
  try {
    const { sesion, organizacion } = await requerirOrganizacion();
    const mensaje = await fn(sesion.usuario.id, organizacion.id);
    revalidatePath("/stock", "layout");
    return { ok: mensaje || exito };
  } catch (e) {
    if (e instanceof AccesoDenegado) return { error: "No tenés permiso para esa operación" };
    if (e instanceof DatosInvalidos) return { error: e.message };
    throw e;
  }
}

export async function accionGuardarProducto(_: Estado, form: FormData) {
  const productoId = texto(form, "productoId") || undefined;
  return ejecutar(async (actor, org) => {
    await guardarProducto(db(), actor, org, {
      nombre: texto(form, "nombre"), sku: texto(form, "sku"), unidad: texto(form, "unidad") as UnidadMedida,
      vendible: marcado(form, "vendible"), activo: productoId ? marcado(form, "activo") : true,
    }, productoId);
  }, productoId ? "Producto actualizado" : "Producto creado");
}

export async function accionPrecioProducto(_: Estado, form: FormData) {
  return ejecutar((actor, org) => guardarPrecioProducto(db(), actor, org, texto(form, "sedeId"), texto(form, "productoId"), texto(form, "precio") || null), "Precio guardado");
}

/** Filas de la compra: producto_N, cantidad_N, costo_N. Las filas sin producto se ignoran. */
function itemsCompra(form: FormData) {
  const items: { productoId: string; cantidad: string; costoUnitario: string }[] = [];
  for (let i = 0; i < 50; i++) {
    const productoId = texto(form, `producto_${i}`);
    if (productoId) items.push({ productoId, cantidad: texto(form, `cantidad_${i}`), costoUnitario: texto(form, `costo_${i}`) });
  }
  return items;
}
export async function accionRegistrarCompra(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => {
    const r = await registrarCompra(db(), actor, org, { sedeId: texto(form, "sedeId"), proveedor: texto(form, "proveedor"), comprobante: texto(form, "comprobante"), fecha: texto(form, "fecha"), items: itemsCompra(form) });
    return `Compra registrada: total $ ${Number(r.total).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
  }, "Compra registrada");
}

export async function accionConsumo(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => {
    await registrarConsumo(db(), actor, org, { sedeId: texto(form, "sedeId"), items: [{ productoId: texto(form, "productoId"), cantidad: texto(form, "cantidad") }], motivo: texto(form, "motivo") });
  }, "Consumo registrado");
}

export async function accionAjuste(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => {
    const r = await ajustarStock(db(), actor, org, { sedeId: texto(form, "sedeId"), productoId: texto(form, "productoId"), contado: texto(form, "contado"), motivo: texto(form, "motivo") });
    return `Ajuste registrado (diferencia ${r.diferencia.replace(".", ",")})`;
  }, "Ajuste registrado");
}

export async function accionTransferencia(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => {
    await transferirStock(db(), actor, org, { origenId: texto(form, "sedeId"), destinoId: texto(form, "destinoId"), items: [{ productoId: texto(form, "productoId"), cantidad: texto(form, "cantidad") }], motivo: texto(form, "motivo") });
  }, "Transferencia registrada");
}

export async function accionRevertir(_: Estado, form: FormData) {
  return ejecutar(async (actor, org) => { await revertirMovimiento(db(), actor, org, texto(form, "movimientoId"), texto(form, "motivo")); }, "Movimiento revertido");
}
