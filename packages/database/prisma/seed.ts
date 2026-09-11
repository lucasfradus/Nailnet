import "dotenv/config";
import { createDatabase } from "../src/client.ts";
import { crearFixture } from "./fixture.ts";
if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Seed demo deshabilitado; requiere ALLOW_DEMO_SEED=true fuera de producción");
const db = createDatabase();
try {
  const id = "00000000-0000-4000-8000-000000000001";
  if (await db.organizacion.findUnique({ where: { id } })) console.info("Demo existente; no se modificó.");
  else { await crearFixture(db, id); console.info("Demo creada. Usuarios sintéticos sin contraseña."); }
} finally { await db.$disconnect(); }
