import "dotenv/config";
import { aAjuste, precioConAjuste } from "@nailnet/domain/medios-pago";
import { createDatabase } from "../src/client.ts";
import { auditar } from "../src/access.ts";
import { guardarCategoria, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { redondeoSede } from "../src/medios-pago.ts";
import { guardarHabilidades } from "../src/profesionales.ts";
import { AJUSTE_EFECTIVO, LISTA_PRECIOS } from "./lista-precios-sicurella.ts";

/**
 * Reemplaza el catálogo de una organización por la lista de precios de Sicurella (lista-precios-sicurella.ts).
 *
 * 1. Vacía las categorías (todas, o con --solo-cubiertas solo las que la lista reemplaza: campo `antes`),
 *    sus servicios, precios por sede y habilitaciones de profesionales, y los turnos que incluyen alguno de
 *    esos servicios (con sus eventos, tokens, checkouts y pagos) y las esperas que los pedían. No toca
 *    clientes, usuarios, sedes, profesionales, horarios, recursos ni skills. Si alguna venta usa esos
 *    servicios o turnos, no hace nada: las ventas son de solo inserción y este script no las borra.
 * 2. Carga las categorías y servicios con su precio de lista, habilitados en todas las sedes activas.
 * 3. Habilita a cada profesional en las categorías nuevas que reemplazan a las que ya hacía, sin quitarle
 *    los servicios que conserva.
 * 4. Pone Efectivo y Transferencia en −20 % en cada sede (doc 32), que da exactamente la columna del PDF.
 *
 * Sin --confirmar solo muestra qué haría. Nunca corre con NAILNET_AMBIENTE=produccion.
 *   npx tsx prisma/cargar-lista-precios.ts [--org=<uuid>] [--actor=<email>] [--solo-cubiertas] [--confirmar]
 */
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const confirmar = process.argv.includes("--confirmar");
const soloCubiertas = process.argv.includes("--solo-cubiertas");
const O = arg("org") ?? "00000000-0000-4000-8000-000000000001";
const actorEmail = arg("actor") ?? `master-${O}@example.invalid`;
const SENA = { tipo: "PORCENTAJE" as const, valor: "30" };
const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

if (process.env.NAILNET_AMBIENTE === "produccion") throw new Error("No corre en producción: borra turnos.");

// La columna «Efectivo» del PDF tiene que salir del ajuste y el redondeo por defecto ($100 hacia abajo).
const ajuste = aAjuste(AJUSTE_EFECTIVO)!;
for (const c of LISTA_PRECIOS) for (const s of c.servicios) {
  const calculado = precioConAjuste(BigInt(s.lista) * 100n, ajuste, { paso: 100, sentido: "ABAJO" });
  if (calculado !== BigInt(s.efectivo) * 100n) throw new Error(`«${s.nombre}»: lista ${s.lista} con ${AJUSTE_EFECTIVO}% da ${calculado / 100n}, el PDF dice ${s.efectivo}`);
}
// Índice de la categoría nueva que reemplaza a cada nombre anterior.
const reemplazo = new Map(LISTA_PRECIOS.flatMap((c, i) => c.antes.map(a => [norm(a), i] as const)));

const db = createDatabase();
try {
  const org = await db.organizacion.findUniqueOrThrow({ where: { id: O }, select: { nombre: true } });
  const actor = await db.usuario.findUniqueOrThrow({ where: { email: actorEmail }, select: { id: true } });
  const sedes = await db.sede.findMany({ where: { organizacionId: O, activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });

  const categorias = (await db.categoriaServicio.findMany({ where: { organizacionId: O }, select: { id: true, nombre: true } }))
    .filter(c => !soloCubiertas || reemplazo.has(norm(c.nombre)));
  const servicios = await db.servicio.findMany({ where: { organizacionId: O, categoriaId: { in: categorias.map(c => c.id) } }, select: { id: true } });
  const S = servicios.map(s => s.id);
  const R = (await db.reserva.findMany({ where: { organizacionId: O, items: { some: { servicioId: { in: S } } } }, select: { id: true } })).map(r => r.id);
  // Esperas que pedían esos servicios o que se cerraron con uno de esos turnos (una espera cerrada exige su turno).
  const E = (await db.esperaRecepcion.findMany({ where: { organizacionId: O, ...(soloCubiertas ? { OR: [{ servicioIds: { hasSome: S } }, { reservaId: { in: R } }] } : {}) }, select: { id: true } })).map(e => e.id);
  const mixtas = await db.reserva.count({ where: { id: { in: R }, items: { some: { servicioId: { notIn: S } } } } });
  const ventas = await db.venta.count({ where: { organizacionId: O, reservaId: { in: R } } }) + await db.ventaItem.count({ where: { organizacionId: O, servicioId: { in: S } } });
  const nuevos = LISTA_PRECIOS.flatMap(c => c.servicios.map(s => s.nombre));
  const choques = (await db.servicio.findMany({ where: { organizacionId: O, id: { notIn: S } }, select: { nombre: true } })).filter(s => nuevos.some(n => norm(n) === norm(s.nombre)));
  const quedan = (await db.categoriaServicio.findMany({ where: { organizacionId: O, id: { notIn: categorias.map(c => c.id) } }, select: { nombre: true } })).map(c => c.nombre);

  console.info(`Organización: ${org.nombre} (${O}) · sedes activas: ${sedes.map(s => s.nombre).join(", ")}`);
  console.info(`Se borran: categorías ${categorias.map(c => c.nombre).join(", ") || "—"}; ${S.length} servicios, ${R.length} turnos (${mixtas} con servicios de otras categorías), ${E.length} esperas.`);
  if (quedan.length) console.info(`Quedan sin tocar: ${quedan.join(", ")}.`);
  console.info(`Se cargan: ${LISTA_PRECIOS.length} categorías y ${nuevos.length} servicios; Efectivo y Transferencia ${AJUSTE_EFECTIVO}%.`);
  if (ventas) throw new Error(`Hay ${ventas} ventas o ítems de venta que usan esos turnos o servicios (solo inserción): no se vacía.`);
  if (choques.length) throw new Error(`Servicios que quedan con el mismo nombre que uno nuevo: ${choques.map(c => c.nombre).join(", ")}.`);
  if (!confirmar) { console.info("Simulación: no se cambió nada. Agregá --confirmar para ejecutar."); process.exit(0); }

  // Categorías nuevas que corresponden a cada profesional, según las categorías borradas que ya hacía.
  const habilitaciones = await db.profesionalServicio.findMany({ where: { organizacionId: O, servicioId: { in: S } }, select: { profesionalId: true, servicio: { select: { categoria: { select: { nombre: true } } } } } });
  const categoriasDe = new Map<string, Set<number>>();
  for (const h of habilitaciones) {
    const i = reemplazo.get(norm(h.servicio.categoria.nombre));
    if (i !== undefined) (categoriasDe.get(h.profesionalId) ?? categoriasDe.set(h.profesionalId, new Set()).get(h.profesionalId)!).add(i);
  }

  // 1. Vaciar. Los eventos de turno son de solo inserción (trigger): se suspende solo dentro de esta
  // transacción para borrar los de estos turnos. ALTER TABLE es transaccional en PostgreSQL.
  await db.$transaction(async tx => {
    await tx.$executeRaw`ALTER TABLE "ReservaEvento" DISABLE TRIGGER "ReservaEvento_inmutable"`;
    await tx.claveIdempotencia.deleteMany({ where: { organizacionId: O, reservaId: { in: R } } });
    await tx.reserva.updateMany({ where: { organizacionId: O, OR: [{ id: { in: R } }, { reemplazaId: { in: R } }, { esperaId: { in: E } }] }, data: { reemplazaId: null, esperaId: null } });
    await tx.esperaRecepcion.deleteMany({ where: { id: { in: E } } });
    await tx.tokenReserva.deleteMany({ where: { reservaId: { in: R } } });
    await tx.pago.deleteMany({ where: { reservaId: { in: R } } });
    await tx.checkoutPago.deleteMany({ where: { reservaId: { in: R } } });
    await tx.reservaItemRecurso.deleteMany({ where: { item: { reservaId: { in: R } } } });
    await tx.reservaEvento.deleteMany({ where: { reservaId: { in: R } } });
    await tx.reservaItem.deleteMany({ where: { reservaId: { in: R } } });
    await tx.reserva.deleteMany({ where: { id: { in: R } } });
    await tx.$executeRaw`ALTER TABLE "ReservaEvento" ENABLE TRIGGER "ReservaEvento_inmutable"`;
    await tx.profesionalServicio.deleteMany({ where: { servicioId: { in: S } } });
    await tx.servicioSede.deleteMany({ where: { servicioId: { in: S } } });
    await tx.servicio.deleteMany({ where: { id: { in: S } } });
    await tx.categoriaServicio.deleteMany({ where: { id: { in: categorias.map(c => c.id) } } });
    await auditar(tx, O, actor.id, "catalogo.vaciar", "Organizacion", O, {
      categorias: categorias.map(c => c.nombre), servicios: S.length, turnos: R.length, esperas: E.length, motivo: "Carga de la lista de precios de Sicurella",
    });
  }, { timeout: 120_000 });
  console.info("Catálogo vaciado.");

  // 2. Cargar.
  const porCategoria: string[][] = [];
  for (const [i, c] of LISTA_PRECIOS.entries()) {
    const categoriaId = (await guardarCategoria(db, actor.id, O, { nombre: c.nombre, orden: i + 1, universo: c.universo }))!.id;
    porCategoria[i] = [];
    for (const s of c.servicios) {
      const servicioId = (await guardarServicio(db, actor.id, O, {
        categoriaId, nombre: s.nombre, descripcion: null, duracionMinutos: s.minutos, bufferAntesMinutos: 0, bufferDespuesMinutos: 0,
        sena: SENA, activo: true, skillIds: [], recursos: [], consentimientos: [],
      }))!.id;
      for (const sede of sedes) await guardarServicioSede(db, actor.id, O, sede.id, servicioId, { habilitado: true, precio: String(s.lista), duracionMinutos: null, sena: null, reservableOnline: true });
      porCategoria[i]!.push(servicioId);
    }
  }
  console.info(`Cargados ${nuevos.length} servicios en ${sedes.length} sedes.`);

  // 3. Profesionales: conservan sus skills y los servicios que no se borraron, y suman los nuevos.
  for (const [profesionalId, indices] of categoriasDe) {
    const skillIds = (await db.profesionalSkill.findMany({ where: { profesionalId }, select: { skillId: true } })).map(s => s.skillId);
    const conserva = (await db.profesionalServicio.findMany({ where: { profesionalId }, select: { servicioId: true } })).map(s => s.servicioId);
    await guardarHabilidades(db, actor.id, O, profesionalId, { skillIds, servicioIds: [...conserva, ...[...indices].flatMap(i => porCategoria[i]!)] });
  }
  console.info(`Profesionales habilitados: ${categoriasDe.size}.`);

  // 4. Medios de pago: Efectivo y Transferencia con el ajuste; el resto y el redondeo quedan como estaban.
  // Una sola actualización (guardarMediosPago, con su transacción de 5 s, no alcanza contra una base remota).
  await db.$transaction(async tx => {
    const n = await tx.medioPagoSede.updateMany({ where: { organizacionId: O, sedeId: { in: sedes.map(s => s.id) }, tipo: { in: ["EFECTIVO", "TRANSFERENCIA"] } }, data: { ajustePct: AJUSTE_EFECTIVO } });
    await auditar(tx, O, actor.id, "mediosPago.guardar", "Organizacion", O, { ajuste: AJUSTE_EFECTIVO, tipos: ["EFECTIVO", "TRANSFERENCIA"], medios: n.count, motivo: "Lista de precios de Sicurella" });
  }, { timeout: 60_000 });
  for (const sede of sedes) {
    const redondeo = await redondeoSede(db, O, sede.id);
    if (redondeo.paso !== 100 || redondeo.sentido !== "ABAJO") console.warn(`Ojo: ${sede.nombre} redondea a $${redondeo.paso} ${redondeo.sentido}; el efectivo puede no coincidir con el PDF.`);
  }
  console.info(`Medios de pago: Efectivo y Transferencia en ${AJUSTE_EFECTIVO}% en ${sedes.length} sedes. Listo.`);
} finally { await db.$disconnect(); }
