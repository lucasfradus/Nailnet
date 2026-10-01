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
  // Sin sesión, el inicio redirige al ingreso sin consultar la base.
  const home = await fetch("http://127.0.0.1:3300", { redirect: "manual" });
  assert.equal(home.status, 307);
  assert.equal(new URL(home.headers.get("location"), "http://127.0.0.1:3300").pathname, "/login");
  const login = await fetch("http://127.0.0.1:3300/login");
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("x-frame-options"), "DENY");
  assert.match(await login.text(), /Ingresar/);
  // API pública: validaciones que no necesitan base y CORS acotado al portal.
  const sinToken = await fetch("http://127.0.0.1:3300/api/public/v1/reservas/actual");
  assert.equal(sinToken.status, 404);
  assert.equal(sinToken.headers.get("cache-control"), "no-store");
  const sinClave = await fetch("http://127.0.0.1:3300/api/public/v1/reservas", { method: "POST", body: "{}" });
  assert.equal(sinClave.status, 422);
  assert.equal((await sinClave.json()).error.codigo, "INVALIDO");
  const ajeno = await fetch("http://127.0.0.1:3300/api/public/v1/reservas", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(ajeno.headers.get("access-control-allow-origin"), null);
  const missing = await fetch("http://127.0.0.1:3301/inexistente");
  assert.equal(missing.status, 404);
  console.info("Smoke OK: redirección al ingreso, login, API pública sin base y liveness de ambos procesos.");
} finally {
  for (const child of processes) child.kill();
}
