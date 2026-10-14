// O01 · Cobros manuales y ventas mixtas (y M03, aplicación de la seña). Ver docs/27-ventas-caja.md.
// Cada operación autoriza en el repositorio con el alcance del actor (cubreSede): un ID de sede, venta
// o reserva fuera del alcance equivale a un recurso inexistente (AccesoDenegado).
//
// Facturación (D9): no está definida. El punto de enganche es la transición a COMPLETADA (y cada cobro)
// en `completarSiCorresponde`: cuando D9 se cierre, ahí se encola el trabajo de emisión en el outbox,
// en la misma transacción. Hoy no se emite ni se simula nada.
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, validarFecha } from "@nailnet/domain/agenda";
import { importe } from "@nailnet/domain/catalogo";
import { aMilesimas, cantidadTexto, decimal, desdeDecimal, subtotalCentavos, validarCantidad } from "@nailnet/domain/stock";
import { calcularVenta, claveValida, descuentoDe, esEfectivo, estadoSegunCobros, resumirCobros, saldoVenta, validarCobros, validarMotivo, type CobroEntrada, type CobroValidado, type LineaVenta, type MedioCobro } from "@nailnet/domain/ventas";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, auditar, exigirIds } from "./access.ts";
import { SIN_CAJA, asentarMovimiento, cajaAbiertaBloqueada, centavos, exigirSedeVenta, hayCajaAbierta } from "./caja.ts";
import { conReintento } from "./reservas.ts";
import { egresarPorVenta, reponerPorAnulacionVenta, type ItemCantidad } from "./stock.ts";

type Tx = Prisma.TransactionClient;
const esUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const fechaDb = (f: string) => new Date(`${f}T00:00:00Z`);
const fechaTexto = (d: Date) => d.toISOString().slice(0, 10);
const nombreCompleto = (p: { nombre: string; apellido: string | null } | null | undefined) => p ? [p.nombre, p.apellido].filter(Boolean).join(" ") : "";

export const SIN_CAJA_EFECTIVO = "Para cobrar en efectivo abrí la caja de la sede (menú Caja). Con tarjeta, transferencia o Mercado Pago se puede cobrar con la caja cerrada.";

// ─── Anticipo (seña de Mercado Pago) ──────────────────────────────────────────

/**
 * Seña aprobada que respalda el turno: la de la reserva o la de las que reemplazó al reprogramarse (el
 * pago queda contra la reserva original, doc 23). Solo cuenta APROBADO: A_DEVOLVER y REEMBOLSADO no
 * son anticipo. Si hubiera más de una, no se adivina: se pide revisarlo.
 */
async function anticipoDe(tx: Tx, organizacionId: string, sedeId: string, reservaId: string) {
  const cadena = [reservaId];
  for (let actual: string | null = reservaId, i = 0; actual && i < 20; i++) {
    const r: { reemplazaId: string | null } | null = await tx.reserva.findFirst({ where: { id: actual, organizacionId }, select: { reemplazaId: true } });
    actual = r?.reemplazaId ?? null;
    if (actual) cadena.push(actual);
  }
  const pagos = await tx.pago.findMany({ where: { organizacionId, reservaId: { in: cadena }, estado: "APROBADO" }, select: { id: true, monto: true, sedeId: true } });
  if (pagos.length > 1) throw new DatosInvalidos("El turno tiene más de una seña aprobada: revisalo antes de cobrar");
  const pago = pagos[0];
  if (!pago) return null;
  if (pago.sedeId !== sedeId) throw new DatosInvalidos("La seña del turno se cobró en otra sede: revisalo antes de cobrar");
  return { pagoId: pago.id, monto: centavos(pago.monto) };
}

// ─── Núcleo: cobros bajo lock ─────────────────────────────────────────────────

type VentaBloqueada = { id: string; sedeId: string; estado: string; total: bigint; anticipo: bigint; cobrado: bigint };

