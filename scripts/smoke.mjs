import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";

// Ejecutar desde la raíz, después de npm run build.
const processes = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/backoffice", "--port", "3300", "--hostname", "127.0.0.1"], { stdio: "inherit" }),
  spawn(process.execPath, ["apps/worker/dist/index.js"], { env: { ...process.env, PORT: "3301" }, stdio: "inherit" }),
];
try {
  for (const [port, path, service] of [[3300, "/api/health", "backoffice"], [3301, "/health", "worker"]]) {
    let response;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1000) }); break; }
      catch { await setTimeout(250); }
    }
    assert.ok(response?.ok, `${service} debe responder`);
    assert.deepEqual(await response.json(), { status: "ok", service });
  }
  const home = await fetch("http://127.0.0.1:3300");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /NailNet/);
  const missing = await fetch("http://127.0.0.1:3301/inexistente");
  assert.equal(missing.status, 404);
  console.info("Smoke OK: inicio del backoffice y liveness de ambos procesos.");
} finally {
  for (const child of processes) child.kill();
}
