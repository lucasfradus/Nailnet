import { randomUUID } from "node:crypto";
import type { Database } from "../src/client.ts";
import type { Prisma } from "../generated/client/client.ts";

// Siempre sintéticos; usuarios sin contraseña, no utilizables para iniciar sesión.
export async function crearFixture(db: Database, organizacionId = randomUUID()) {
  return db.$transaction(tx => insertarFixture(tx, organizacionId));
}
async function insertarFixture(db: Prisma.TransactionClient, organizacionId: string) {
  const org = await db.organizacion.create({ data: { id: organizacionId, nombre: "NailNet · Demo" } });
  const franA = await db.franquiciado.create({ data: { organizacionId: org.id, nombre: "Franquiciado Demo A" } });
  const franB = await db.franquiciado.create({ data: { organizacionId: org.id, nombre: "Franquiciado Demo B" } });
  const sedes = [];
  for (const [nombre, franquiciadoId] of [["Centro", franA.id], ["Norte", franA.id], ["Sur", franB.id]]) {
    sedes.push(await db.sede.create({ data: { organizacionId: org.id, franquiciadoId: franquiciadoId!, nombre: nombre! } }));
  }
  const usuarios = [];
  for (const nombre of ["master", "franquiciado", "admin", "recepcion", "profesional", "sin-rol"]) {
    usuarios.push(await db.usuario.create({ data: { email: `${nombre}-${org.id}@example.invalid`, nombre, membresias: { create: { organizacionId: org.id } } } }));
  }
  const [master, franquiciado, admin, recepcion, profesional, sinRol] = usuarios;
  const [centro, norte, sur] = sedes;
  await db.asignacionRol.createMany({ data: [
    { organizacionId: org.id, usuarioId: master!.id, rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION" },
    { organizacionId: org.id, usuarioId: franquiciado!.id, rol: "FRANQUICIADO", alcance: "FRANQUICIADO", franquiciadoId: franA.id },
    { organizacionId: org.id, usuarioId: admin!.id, rol: "ADMIN_SEDE", alcance: "SEDE", sedeId: centro!.id },
    ...[centro!, norte!].map(s => ({ organizacionId: org.id, usuarioId: recepcion!.id, rol: "RECEPCIONISTA" as const, alcance: "SEDE" as const, sedeId: s.id })),
    { organizacionId: org.id, usuarioId: profesional!.id, rol: "PROFESIONAL", alcance: "PROPIO" },
  ] });
  const emisor = await db.emisorFiscal.create({ data: { organizacionId: org.id, cuit: "20000000001", razonSocial: "Emisor sintético, no habilitado para emitir" } });
  await db.configuracionFiscalSede.createMany({ data: [centro!, norte!].map((s, i) => ({ organizacionId: org.id, sedeId: s.id, emisorFiscalId: emisor.id, ambiente: "PRUEBA", puntoVenta: i + 1 })) });
  return { org, franA, franB, centro: centro!, norte: norte!, sur: sur!, master: master!, franquiciado: franquiciado!, admin: admin!, recepcion: recepcion!, profesional: profesional!, sinRol: sinRol!, emisor };
}