/** Bloquea la venta (FOR UPDATE) y suma sus cobros netos. Dos cobros simultáneos se serializan aquí. */
async function bloquearVenta(tx: Tx, organizacionId: string, ventaId: string): Promise<VentaBloqueada | null> {
  const [v] = await tx.$queryRaw<{ id: string; sedeId: string; estado: string; total: string; anticipo: string }[]>`
    SELECT id::text AS id, "sedeId"::text AS "sedeId", estado::text AS estado, total::text AS total, anticipo::text AS anticipo
    FROM "Venta" WHERE id = ${ventaId}::uuid AND "organizacionId" = ${organizacionId}::uuid FOR UPDATE`;
  if (!v) return null;
  const [s] = await tx.$queryRaw<{ total: string }[]>`SELECT COALESCE(sum(monto), 0)::text AS total FROM "CobroVenta" WHERE "ventaId" = ${ventaId}::uuid`;
  return { id: v.id, sedeId: v.sedeId, estado: v.estado, total: centavos(v.total), anticipo: centavos(v.anticipo), cobrado: centavos(s!.total) };
}

/**
 * Inserta cobros de una venta ya bloqueada. El efectivo exige caja abierta y genera su ingreso de caja;
 * los demás medios quedan asociados a la caja si hay una abierta (para el resumen por medio del cierre)
 * y nunca suman al efectivo esperado.
 */
async function asentarCobros(tx: Tx, organizacionId: string, actorId: string, venta: VentaBloqueada, cobros: CobroValidado[], clave?: string) {
  if (!cobros.length) return;
  const caja = await cajaAbiertaBloqueada(tx, organizacionId, venta.sedeId);
  if (!caja && cobros.some(c => esEfectivo(c.medio))) throw new DatosInvalidos(SIN_CAJA_EFECTIVO);
  for (const [i, c] of cobros.entries()) {
    const cobro = await tx.cobroVenta.create({
      data: { organizacionId, sedeId: venta.sedeId, ventaId: venta.id, tipo: "COBRO", medio: c.medio, monto: importe(c.monto), referencia: c.referencia, cajaId: caja?.id ?? null, claveIdempotencia: i === 0 ? clave : undefined, registradoPorId: actorId },
      select: { id: true },
    });
    if (esEfectivo(c.medio)) await asentarMovimiento(tx, organizacionId, venta.sedeId, actorId, caja!, { tipo: "INGRESO_COBRO", monto: c.monto, cobroId: cobro.id });
    venta.cobrado += c.monto;
  }
}

/**
 * Si anticipo + cobros cubren el total, la venta pasa a COMPLETADA. Punto de enganche de la
 * facturación (D9, sin definir): aquí se encolaría la emisión en la misma transacción.
 */
async function completarSiCorresponde(tx: Tx, venta: VentaBloqueada) {
  if (venta.estado !== "PENDIENTE" || estadoSegunCobros(venta.total, venta.anticipo, venta.cobrado) !== "COMPLETADA") return venta.estado;
  await tx.venta.update({ where: { id: venta.id }, data: { estado: "COMPLETADA", completadaEn: new Date() } });
  venta.estado = "COMPLETADA";
  return venta.estado;
}

// ─── Alta de venta ────────────────────────────────────────────────────────────

export type DatosVenta = {
  sedeId: string;
  /** Turno ATENDIDO que se cobra; sus servicios entran con el precio pactado. Sin reserva: venta de productos sueltos. */
  reservaId?: string | null;
  productos: ItemCantidad[];
  descuento?: string | null;
  /** Cobros a registrar junto con la venta (pueden ser varios medios). Lo que falte se cobra después. */
  cobros: CobroEntrada[];
  /** Clave del formulario: un doble envío devuelve la misma venta. */
  claveIdempotencia: string;
};
export type VentaRegistrada = { id: string; estado: string; saldo: string; repetida: boolean };

async function ventaPorClave(db: Database | Tx, actorId: string, organizacionId: string, clave: string): Promise<VentaRegistrada | null> {
  const v = await db.venta.findFirst({ where: { organizacionId, claveIdempotencia: clave }, select: { id: true, sedeId: true, estado: true, total: true, anticipo: true, cobros: { select: { monto: true } } } });
  if (!v) return null;
  await exigirSedeVenta(db, actorId, organizacionId, v.sedeId, "venta:leer");
  const cobrado = v.cobros.reduce((s, c) => s + centavos(c.monto), 0n);
  return { id: v.id, estado: v.estado, saldo: importe(v.estado === "ANULADA" ? 0n : saldoVenta(centavos(v.total), centavos(v.anticipo), cobrado)), repetida: true };
}

