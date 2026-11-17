// D22 · Medios de pago de la sede (doc 32, etapa 1). Cada sede nace con los seis medios estándar en 0%
// (trigger de la migración 202611160010). Leer: `sede:leer`. Configurar medios y redondeo:
// `sede:administrar` (master, franquiciado y administración de sede; confirmado el 2026-11-16).
import { AccesoDenegado, cubreSede, tienePermiso, type Permiso } from "@nailnet/domain";
import { MAX_MEDIOS_SEDE, ajusteDecimal, aAjuste, nombreRepetido, redondeoDe, validarMedio, validarRedondeo, type Redondeo } from "@nailnet/domain/medios-pago";
import type { MedioCobro, MedioDisponible } from "@nailnet/domain/ventas";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, asignacionesActor, auditar, exigirIds, mapaSedes } from "./access.ts";

type Cliente = Database | Prisma.TransactionClient;
const esUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const NOMBRE_REPETIDO = "Ya hay un medio con ese nombre en la sede";

async function exigirSobreSede(db: Cliente, actorId: string, organizacionId: string, sedeId: string, permiso: Permiso) {
  exigirIds(sedeId);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  const en = (p: Permiso) => actor.some(a => tienePermiso(a, p) && cubreSede(a, sedeId, franquiciadoDe));
  if (!en(permiso)) throw new AccesoDenegado();
  return { puedeEditar: en("sede:administrar") };
}

/** Redondeo efectivo de la sede (sin configuración: $100 hacia abajo). Sin actor: para uso interno. */
export async function redondeoSede(db: Cliente, organizacionId: string, sedeId: string): Promise<Redondeo> {
  const c = await db.configuracionSede.findFirst({ where: { organizacionId, sedeId }, select: { redondeoPaso: true, redondeoSentido: true } });
  return redondeoDe(c?.redondeoPaso, c?.redondeoSentido);
}

/** Medios habilitados de la sede, en orden, para validar cobros. Sin actor: quien llama ya autorizó. */
export async function mediosHabilitados(db: Cliente, organizacionId: string, sedeId: string): Promise<MedioDisponible[]> {
  const filas = await db.medioPagoSede.findMany({ where: { organizacionId, sedeId, habilitado: true }, orderBy: [{ orden: "asc" }, { createdAt: "asc" }], select: { id: true, tipo: true, nombre: true, ajustePct: true } });
  return filas.map(f => ({ id: f.id, tipo: f.tipo as MedioCobro, nombre: f.nombre, ajuste: aAjuste(f.ajustePct.toFixed(2))! }));
}

/** Medios de la sede (todos, en orden) con su ajuste, el redondeo y si el actor puede editarlos. */
export async function listarMediosPago(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  const { puedeEditar } = await exigirSobreSede(db, actorId, organizacionId, sedeId, "sede:leer");
  const [filas, redondeo, usados] = await Promise.all([
    db.medioPagoSede.findMany({ where: { organizacionId, sedeId }, orderBy: [{ orden: "asc" }, { createdAt: "asc" }] }),
    redondeoSede(db, organizacionId, sedeId),
    db.cobroVenta.groupBy({ by: ["medioPagoId"], where: { organizacionId, sedeId, medioPagoId: { not: null } }, _count: true }),
  ]);
  const conCobros = new Set(usados.map(u => u.medioPagoId));
  return {
    puedeEditar,
    redondeo,
    medios: filas.map(f => ({
      id: f.id, nombre: f.nombre, tipo: f.tipo as MedioCobro, habilitado: f.habilitado, orden: f.orden,
      ajuste: aAjuste(f.ajustePct.toFixed(2))!, conCobros: conCobros.has(f.id),
    })),
  };
}

export type MedioEdicion = { id: string; nombre: string; ajuste: string; habilitado: boolean; orden: number };

/**
 * Guarda de una vez los medios de la sede (nombre, ajuste, habilitado y orden) y el redondeo. Todos los
 * medios de la sede tienen que venir, y al menos uno habilitado: sin ninguno no se podría cobrar.
 */
