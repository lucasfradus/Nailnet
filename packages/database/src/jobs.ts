import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos } from "./access.ts";

type Tx = Prisma.TransactionClient;

/**
 * Cola durable en PostgreSQL (F04). El estado vive en la tabla Job: un reinicio del worker no pierde
 * nada y varias instancias se reparten el trabajo sin duplicarlo.
 *
 * - Encolar dentro de la transacción que origina el trabajo (outbox): si la transacción se revierte,
 *   no queda trabajo; si confirma, el trabajo existe aunque el proceso se caiga enseguida.
 * - La clave única deduplica: el mismo evento encolado dos veces es un solo trabajo.
 * - Tomar usa FOR UPDATE SKIP LOCKED y un lease. Si el worker muere, al vencer el lease otro lo retoma.
 * - Los manejadores deben ser idempotentes: un trabajo puede ejecutarse más de una vez (lease vencido
 *   a mitad de camino). Lo garantizado es que no se pierde, no que corre exactamente una vez.
 */
export const POLITICA_JOBS = {
  leaseMs: 5 * 60_000,
  esperaBaseMs: 30_000,
  esperaMaximaMs: 60 * 60_000,
  payloadMaximo: 16_000,
  diasCompletados: 30,
} as const;

/** Error que no se arregla reintentando (datos inválidos, recurso inexistente): va directo a revisión. */
export class ErrorPermanente extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "ErrorPermanente"; }
}

const TIPO = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export type DatosJob = {
  tipo: string; clave: string; payload: Prisma.InputJsonValue;
  organizacionId?: string | null; maxIntentos?: number; disponibleDesde?: Date;
};

/** Encola sin duplicar. `creado` es false si ya existía un trabajo con esa clave (en cualquier estado). */
export async function encolarJob(db: Database | Tx, datos: DatosJob): Promise<{ id: string; creado: boolean }> {
  if (!TIPO.test(datos.tipo)) throw new DatosInvalidos("Tipo de trabajo inválido: «area.accion» en minúsculas");
  if (!datos.clave || datos.clave.length > 200) throw new DatosInvalidos("Clave de trabajo inválida");
  if (JSON.stringify(datos.payload).length > POLITICA_JOBS.payloadMaximo) throw new DatosInvalidos("Payload demasiado grande: guardar referencias, no documentos");
  const { count } = await db.job.createMany({
    data: [{ tipo: datos.tipo, clave: datos.clave, payload: datos.payload, organizacionId: datos.organizacionId ?? null, maxIntentos: datos.maxIntentos ?? 8, proximoIntento: datos.disponibleDesde ?? new Date() }],
    skipDuplicates: true,
  });
  const { id } = await db.job.findUniqueOrThrow({ where: { clave: datos.clave }, select: { id: true } });
  return { id, creado: count === 1 };
}

export type JobTomado = { id: string; tipo: string; clave: string; payload: Prisma.JsonValue; organizacionId: string | null; intentos: number; maxIntentos: number };

/**
 * Toma hasta `limite` trabajos listos (pendientes con próximo intento cumplido, o en proceso con lease
 * vencido) de los tipos indicados. Solo toma tipos que este worker sabe manejar: un tipo desconocido
 * no gasta intentos. Cada toma cuenta como intento.
 */
export async function tomarJobs(db: Database, opciones: { workerId: string; tipos: string[]; limite?: number; leaseMs?: number; ahora?: Date }): Promise<JobTomado[]> {
  const ahora = opciones.ahora ?? new Date();
  if (!opciones.tipos.length) return [];
  const lease = new Date(ahora.getTime() + (opciones.leaseMs ?? POLITICA_JOBS.leaseMs));
  return db.$queryRaw<JobTomado[]>`
    UPDATE "Job" j SET "estado" = 'EN_PROCESO', "leaseHasta" = ${lease}, "leaseDe" = ${opciones.workerId}, "intentos" = j."intentos" + 1, "updatedAt" = ${ahora}
    FROM (
      SELECT "id" FROM "Job"
      WHERE "tipo" = ANY(${opciones.tipos}::text[])
        AND (("estado" = 'PENDIENTE' AND "proximoIntento" <= ${ahora}) OR ("estado" = 'EN_PROCESO' AND "leaseHasta" <= ${ahora}))
      ORDER BY "proximoIntento"
      LIMIT ${opciones.limite ?? 10}
      FOR UPDATE SKIP LOCKED
    ) c
    WHERE j."id" = c."id"
    RETURNING j."id", j."tipo", j."clave", j."payload", j."organizacionId", j."intentos", j."maxIntentos"`;
}

/** Condición de dueño: solo quien tiene el lease vigente de esta toma puede cerrar el trabajo. */
const delLease = (job: JobTomado, workerId: string) => ({ id: job.id, estado: "EN_PROCESO" as const, leaseDe: workerId, intentos: job.intentos });

/** false si el lease se perdió (otro worker lo retomó): el resultado de esta ejecución se descarta. */
export async function completarJob(db: Database, job: JobTomado, workerId: string, resultado: Prisma.InputJsonValue | null = null, ahora = new Date()) {
  const { count } = await db.job.updateMany({
    where: delLease(job, workerId),
    data: { estado: "COMPLETADO", completadoEn: ahora, leaseHasta: null, leaseDe: null, ultimoError: null, resultado: resultado ?? Prisma.JsonNull },
  });
  return count === 1;
}