/**
 * Registra una venta de la sede con sus ítems y, opcionalmente, sus primeros cobros, todo en una
 * transacción: ítems inmutables, egreso de stock de los productos (egresarPorVenta, todo o nada),
 * cobros con su ingreso de caja si son en efectivo, y la seña de la reserva aplicada como anticipo
 * (nunca como un cobro ni como ingreso de caja). Ejemplo M03: servicio de $30.000 con seña de $9.000
 * → venta de $30.000, anticipo $9.000, se cobran $21.000.
 */
export async function registrarVenta(db: Database, actorId: string, organizacionId: string, datos: DatosVenta): Promise<VentaRegistrada> {
  exigirIds(datos.sedeId, datos.reservaId, ...datos.productos.map(p => p.productoId));
  if (!claveValida(datos.claveIdempotencia)) throw new DatosInvalidos("El formulario venció: recargá la página e intentá de nuevo");
  const descuento = descuentoDe(datos.descuento);
  if (descuento === null) throw new DatosInvalidos("Descuento inválido: pesos con hasta 2 decimales");
  const productos = datos.productos.map(p => {
    const cantidad = aMilesimas(p.cantidad);
    const error = validarCantidad(cantidad);
    if (error) throw new DatosInvalidos(error);
    return { productoId: p.productoId, cantidad: cantidad! };
  });
  if (new Set(productos.map(p => p.productoId)).size !== productos.length) throw new DatosInvalidos("Un producto aparece dos veces: sumá las cantidades en una sola fila");
  const repetida = await ventaPorClave(db, actorId, organizacionId, datos.claveIdempotencia);
  if (repetida) return repetida;

  try {
    return await conReintento(() => db.$transaction(async tx => {
      await exigirSedeVenta(tx, actorId, organizacionId, datos.sedeId, "venta:registrar");
      const sede = await tx.sede.findFirst({ where: { id: datos.sedeId, organizacionId, activo: true }, select: { timezone: true } });
      if (!sede) throw new AccesoDenegado();

      const lineas: (LineaVenta & { tipo: "SERVICIO" | "PRODUCTO"; reservaItemId?: string; productoId?: string; descripcion: string })[] = [];
      let anticipo: Awaited<ReturnType<typeof anticipoDe>> = null;
      if (datos.reservaId) {
        const reserva = await tx.reserva.findFirst({
          where: { id: datos.reservaId, organizacionId },
          select: { sedeId: true, estado: true, items: { orderBy: { posicion: "asc" }, select: { id: true, precio: true, servicio: { select: { nombre: true } }, profesional: { select: { nombre: true, apellido: true } } } } },
        });
        // Una reserva de otra sede es, para esta venta, inexistente.
        if (!reserva || reserva.sedeId !== datos.sedeId) throw new AccesoDenegado();
        if (reserva.estado !== "ATENDIDA") throw new DatosInvalidos("Solo se cobra un turno atendido: marcalo como atendido en la agenda");
        if (await tx.venta.count({ where: { organizacionId, reservaId: datos.reservaId, estado: { not: "ANULADA" } } })) throw new DatosInvalidos("El turno ya tiene una venta registrada");
        for (const it of reserva.items) lineas.push({ tipo: "SERVICIO", reservaItemId: it.id, cantidad: 1000n, precioUnitario: centavos(it.precio), descripcion: `${it.servicio.nombre} · ${nombreCompleto(it.profesional)}` });
        anticipo = await anticipoDe(tx, organizacionId, datos.sedeId, datos.reservaId);
      }
      if (productos.length) {
        const encontrados = await tx.producto.findMany({
          where: { organizacionId, id: { in: productos.map(p => p.productoId) } },
          select: { id: true, nombre: true, activo: true, vendible: true, sedes: { where: { sedeId: datos.sedeId }, select: { precio: true } } },
        });
        if (encontrados.length !== productos.length) throw new AccesoDenegado();
        const porId = new Map(encontrados.map(p => [p.id, p]));
        for (const p of productos) {
          const prod = porId.get(p.productoId)!;
          if (!prod.vendible) throw new DatosInvalidos(`«${prod.nombre}» es de consumo interno: no se vende`);
          if (!prod.activo) throw new DatosInvalidos(`«${prod.nombre}» está inactivo`);
          const precio = prod.sedes[0]?.precio;
          if (!precio) throw new DatosInvalidos(`«${prod.nombre}» no tiene precio de venta en la sede`);
          lineas.push({ tipo: "PRODUCTO", productoId: prod.id, cantidad: p.cantidad, precioUnitario: centavos(precio), descripcion: prod.nombre });
        }
      }
      if (!lineas.length) throw new DatosInvalidos("Agregá al menos un producto o cobrá un turno atendido");
      const totales = calcularVenta(lineas, descuento, anticipo?.monto ?? 0n);
      if ("error" in totales) throw new DatosInvalidos(totales.error);
      const cobros = validarCobros(datos.cobros, totales.aCobrar);
      if ("error" in cobros) throw new DatosInvalidos(cobros.error);

      const creada = await tx.venta.create({
        data: {
          organizacionId, sedeId: datos.sedeId, reservaId: datos.reservaId ?? null, fecha: fechaDb(aLocal(new Date(), sede.timezone).fecha),
          subtotal: importe(totales.subtotal), descuento: importe(totales.descuento), total: importe(totales.total),
          anticipo: importe(totales.anticipo), pagoAnticipoId: anticipo?.pagoId ?? null, estado: "PENDIENTE",
          claveIdempotencia: datos.claveIdempotencia, registradoPorId: actorId,
        },
        select: { id: true },
      });
      await tx.ventaItem.createMany({ data: lineas.map((l, posicion) => ({
        organizacionId, ventaId: creada.id, posicion, tipo: l.tipo, reservaItemId: l.reservaItemId, productoId: l.productoId, descripcion: l.descripcion.slice(0, 300),
        cantidad: decimal(l.cantidad), precioUnitario: importe(l.precioUnitario), subtotal: importe(subtotalCentavos(l.cantidad, l.precioUnitario)),
      })) });
      // Orden de locks: venta → saldos de stock → caja.
      if (productos.length) await egresarPorVenta(tx, actorId, organizacionId, { sedeId: datos.sedeId, ventaId: creada.id, items: productos.map(p => ({ productoId: p.productoId, cantidad: cantidadTexto(p.cantidad) })) });
      const venta: VentaBloqueada = { id: creada.id, sedeId: datos.sedeId, estado: "PENDIENTE", total: totales.total, anticipo: totales.anticipo, cobrado: 0n };
      await asentarCobros(tx, organizacionId, actorId, venta, cobros.cobros);
      const estado = await completarSiCorresponde(tx, venta);
      await auditar(tx, organizacionId, actorId, "venta.registrar", "Venta", creada.id, {
        sedeId: datos.sedeId, reservaId: datos.reservaId ?? null, total: importe(totales.total), anticipo: importe(totales.anticipo),
        cobros: cobros.cobros.map(c => ({ medio: c.medio, monto: importe(c.monto) })), estado,
      });
      return { id: creada.id, estado, saldo: importe(saldoVenta(venta.total, venta.anticipo, venta.cobrado)), repetida: false };
    }, { maxWait: 10_000, timeout: 20_000 }));
  } catch (e) {
    if (!esUnico(e)) throw e;
    // Doble envío simultáneo: la otra transacción ya creó la venta con esta clave.
    const ganadora = await ventaPorClave(db, actorId, organizacionId, datos.claveIdempotencia);
    if (ganadora) return ganadora;
    throw new DatosInvalidos("El turno ya tiene una venta registrada");
  }
}