export async function guardarMediosPago(db: Database, actorId: string, organizacionId: string, sedeId: string, entrada: { medios: MedioEdicion[]; redondeo: { paso: string; sentido: string } }) {
  exigirIds(sedeId, ...entrada.medios.map(m => m.id));
  const r = validarRedondeo(entrada.redondeo.paso, entrada.redondeo.sentido);
  if ("error" in r) throw new DatosInvalidos(r.error);
  const validados = entrada.medios.map(m => {
    const v = validarMedio({ nombre: m.nombre, ajuste: m.ajuste, habilitado: m.habilitado }, false);
    if ("error" in v) throw new DatosInvalidos(v.error);
    if (!Number.isInteger(m.orden) || m.orden < 0 || m.orden > 999) throw new DatosInvalidos("Orden inválido");
    return { id: m.id, orden: m.orden, ...v.medio };
  });
  const repetido = nombreRepetido(validados.map(m => m.nombre));
  if (repetido) throw new DatosInvalidos(`El nombre «${repetido}» está repetido`);
  if (!validados.some(m => m.habilitado)) throw new DatosInvalidos("Dejá al menos un medio habilitado: sin ninguno no se puede cobrar");
  try {
    await db.$transaction(async tx => {
      const { puedeEditar } = await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:leer");
      if (!puedeEditar) throw new AccesoDenegado();
      // Lock de los medios de la sede: dos guardados simultáneos se serializan.
      const actuales = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM "MedioPagoSede" WHERE "organizacionId" = ${organizacionId}::uuid AND "sedeId" = ${sedeId}::uuid FOR UPDATE`;
      const ids = new Set(actuales.map(a => a.id));
      if (validados.length !== ids.size || validados.some(m => !ids.has(m.id))) throw new DatosInvalidos("La lista de medios cambió mientras editabas: recargá la página");
      // Orden final 0..n−1 según el orden pedido (empates: el de la pantalla). Nombres en dos pasos para
      // que intercambiar dos nombres no choque con el índice único.
      const ordenados = validados.map((m, i) => ({ ...m, i })).sort((a, b) => a.orden - b.orden || a.i - b.i);
      for (const [orden, m] of ordenados.entries()) await tx.medioPagoSede.update({ where: { id: m.id }, data: { nombre: `~${m.id}`, orden } });
      for (const m of ordenados) await tx.medioPagoSede.update({ where: { id: m.id }, data: { nombre: m.nombre, ajustePct: ajusteDecimal(m.ajuste), habilitado: m.habilitado } });
      await tx.configuracionSede.upsert({
        where: { sedeId },
        create: { organizacionId, sedeId, redondeoPaso: r.redondeo.paso, redondeoSentido: r.redondeo.sentido },
        update: { redondeoPaso: r.redondeo.paso, redondeoSentido: r.redondeo.sentido },
      });
      await auditar(tx, organizacionId, actorId, "mediosPago.guardar", "Sede", sedeId, {
        redondeo: r.redondeo, medios: ordenados.map(m => ({ id: m.id, nombre: m.nombre, ajuste: ajusteDecimal(m.ajuste), habilitado: m.habilitado })),
      });
    });
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos(NOMBRE_REPETIDO);
    throw e;
  }
}

/** Suma un medio a la sede (por ejemplo «Cuenta DNI»), habilitado y al final de la lista. */
export async function crearMedioPago(db: Database, actorId: string, organizacionId: string, sedeId: string, entrada: { nombre: string; tipo: string; ajuste: string }) {
  const v = validarMedio({ ...entrada, habilitado: true }, true);
  if ("error" in v) throw new DatosInvalidos(v.error);
  try {
    return await db.$transaction(async tx => {
      const { puedeEditar } = await exigirSobreSede(tx, actorId, organizacionId, sedeId, "sede:leer");
      if (!puedeEditar) throw new AccesoDenegado();
      const actuales = await tx.$queryRaw<{ orden: number }[]>`SELECT orden FROM "MedioPagoSede" WHERE "organizacionId" = ${organizacionId}::uuid AND "sedeId" = ${sedeId}::uuid FOR UPDATE`;
      if (actuales.length >= MAX_MEDIOS_SEDE) throw new DatosInvalidos(`Hasta ${MAX_MEDIOS_SEDE} medios por sede: deshabilitá o renombrá uno que no uses`);
      const orden = actuales.reduce((m, a) => Math.max(m, a.orden + 1), 0);
      const creado = await tx.medioPagoSede.create({
        data: { organizacionId, sedeId, nombre: v.medio.nombre, tipo: v.medio.tipo!, ajustePct: ajusteDecimal(v.medio.ajuste), orden },
        select: { id: true },
      });
      await auditar(tx, organizacionId, actorId, "mediosPago.crear", "MedioPagoSede", creado.id, { sedeId, nombre: v.medio.nombre, tipo: v.medio.tipo!, ajuste: ajusteDecimal(v.medio.ajuste) });
      return creado;
    });
  } catch (e) {
    if (esUnico(e)) throw new DatosInvalidos(NOMBRE_REPETIDO);
    throw e;
  }
}
