import "dotenv/config";
import { normalizarEmail } from "@nailnet/domain/credenciales";
import { createDatabase } from "../src/client.ts";
import { establecerPassword } from "../src/auth.ts";

// Uso: NAILNET_PASSWORD='...' npm run usuario:password -w @nailnet/database -- <email>
// La contraseña se lee de una variable de entorno para no dejarla en el historial ni en la lista de procesos.
const email = process.argv[2];
const password = process.env.NAILNET_PASSWORD;
if (!email || !password) throw new Error("Indicar el email como argumento y la contraseña en NAILNET_PASSWORD");
const db = createDatabase();
try {
  const usuario = await db.usuario.findUnique({ where: { email: normalizarEmail(email) }, select: { id: true } });
  if (!usuario) throw new Error("No existe un usuario con ese email");
  await establecerPassword(db, usuario.id, password);
  console.info("Contraseña actualizada. Se cerraron las sesiones abiertas del usuario.");
} finally { await db.$disconnect(); }