// ─── Cobros posteriores ───────────────────────────────────────────────────────

/**
 * Registra un cobro sobre una venta pendiente, dentro de una transacción de quien llama. Bloquea la
 * venta: dos cobros simultáneos se serializan y el segundo ve el saldo que dejó el primero, así que
 * nunca se cobra de más.
 */
export async function registrarCobroEn(tx: Tx, actorId: string, organizacionId: string, ventaId: string, cobro: CobroEntrada, clave?: string) {
  exigirIds(ventaId);
  const venta = await bloquearVenta(tx, organizacionId, ventaId);
  if (!venta) throw new AccesoDenegado();
  await exigirSedeVenta(tx, actorId, organizacionId, venta.sedeId, "venta:registrar");
  if (venta.estado === "ANULADA") throw new DatosInvalidos("La venta está anulada");
  if (venta.estado === "COMPLETADA") throw new DatosInvalidos("La venta ya está cobrada por completo");
  const v = validarCobros([cobro], saldoVenta(venta.total, venta.anticipo, venta.cobrado));
  if ("error" in v) throw new DatosInvalidos(v.error);
  await asentarCobros(tx, organizacionId, actorId, venta, v.cobros, clave);
  const estado = await completarSiCorresponde(tx, venta);
  await auditar(tx, organizacionId, actorId, "venta.cobrar", "Venta", ventaId, { medio: v.cobros[0]!.medio, monto: importe(v.cobros[0]!.monto), estado });
  return { estado, saldo: importe(saldoVenta(venta.total, venta.anticipo, venta.cobrado)) };
}

