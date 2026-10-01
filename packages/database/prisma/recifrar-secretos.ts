import "dotenv/config";
import { createDatabase } from "../src/client.ts";
import { recifrarCredenciales } from "../src/configuracion.ts";

// Rotación: agregar la clave nueva a NAILNET_CLAVES_CIFRADO, apuntar NAILNET_CLAVE_ACTIVA a ella,
// desplegar y ejecutar este script. Recién después retirar la versión vieja del entorno.
const db = createDatabase();
try {
  console.info(`Credenciales recifradas: ${await recifrarCredenciales(db)}`);
} finally { await db.$disconnect(); }