/** Espera creciente: 30 s, 1 min, 2 min… hasta 1 h, con ±20 % para que los reintentos no se agolpen. */
export function esperaReintento(intento: number, azar = Math.random()) {
  const base = Math.min(POLITICA_JOBS.esperaBaseMs * 2 ** Math.max(0, intento - 1), POLITICA_JOBS.esperaMaximaMs);
  return Math.round(base * (0.8 + 0.4 * azar));
}

/** Resumen del error para guardar: mensaje acotado, sin stack ni payload. */
export const resumenError = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 1000);

/** Reprograma con espera creciente, o marca FALLIDO si es permanente o agotó los intentos. */
export async function fallarJob(db: Database, job: JobTomado, workerId: string, error: unknown, ahora = new Date()) {
  const agotado = error instanceof ErrorPermanente || job.intentos >= job.maxIntentos;
  const { count } = await db.job.updateMany({
    where: delLease(job, workerId),
    data: agotado
      ? { estado: "FALLIDO", leaseHasta: null, leaseDe: null, ultimoError: resumenError(error) }
      : { estado: "PENDIENTE", leaseHasta: null, leaseDe: null, ultimoError: resumenError(error), proximoIntento: new Date(ahora.getTime() + esperaReintento(job.intentos)) },
  });
  return count === 1 ? (agotado ? "FALLIDO" : "REINTENTO") : "PERDIDO";
}

export type Manejador = (job: JobTomado, contexto: { signal: AbortSignal }) => Promise<Prisma.InputJsonValue | void>;
export type ResultadoVuelta = { tomados: number; completados: number; reintentos: number; fallidos: number; perdidos: number };

/**
 * Una vuelta del worker: toma, ejecuta en orden y cierra cada trabajo. Un manejador que tarda más que
 * el 80 % del lease se da por fallido (se reintenta) y recibe la señal de abortar, para no seguir
 * corriendo en paralelo con quien lo retome.
 */
export async function procesarJobs(db: Database, opciones: { workerId: string; manejadores: Record<string, Manejador>; limite?: number; leaseMs?: number; ahora?: () => Date }): Promise<ResultadoVuelta> {
  const reloj = opciones.ahora ?? (() => new Date());
  const leaseMs = opciones.leaseMs ?? POLITICA_JOBS.leaseMs;
  const jobs = await tomarJobs(db, { workerId: opciones.workerId, tipos: Object.keys(opciones.manejadores), limite: opciones.limite, leaseMs, ahora: reloj() });
  const r: ResultadoVuelta = { tomados: jobs.length, completados: 0, reintentos: 0, fallidos: 0, perdidos: 0 };
  for (const job of jobs) {
    // Ya agotó los intentos en tomas anteriores que nunca cerraron (p. ej. el proceso se cayó cada vez).
    if (job.intentos > job.maxIntentos) {
      const res = await fallarJob(db, job, opciones.workerId, new ErrorPermanente("Lease vencido sin resultado en todos los intentos"), reloj());
      if (res === "PERDIDO") r.perdidos++; else r.fallidos++;
      continue;
    }
    const control = new AbortController();
    let temporizador: NodeJS.Timeout | undefined;
    try {
      const excedido = new Error(`Superó ${Math.round(leaseMs * 0.8 / 1000)} s`);
      // Primero se rechaza y después se avisa: un manejador que responde al abort terminando "bien"
      // no debe ganarle la carrera al límite y quedar como completado.
      const limite = new Promise<never>((_, rechazar) => { temporizador = setTimeout(() => { rechazar(excedido); control.abort(); }, leaseMs * 0.8); });
      const resultado = await Promise.race([opciones.manejadores[job.tipo]!(job, { signal: control.signal }), limite]);
      if (control.signal.aborted) throw excedido;
      if (await completarJob(db, job, opciones.workerId, resultado ?? null, reloj())) r.completados++; else r.perdidos++;
    } catch (e) {
      const res = await fallarJob(db, job, opciones.workerId, e, reloj());
      if (res === "FALLIDO") r.fallidos++; else if (res === "REINTENTO") r.reintentos++; else r.perdidos++;
    } finally { clearTimeout(temporizador); }
  }
  return r;
}

/** Estado de la cola para el health check del worker y alertas: atrasados, leases vencidos y fallidos. */
export async function estadoCola(db: Database, ahora = new Date(), toleranciaMs = 5 * 60_000) {
  const limite = new Date(ahora.getTime() - toleranciaMs);
  const [pendientes, atrasados, leasesVencidos, fallidos] = await Promise.all([
    db.job.count({ where: { estado: "PENDIENTE" } }),
    db.job.count({ where: { estado: "PENDIENTE", proximoIntento: { lte: limite } } }),
    db.job.count({ where: { estado: "EN_PROCESO", leaseHasta: { lte: limite } } }),
    db.job.count({ where: { estado: "FALLIDO" } }),
  ]);
  return { pendientes, atrasados, leasesVencidos, fallidos };
}

/** Borra trabajos completados viejos; los fallidos se conservan hasta que alguien los revise. */
export async function purgarJobsCompletados(db: Database, ahora = new Date()) {
  const { count } = await db.job.deleteMany({ where: { estado: "COMPLETADO", completadoEn: { lt: new Date(ahora.getTime() - POLITICA_JOBS.diasCompletados * 86_400_000) } } });
  return count;
}