export async function registrarCobro(db: Database, actorId: string, organizacionId: string, ventaId: string, cobro: CobroEntrada & { claveIdempotencia: string }) {
  exigirIds(ventaId);
  if (!claveValida(cobro.claveIdempotencia)) throw new DatosInvalidos("El formulario venció: recargá la página e intentá de nuevo");
  const repetido = async () => {
    const c = await db.cobroVenta.findFirst({ where: { organizacionId, claveIdempotencia: cobro.claveIdempotencia }, select: { ventaId: true, sedeId: true } });
    if (!c) return null;
    await exigirSedeVenta(db, actorId, organizacionId, c.sedeId, "venta:leer");
    const v = await db.venta.findUniqueOrThrow({ where: { id: c.ventaId }, select: { estado: true, total: true, anticipo: true, cobros: { select: { monto: true } } } });
    const cobrado = v.cobros.reduce((s, x) => s + centavos(x.monto), 0n);
    return { repetido: true, ventaId: c.ventaId, estado: v.estado as string, saldo: importe(v.estado === "ANULADA" ? 0n : saldoVenta(centavos(v.total), centavos(v.anticipo), cobrado)) };
  };
  const previo = await repetido();
  if (previo) return previo;
  try {
    const r = await conReintento(() => db.$transaction(tx => registrarCobroEn(tx, actorId, organizacionId, ventaId, cobro, cobro.claveIdempotencia)));
    return { ...r, repetido: false, ventaId };
  } catch (e) {
    if (!esUnico(e)) throw e;
    const ganador = await repetido();
    if (ganador) return ganador;
    throw e;
  }
}

// ─── Anulación ────────────────────────────────────────────────────────────────

/**
 * Anula una venta por reverso, sin editar ni borrar nada: cada cobro recibe su REVERSO (el efectivo
 * sale de la caja abierta al momento de anular, nunca de una caja cerrada), el anticipo queda libre
 * para otra venta del mismo turno (la seña sigue cobrada en Mercado Pago; devolverla es M01/D7) y, si
 * se indica, los productos vuelven al stock. Si se necesita devolver efectivo, la caja tiene que estar
 * abierta y con efectivo suficiente.
 */
