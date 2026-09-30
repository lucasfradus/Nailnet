import { createDatabase, type Database } from "@nailnet/database";

// Una instancia por proceso; en desarrollo sobrevive a la recarga de módulos.
// Se crea al primer uso para que las rutas sin base (health, login vacío) no exijan DATABASE_URL.
const global = globalThis as typeof globalThis & { nailnetDb?: Database };
export function db(): Database {
  return global.nailnetDb ??= createDatabase();
}
