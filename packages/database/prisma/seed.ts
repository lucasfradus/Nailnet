import "dotenv/config";
import { createDatabase } from "../src/client.ts";
import { cargarImagenesDemo, crearCatalogoDemo } from "./demo-catalogo.ts";
import { crearFixture } from "./fixture.ts";
if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Seed demo deshabilitado; requiere ALLOW_DEMO_SEED=true fuera de producción");
const db = createDatabase();
try {
  const id = "00000000-0000-4000-8000-000000000001";
  if (await db.organizacion.findUnique({ where: { id } })) console.info("Demo existente; no se modificó la organización.");
  else {
    await crearFixture(db, id);
    // Slug público para probar el portal: /api/public/v1/organizaciones/demo/sedes
    await db.organizacion.update({ where: { id }, data: { slug: "demo" } });
    console.info("Demo creada (slug «demo»). Usuarios sintéticos sin contraseña.");
  }
  // También se agrega a una demo creada antes del portal, siempre que no tenga catálogo propio.
  if (await db.servicio.count({ where: { organizacionId: id } })) console.info("La demo ya tiene catálogo; no se modificó.");
  else {
    await crearCatalogoDemo(db, id);
    console.info("Catálogo demo creado: servicios, profesionales, horarios y términos para el portal.");
  }
  const imagenes = await cargarImagenesDemo(db, id);
  if (imagenes) console.info(`Imágenes demo cargadas: ${imagenes}.`);
} finally { await db.$disconnect(); }