export async function anularVenta(db: Database, actorId: string, organizacionId: string, ventaId: string, datos: { motivo: string; reponerStock: boolean }) {
  exigirIds(ventaId);
  const m = validarMotivo(datos.motivo);
  if ("error" in m) throw new DatosInvalidos(m.error);
  return conReintento(() => db.$transaction(async tx => {
    const venta = await bloquearVenta(tx, organizacionId, ventaId);
    if (!venta) throw new AccesoDenegado();
    await exigirSedeVenta(tx, actorId, organizacionId, venta.sedeId, "venta:anular");
    if (venta.estado === "ANULADA") throw new DatosInvalidos("La venta ya fue anulada");
    // Orden de locks: venta → saldos de stock → caja.
    const repuestos = datos.reponerStock ? await reponerPorAnulacionVenta(tx, actorId, organizacionId, { sedeId: venta.sedeId, ventaId, motivo: `Anulación de venta: ${m.motivo}`.slice(0, 300) }) : 0;
    const cobros = await tx.cobroVenta.findMany({ where: { organizacionId, ventaId, tipo: "COBRO", reverso: null }, orderBy: { createdAt: "asc" }, select: { id: true, medio: true, monto: true, movimientoCaja: { select: { id: true } } } });
    const caja = cobros.length ? await cajaAbiertaBloqueada(tx, organizacionId, venta.sedeId) : null;
    if (!caja && cobros.some(c => c.medio === "EFECTIVO")) throw new DatosInvalidos(`${SIN_CAJA}: la anulación devuelve el efectivo cobrado`);
    for (const c of cobros) {
      const reverso = await tx.cobroVenta.create({
        data: { organizacionId, sedeId: venta.sedeId, ventaId, tipo: "REVERSO", medio: c.medio, monto: c.monto.neg(), cajaId: caja?.id ?? null, revierteId: c.id, motivo: m.motivo, registradoPorId: actorId },
        select: { id: true },
      });
      if (c.medio === "EFECTIVO") await asentarMovimiento(tx, organizacionId, venta.sedeId, actorId, caja!, { tipo: "REVERSO", monto: -centavos(c.monto), motivo: m.motivo, cobroId: reverso.id, revierteId: c.movimientoCaja!.id });
    }
    await tx.venta.update({ where: { id: ventaId }, data: { estado: "ANULADA", anuladaEn: new Date(), anuladaPorId: actorId, motivoAnulacion: m.motivo } });
    await auditar(tx, organizacionId, actorId, "venta.anular", "Venta", ventaId, { motivo: m.motivo, cobrosRevertidos: cobros.length, productosRepuestos: repuestos });
    return { cobrosRevertidos: cobros.length, productosRepuestos: repuestos };
  }, { maxWait: 10_000, timeout: 20_000 }));
}

// ─── Consultas ────────────────────────────────────────────────────────────────

const MEDIO = (m: string) => m as MedioCobro;

/**
 * Datos para el formulario de cobro: el turno (si se cobra uno) con sus servicios y la seña aplicable,
 * los productos vendibles con precio en la sede y si hay caja abierta.
 */
export async function prepararVenta(db: Database, actorId: string, organizacionId: string, sedeId: string, reservaId?: string | null) {
  exigirIds(reservaId);
  const { puede } = await exigirSedeVenta(db, actorId, organizacionId, sedeId, "venta:registrar");
  let turno = null;
  if (reservaId) {
    const r = await db.reserva.findFirst({
      where: { id: reservaId, organizacionId },
      select: { id: true, sedeId: true, estado: true, cliente: { select: { id: true, nombre: true, apellido: true } },
        items: { orderBy: { posicion: "asc" }, select: { inicio: true, precio: true, servicio: { select: { nombre: true } }, profesional: { select: { nombre: true, apellido: true } } } } },
    });
    if (!r || r.sedeId !== sedeId) throw new AccesoDenegado();
    const vigente = await db.venta.findFirst({ where: { organizacionId, reservaId, estado: { not: "ANULADA" } }, select: { id: true } });
    const anticipo = await db.$transaction(tx => anticipoDe(tx, organizacionId, sedeId, reservaId)).catch(e => { if (e instanceof DatosInvalidos) return { error: e.message }; throw e; });
    const subtotal = r.items.reduce((s, i) => s + centavos(i.precio), 0n);
    turno = {
      id: r.id, estado: r.estado, cliente: r.cliente, ventaId: vigente?.id ?? null,
      items: r.items.map(i => ({ servicio: i.servicio.nombre, profesional: nombreCompleto(i.profesional), inicio: i.inicio, precio: i.precio.toFixed(2) })),
      subtotal: importe(subtotal),
      anticipo: anticipo && "monto" in anticipo ? importe(anticipo.monto) : "0.00",
      // Lo que resta de los servicios después de la seña (sin productos ni descuento).
      aCobrar: importe(subtotal - (anticipo && "monto" in anticipo ? anticipo.monto : 0n)),
      errorAnticipo: anticipo && "error" in anticipo ? anticipo.error : null,
    };
  }
  const productos = await db.producto.findMany({
    where: { organizacionId, vendible: true, activo: true, sedes: { some: { sedeId, precio: { not: null } } } },
    select: { id: true, nombre: true, unidad: true, sedes: { where: { sedeId }, select: { precio: true } }, saldos: { where: { sedeId }, select: { cantidad: true } } },
    orderBy: { nombre: "asc" },
  });
  return {
    puedeAnular: puede("venta:anular"),
    cajaAbierta: await hayCajaAbierta(db, actorId, organizacionId, sedeId).catch(e => { if (e instanceof AccesoDenegado) return false; throw e; }),
    turno,
    productos: productos.map(p => ({ id: p.id, nombre: p.nombre, unidad: p.unidad, precio: p.sedes[0]!.precio!.toFixed(2), stock: cantidadTexto(desdeDecimal(p.saldos[0]?.cantidad.toFixed(3) ?? "0")) })),
  };
}

