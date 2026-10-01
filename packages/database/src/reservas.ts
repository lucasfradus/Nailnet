import { AccesoDenegado } from "@nailnet/domain";
import { asignarEn } from "@nailnet/domain/disponibilidad";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, exigirIds, sedesConPermiso } from "./access.ts";
import { configuracionEfectiva } from "./configuracion.ts";
import { ConfiguracionIncompleta, cargarConsulta, type Pedido } from "./disponibilidad.ts";

type Tx = Prisma.TransactionClient;

/** El horario pedido ya no está libre (lo tomó otra persona o cambió la agenda). HTTP 409. */
export class TurnoNoDisponible extends Error {
  constructor() { super("Ese horario ya no está disponible. Elegí otro."); this.name = "TurnoNoDisponible"; }
}

const ordenar = (ids: Iterable<string>) => [...new Set(ids)].sort();

/**
 * Protocolo de exclusión (doc 02 · disponibilidad): bloquear FOR UPDATE las filas de los
 * profesionales candidatos y de los recursos de los tipos requeridos, siempre ordenados por ID
 * (primero profesionales, luego recursos) para evitar ciclos. Jornadas, ausencias y otras
 * retenciones toman el mismo lock de fila del profesional. No basta con bloquear reservas: en el
 * horario disputado puede no existir ninguna fila todavía.
 */
async function bloquear(tx: Tx, profesionales: string[], recursos: string[]) {
  if (profesionales.length) await tx.$queryRaw`SELECT id FROM "Profesional" WHERE id IN (${Prisma.join(profesionales.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  if (recursos.length) await tx.$queryRaw`SELECT id FROM "Recurso" WHERE id IN (${Prisma.join(recursos.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}

const esDeadlock = (e: unknown) => {
  const texto = String((e as { message?: string })?.message ?? "") + String((e as { meta?: unknown })?.meta ? JSON.stringify((e as { meta: unknown }).meta) : "");
  return /40P01|deadlock/i.test(texto);
};

export type Retencion = { reservaId: string; expiraEn: Date; items: { servicioId: string; profesionalId: string; inicio: Date; fin: Date; recursoIds: string[]; precio: string; sena: string | null }[] };

/**
 * Retiene un turno (uno o varios ítems encadenados) como PENDIENTE_PAGO hasta `expiraEn`.
 * Todo o nada: si un ítem ya no entra, no se crea nada. La duración de la retención es
 * configuración pendiente (D4); confirmar, cobrar o tomar turnos firmes en recepción llega con R01/R04.
 */
export async function retenerTurno(db: Database, actorId: string | null, organizacionId: string, pedido: Pedido & { inicio: Date; clienteId?: string | null }, ahora = new Date()): Promise<Retencion> {
  if (actorId) {
    exigirIds(pedido.sedeId);
    const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
    if (!ids.has(pedido.sedeId)) throw new AccesoDenegado();
  } else if (pedido.canal !== "ONLINE") throw new AccesoDenegado();
  exigirIds(pedido.clienteId);
  if (Number.isNaN(pedido.inicio.getTime())) throw new DatosInvalidos("Horario inválido");

  // Primera pasada sin locks: solo para saber qué filas bloquear.
  const previa = await cargarConsulta(db, organizacionId, pedido, ahora);
  const profesionales = ordenar(previa.consulta.items.flatMap(i => i.candidatos));
  const recursos = ordenar(previa.consulta.recursos.map(r => r.id));

  for (let intento = 1; ; intento++) {
    try {
      return await db.$transaction(async tx => {
        await bloquear(tx, profesionales, recursos);
        const config = await configuracionEfectiva(tx, organizacionId, pedido.sedeId);
        if (config.retencionMinutos.valor === null) throw new ConfiguracionIncompleta(["retención de turno pendiente (D4)"]);
        if (pedido.clienteId && !await tx.cliente.count({ where: { id: pedido.clienteId, organizacionId } })) throw new AccesoDenegado();

        // Limpieza oportunista: retenciones vencidas de estos profesionales pasan a EXPIRADA.
        // El motor ya las ignora; esto solo mantiene el estado coherente sin depender del worker.
        await tx.reserva.updateMany({
          where: { organizacionId, estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { lte: ahora }, items: { some: { profesionalId: { in: profesionales } } } },
          data: { estado: "EXPIRADA" },
        });

        // Revalidación bajo lock con exactamente las mismas reglas que la consulta pública.
        const { consulta, efectivos } = await cargarConsulta(tx, organizacionId, pedido, ahora, { profesionales: new Set(profesionales), recursos: new Set(recursos) });
        const turno = asignarEn(consulta, pedido.inicio.getTime());
        if (!turno) throw new TurnoNoDisponible();

        const expiraEn = new Date(ahora.getTime() + config.retencionMinutos.valor * 60_000);
        const reserva = await tx.reserva.create({ data: { organizacionId, sedeId: pedido.sedeId, clienteId: pedido.clienteId ?? null, canal: pedido.canal, estado: "PENDIENTE_PAGO", expiraEn, creadoPor: actorId }, select: { id: true } });
        const items: Retencion["items"] = [];
        for (const [posicion, it] of turno.items.entries()) {
          const e = efectivos.get(it.servicioId)!;
          const item = await tx.reservaItem.create({ data: {
            organizacionId, reservaId: reserva.id, posicion, servicioId: it.servicioId, profesionalId: it.profesionalId,
            inicio: new Date(it.inicio), fin: new Date(it.fin), ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta),
            // Snapshots: cambios posteriores de precio, duración o seña no alteran este turno.
            duracionMinutos: e.duracionMinutos, bufferAntesMinutos: e.bufferAntesMinutos, bufferDespuesMinutos: e.bufferDespuesMinutos,
            precio: e.precio!, sena: e.sena,
          }, select: { id: true } });
          if (it.recursoIds.length) await tx.reservaItemRecurso.createMany({ data: it.recursoIds.map(recursoId => ({ organizacionId, itemId: item.id, recursoId, ocupaDesde: new Date(it.ocupaDesde), ocupaHasta: new Date(it.ocupaHasta) })) });
          items.push({ servicioId: it.servicioId, profesionalId: it.profesionalId, inicio: new Date(it.inicio), fin: new Date(it.fin), recursoIds: it.recursoIds, precio: e.precio!, sena: e.sena });
        }
        return { reservaId: reserva.id, expiraEn, items };
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (e) {
      // Ante un deadlock (no debería ocurrir por el orden estable) se reintenta de forma acotada.
      if (intento < 3 && esDeadlock(e)) continue;
      throw e;
    }
  }
}
