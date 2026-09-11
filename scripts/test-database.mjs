import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

// Cluster exclusivo de esta ejecución. Nunca reutiliza una base configurada.
const directory = await mkdtemp(join(tmpdir(), "nailnet-db-test-"));
const password = randomBytes(24).toString("hex");
const port = Number(process.env.TEST_POSTGRES_PORT ?? 55433);
const logs = [];
const pg = new EmbeddedPostgres({
  databaseDir: directory, user: "nailnet", password, port, persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: message => { logs.push(String(message)); },
});
const url = `postgresql://nailnet:${password}@localhost:${port}/nailnet_test`;
async function run(file, args, cwd = process.cwd(), extra = {}) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd, stdio: "inherit", env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, ...extra },
  });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Falló ${file}: ${code}`)));
  });
}
const root = process.cwd();
const database = join(root, "packages/database");
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("nailnet_test");
  await run(join(root, "node_modules/prisma/build/index.js"), ["migrate", "deploy"], database);
  // Reaplicar no debe duplicar migraciones.
  await run(join(root, "node_modules/prisma/build/index.js"), ["migrate", "deploy"], database);
  for (let i = 0; i < 2; i++) await run(join(root, "node_modules/tsx/dist/cli.mjs"), ["prisma/seed.ts"], database, { ALLOW_DEMO_SEED: "true" });
  await run(join(root, "node_modules/tsx/dist/cli.mjs"), ["--test", "tests/foundation.test.ts"], database);
} catch (error) {
  console.error(logs.slice(-5).join("\n"));
  throw error;
} finally {
  await pg.stop();
  // Windows puede tardar en liberar los archivos tras detener PostgreSQL.
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("nailnet-db-test-")) throw new Error("Directorio temporal inesperado");
  await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