const incluirVenta = {
  items: { orderBy: { posicion: "asc" as const }, select: { tipo: true, descripcion: true, cantidad: true, precioUnitario: true, subtotal: true, productoId: true, producto: { select: { unidad: true } } } },
  cobros: { orderBy: { createdAt: "asc" as const }, select: { id: true, tipo: true, medio: true, monto: true, referencia: true, motivo: true, revierteId: true, registradoPorId: true, createdAt: true } },
  reserva: { select: { id: true, cliente: { select: { id: true, nombre: true, apellido: true } } } },
} satisfies Prisma.VentaInclude;
type VentaConDetalle = Prisma.VentaGetPayload<{ include: typeof incluirVenta }>;

function presentar(v: VentaConDetalle, nombre: Map<string, string>) {
  const cobrado = v.cobros.reduce((s, c) => s + centavos(c.monto), 0n);
  const revertidos = new Set(v.cobros.filter(c => c.revierteId).map(c => c.revierteId!));
  return {
    id: v.id, sedeId: v.sedeId, fecha: fechaTexto(v.fecha), estado: v.estado, creadaEn: v.createdAt, registradoPor: nombre.get(v.registradoPorId) ?? "—",
    reservaId: v.reservaId, cliente: v.reserva?.cliente ?? null,
    subtotal: v.subtotal.toFixed(2), descuento: v.descuento.toFixed(2), total: v.total.toFixed(2), anticipo: v.anticipo.toFixed(2),
    cobrado: importe(cobrado), saldo: importe(v.estado === "ANULADA" ? 0n : saldoVenta(centavos(v.total), centavos(v.anticipo), cobrado)),
    items: v.items.map(i => ({ tipo: i.tipo, descripcion: i.descripcion, cantidad: cantidadTexto(desdeDecimal(i.cantidad.toFixed(3))), unidad: i.producto?.unidad ?? null, precioUnitario: i.precioUnitario.toFixed(2), subtotal: i.subtotal.toFixed(2) })),
    cobros: v.cobros.map(c => ({ id: c.id, tipo: c.tipo, medio: MEDIO(c.medio), monto: c.monto.toFixed(2), referencia: c.referencia, motivo: c.motivo, por: nombre.get(c.registradoPorId) ?? "—", en: c.createdAt, revertido: revertidos.has(c.id) })),
    anulacion: v.estado === "ANULADA" ? { motivo: v.motivoAnulacion!, por: nombre.get(v.anuladaPorId!) ?? "—", en: v.anuladaEn! } : null,
  };
}
async function nombres(db: Database, ids: (string | null | undefined)[]) {
  const usuarios = await db.usuario.findMany({ where: { id: { in: [...new Set(ids.filter((x): x is string => !!x))] } }, select: { id: true, nombre: true } });
  return new Map(usuarios.map(u => [u.id, u.nombre]));
}

/**
 * Ventas de la sede en un día (fecha local; por defecto, hoy) con los totales del día:
 * - vendido: total de las ventas no anuladas (M03: $30.000, no $39.000);
 * - señas aplicadas: anticipos ya cobrados por Mercado Pago (no entran en la caja);
 * - cobrado en recepción por medio (neto de reversos): efectivo aparte de los digitales;
 * - pendiente de cobro.
 */
