import { createServer } from "node:http";
import type { HealthResponse } from "@nailnet/contracts";
import { createDatabase } from "@nailnet/database";
import { expirarRetenciones } from "@nailnet/database/reservas";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un puerto válido");
const intervaloMs = Number(process.env.WORKER_INTERVALO_SEGUNDOS ?? 30) * 1000;
if (!Number.isFinite(intervaloMs) || intervaloMs < 5000) throw new Error("WORKER_INTERVALO_SEGUNDOS debe ser al menos 5");

const server = createServer((request, response) => {
  if (request.url !== "/health" || request.method !== "GET") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: "ok", service: "worker" } satisfies HealthResponse));
});

// Tareas periódicas. El estado vive en PostgreSQL: un reinicio retoma lo pendiente en la siguiente
// vuelta y las transiciones son condicionales, así que varias instancias no duplican efectos.
const db = process.env.DATABASE_URL ? createDatabase() : null;
let corriendo: Promise<void> | null = null;
let temporizador: NodeJS.Timeout | undefined;
async function vuelta() {
  try {
    const r = await expirarRetenciones(db!);
    if (r.expiradas) console.info(`Retenciones vencidas liberadas: ${r.expiradas}`);
  } catch (e) {
    // Un fallo no detiene el worker: se reintenta en la próxima vuelta.
    console.error("Error en tarea periódica", e instanceof Error ? e.message : e);
  }
}
function programar() {
  temporizador = setTimeout(() => { corriendo = vuelta().finally(() => { corriendo = null; programar(); }); }, intervaloMs);
}

server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  if (db) { console.info(`Worker iniciado: tareas cada ${intervaloMs / 1000} s.`); corriendo = vuelta().finally(() => { corriendo = null; programar(); }); }
  else console.info("Worker sin DATABASE_URL: solo liveness, sin tareas.");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  clearTimeout(temporizador);
  server.close(); server.closeAllConnections();
  await corriendo;
  await db?.$disconnect();
  process.exit(0);
});
