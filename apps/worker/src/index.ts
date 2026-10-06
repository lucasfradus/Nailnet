import { createServer } from "node:http";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { HealthResponse } from "@nailnet/contracts";
import { createDatabase } from "@nailnet/database";
import { encolarJob, estadoCola, procesarJobs, resumenError } from "@nailnet/database/jobs";
import { expirarRetenciones } from "@nailnet/database/reservas";
import { claveLimpieza, manejadores } from "./manejadores.ts";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un puerto válido");
const intervaloMs = Number(process.env.WORKER_INTERVALO_SEGUNDOS ?? 30) * 1000;
if (!Number.isFinite(intervaloMs) || intervaloMs < 5000) throw new Error("WORKER_INTERVALO_SEGUNDOS debe ser al menos 5");
const intervaloJobsMs = Number(process.env.WORKER_JOBS_SEGUNDOS ?? 5) * 1000;
if (!Number.isFinite(intervaloJobsMs) || intervaloJobsMs < 1000) throw new Error("WORKER_JOBS_SEGUNDOS debe ser al menos 1");

const db = process.env.DATABASE_URL ? createDatabase() : null;
// Identifica al dueño de cada lease; distinto en cada arranque para no confundir dos vidas del proceso.
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const tipos = db ? manejadores(db) : {};

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "worker" } satisfies HealthResponse));
    return;
  }
  // Readiness: base accesible y cola al día. «degradado» si hay trabajos atrasados o leases vencidos
  // (worker trabado o caído); los fallidos se informan pero esperan revisión, no degradan.
  if (request.method === "GET" && request.url === "/ready") {
    if (!db) { response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "sin_base" })); return; }
    try {
      const cola = await estadoCola(db);
      const status = cola.atrasados || cola.leasesVencidos ? "degradado" : "ok";
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ status, cola }));
    } catch (e) {
      console.error("Readiness sin base", resumenError(e));
      response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "sin_base" }));
    }
    return;
  }
  response.writeHead(404).end();
});

/** Ciclo que no se solapa consigo mismo: la próxima vuelta se programa cuando termina la actual. */
function ciclo(nombre: string, cadaMs: number, tarea: () => Promise<void>) {
  let corriendo: Promise<void> | null = null, temporizador: NodeJS.Timeout | undefined, detenido = false;
  const vuelta = () => {
    // Un fallo no detiene el worker: se reintenta en la próxima vuelta.
    corriendo = tarea().catch(e => console.error(`Error en ${nombre}`, resumenError(e))).finally(() => {
      corriendo = null;
      if (!detenido) temporizador = setTimeout(vuelta, cadaMs);
    });
  };
  vuelta();
  return async () => { detenido = true; clearTimeout(temporizador); await corriendo; };
}

const detener: (() => Promise<void>)[] = [];
server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  if (!db) { console.info("Worker sin DATABASE_URL: solo liveness, sin tareas."); return; }
  console.info(`Worker ${workerId}: tareas cada ${intervaloMs / 1000} s, trabajos cada ${intervaloJobsMs / 1000} s (${Object.keys(tipos).join(", ")}).`);
  // Tareas periódicas: el estado vive en PostgreSQL y las transiciones son condicionales, así que un
  // reinicio retoma lo pendiente y varias instancias no duplican efectos.
  detener.push(ciclo("tareas periódicas", intervaloMs, async () => {
    const r = await expirarRetenciones(db);
    if (r.expiradas) console.info(`Retenciones vencidas liberadas: ${r.expiradas}`);
    const ahora = new Date();
    await encolarJob(db, { tipo: "mantenimiento.limpieza", clave: claveLimpieza(ahora), payload: {} });
  }));
  detener.push(ciclo("trabajos", intervaloJobsMs, async () => {
    const r = await procesarJobs(db, { workerId, manejadores: tipos });
    if (r.tomados) console.info(`Trabajos: ${r.completados} completados, ${r.reintentos} a reintentar, ${r.fallidos} fallidos, ${r.perdidos} con lease perdido.`);
  }));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  // Deja de tomar trabajos y espera los que están corriendo; si el proceso muere antes, el lease vence
  // y otra instancia los retoma.
  server.close(); server.closeAllConnections();
  await Promise.all(detener.map(d => d()));
  await db?.$disconnect();
  process.exit(0);
});