export async function listarVentas(db: Database, actorId: string, organizacionId: string, filtro: { sedeId: string; fecha?: string }) {
  const { puede } = await exigirSedeVenta(db, actorId, organizacionId, filtro.sedeId, "venta:leer");
  const sede = await db.sede.findFirst({ where: { id: filtro.sedeId, organizacionId }, select: { timezone: true } });
  if (!sede) throw new AccesoDenegado();
  const fecha = filtro.fecha || aLocal(new Date(), sede.timezone).fecha;
  if (!validarFecha(fecha)) throw new DatosInvalidos("Fecha inválida");
  const ventas = await db.venta.findMany({ where: { organizacionId, sedeId: filtro.sedeId, fecha: fechaDb(fecha) }, include: incluirVenta, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 500 });
  const nombre = await nombres(db, ventas.flatMap(v => [v.registradoPorId, v.anuladaPorId, ...v.cobros.map(c => c.registradoPorId)]));
  const vigentes = ventas.filter(v => v.estado !== "ANULADA");
  const cobros = resumirCobros(ventas.flatMap(v => v.cobros.map(c => ({ medio: MEDIO(c.medio), monto: centavos(c.monto) }))));
  const lista = ventas.map(v => presentar(v, nombre));
  return {
    fecha,
    puede: { registrar: puede("venta:registrar"), anular: puede("venta:anular") },
    ventas: lista,
    totales: {
      cantidad: vigentes.length,
      vendido: importe(vigentes.reduce((s, v) => s + centavos(v.total), 0n)),
      senasAplicadas: importe(vigentes.reduce((s, v) => s + centavos(v.anticipo), 0n)),
      cobrado: importe(cobros.total),
      efectivo: importe(cobros.efectivo),
      noEfectivo: importe(cobros.otros),
      porMedio: [...cobros.porMedio].map(([medio, total]) => ({ medio, total: importe(total) })),
      pendiente: importe(lista.filter(v => v.estado === "PENDIENTE").reduce((s, v) => s + centavos(v.saldo), 0n)),
    },
  };
}

/** Una venta con ítems, cobros y anulación, si está en el alcance de lectura del actor. */
export async function obtenerVenta(db: Database, actorId: string, organizacionId: string, ventaId: string) {
  exigirIds(ventaId);
  const v = await db.venta.findFirst({ where: { id: ventaId, organizacionId }, include: incluirVenta });
  if (!v) throw new AccesoDenegado();
  const { puede } = await exigirSedeVenta(db, actorId, organizacionId, v.sedeId, "venta:leer");
  const nombre = await nombres(db, [v.registradoPorId, v.anuladaPorId, ...v.cobros.map(c => c.registradoPorId)]);
  return {
    ...presentar(v, nombre),
    tieneProductos: v.items.some(i => i.tipo === "PRODUCTO"),
    puede: { cobrar: puede("venta:registrar") && v.estado === "PENDIENTE", anular: puede("venta:anular") && v.estado !== "ANULADA" },
    cajaAbierta: await hayCajaAbierta(db, actorId, organizacionId, v.sedeId).catch(e => { if (e instanceof AccesoDenegado) return false; throw e; }),
  };
}

/** Venta vigente (no anulada) de cada reserva indicada, para la agenda. Sin permiso de lectura, vacío. */
export async function ventasDeReservas(db: Database, actorId: string, organizacionId: string, sedeId: string, reservaIds: string[]) {
  exigirIds(...reservaIds);
  if (!reservaIds.length) return new Map<string, { ventaId: string; estado: string }>();
  try { await exigirSedeVenta(db, actorId, organizacionId, sedeId, "venta:leer"); }
  catch (e) { if (e instanceof AccesoDenegado) return new Map<string, { ventaId: string; estado: string }>(); throw e; }
  const ventas = await db.venta.findMany({ where: { organizacionId, sedeId, reservaId: { in: reservaIds }, estado: { not: "ANULADA" } }, select: { id: true, reservaId: true, estado: true } });
  return new Map(ventas.map(v => [v.reservaId!, { ventaId: v.id, estado: v.estado as string }]));
}
