import { createServer } from "node:http";
import type { HealthResponse } from "@nailnet/contracts";
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un puerto válido");
const server = createServer((request, response) => {
  if (request.url !== "/health" || request.method !== "GET") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: "ok", service: "worker" } satisfies HealthResponse));
});
server.listen(port, process.env.HOST ?? "127.0.0.1", () => { console.info("Worker base iniciado. Procesamiento durable pendiente."); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); server.closeAllConnections(); });
