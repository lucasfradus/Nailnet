import { readFile } from "node:fs/promises";
import type { Database } from "../src/client.ts";
import { crearCategoria, crearSkill, guardarImagenServicio, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { publicarConsentimiento } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearProfesional, guardarFotoProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos, vincularSede } from "../src/profesionales.ts";

/**
 * Catálogo sintético para recorrer el portal en local: servicios con precio y seña en Centro y Norte,
 * profesionales con jornadas y términos publicados. Sur queda sin catálogo online a propósito.
 * Los valores de grilla, horizonte y anticipación son de demo, no política (D17 y D18 pendientes).
 */
export async function crearCatalogoDemo(db: Database, organizacionId: string) {
  const O = organizacionId;
  const M = (await db.usuario.findUniqueOrThrow({ where: { email: `master-${O}@example.invalid` } })).id;
  const sedes = await db.sede.findMany({ where: { organizacionId: O }, select: { id: true, nombre: true } });
  const sede = (nombre: string) => sedes.find(s => s.nombre === nombre)!.id;
  const [centro, norte] = [sede("Centro"), sede("Norte")];

  await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 30, horizonteReservaDias: 14, anticipacionMinimaMinutos: 120 });
  await publicarConsentimiento(db, M, O, { tipo: "TERMINOS", clave: "terminos-reserva", titulo: "Términos de la reserva online", texto: "Texto de demostración. Al reservar aceptás que el turno queda retenido mientras se acredita la seña y que, si no se acredita a tiempo, se libera. La seña se descuenta del precio del servicio. Las condiciones de cancelación y devolución se informarán antes del lanzamiento." });

  const manos = (await crearCategoria(db, M, O, "Manos", 1))!.id, pies = (await crearCategoria(db, M, O, "Pies", 2))!.id;
  const gel = (await crearSkill(db, M, O, "Gel"))!.id;
  const base = { bufferAntesMinutos: 0, bufferDespuesMinutos: 0, activo: true, consentimientos: [], recursos: [] };
  const servicio = async (categoriaId: string, nombre: string, duracionMinutos: number, sena: { tipo: "PORCENTAJE" | "FIJA"; valor: string } | null, skillIds: string[] = []) =>
    (await guardarServicio(db, M, O, { ...base, categoriaId, nombre, descripcion: DESCRIPCIONES[nombre], duracionMinutos, sena, skillIds }))!.id;
  const semi = await servicio(manos, "Esmaltado semipermanente", 60, { tipo: "PORCENTAJE", valor: "30" });
  const kapping = await servicio(manos, "Kapping gel", 90, { tipo: "PORCENTAJE", valor: "30" }, [gel]);
  // Sin seña definida: no se ofrece online (D3), sirve para comprobar que el portal no lo muestra.
  const retiro = await servicio(manos, "Retiro de semipermanente", 30, null);
  const belleza = await servicio(pies, "Belleza de pies", 60, { tipo: "FIJA", valor: "5000" });
  const precios: [string, string][] = [[semi, "18000"], [kapping, "26000"], [retiro, "6000"], [belleza, "20000"]];
  for (const s of [centro, norte]) for (const [id, precio] of precios) await guardarServicioSede(db, M, O, s, id, { habilitado: true, precio, duracionMinutos: null, sena: null, reservableOnline: true });

  const horario = semanaDesdeTextos({ 1: "09:00-20:00", 2: "09:00-20:00", 3: "09:00-20:00", 4: "09:00-20:00", 5: "09:00-20:00", 6: "09:00-14:00" });
  for (const s of [centro, norte]) await guardarHorarioSede(db, M, O, s, horario);
  const ana = (await crearProfesional(db, M, O, centro, { nombre: "Ana", apellido: "Pérez" })).id;
  const bea = (await crearProfesional(db, M, O, centro, { nombre: "Bea", apellido: "Ruiz" })).id;
  const carla = (await crearProfesional(db, M, O, norte, { nombre: "Carla", apellido: "Gómez" })).id;
  await vincularSede(db, M, O, ana, norte, true);
  await guardarHabilidades(db, M, O, ana, { skillIds: [gel], servicioIds: [semi, kapping, retiro, belleza] });
  await guardarHabilidades(db, M, O, bea, { skillIds: [], servicioIds: [semi, retiro, belleza] });
  await guardarHabilidades(db, M, O, carla, { skillIds: [gel], servicioIds: [semi, kapping, retiro] });
  // Ana trabaja en dos sedes en días distintos.
  await guardarHorarioProfesional(db, M, O, ana, centro, semanaDesdeTextos({ 1: "09:00-17:00", 2: "09:00-17:00", 3: "09:00-17:00" }));
  await guardarHorarioProfesional(db, M, O, ana, norte, semanaDesdeTextos({ 4: "10:00-19:00", 5: "10:00-19:00", 6: "09:00-14:00" }));
  await guardarHorarioProfesional(db, M, O, bea, centro, semanaDesdeTextos({ 1: "12:00-20:00", 2: "12:00-20:00", 3: "12:00-20:00", 4: "09:00-20:00", 5: "09:00-20:00", 6: "09:00-14:00" }));
  await guardarHorarioProfesional(db, M, O, carla, norte, semanaDesdeTextos({ 1: "09:00-18:00", 2: "09:00-18:00", 3: "09:00-18:00", 4: "09:00-13:00", 5: "09:00-13:00" }));
}

const DESCRIPCIONES: Record<string, string> = {
  "Esmaltado semipermanente": "Color con brillo que dura hasta tres semanas. Incluye limado y cuidado de cutículas.",
  "Kapping gel": "Capa de gel sobre la uña natural para darle fuerza y que crezca sin quebrarse.",
  "Retiro de semipermanente": "Retiro cuidadoso del esmaltado sin dañar la uña natural.",
  "Belleza de pies": "Pedicuría estética con exfoliación, hidratación y esmaltado tradicional.",
};
const IMAGENES_SERVICIOS: Record<string, string> = { "Esmaltado semipermanente": "semipermanente.jpg", "Kapping gel": "kapping.jpg", "Retiro de semipermanente": "retiro.jpg", "Belleza de pies": "pies.jpg" };
const FOTOS_PROFESIONALES: Record<string, string> = { Ana: "ana.jpg", Bea: "bea.jpg", Carla: "carla.jpg" };

/**
 * Fotos de stock (demo-imagenes/CREDITOS.md) para los servicios y profesionales demo que todavía no
 * tienen imagen. Pasan por el mismo procesamiento que una subida desde el backoffice.
 */
export async function cargarImagenesDemo(db: Database, organizacionId: string) {
  const O = organizacionId;
  const M = (await db.usuario.findUniqueOrThrow({ where: { email: `master-${O}@example.invalid` } })).id;
  const archivo = (nombre: string) => readFile(new URL(`./demo-imagenes/${nombre}`, import.meta.url)).then(b => new Uint8Array(b));
  let cargadas = 0;
  // Demos creadas antes de que hubiera descripciones: se completan solo las vacías.
  for (const [nombre, descripcion] of Object.entries(DESCRIPCIONES)) await db.servicio.updateMany({ where: { organizacionId: O, nombre, descripcion: null }, data: { descripcion } });
  for (const s of await db.servicio.findMany({ where: { organizacionId: O, imagenId: null, nombre: { in: Object.keys(IMAGENES_SERVICIOS) } } })) {
    await guardarImagenServicio(db, M, O, s.id, await archivo(IMAGENES_SERVICIOS[s.nombre]!)); cargadas++;
  }
  for (const p of await db.profesional.findMany({ where: { organizacionId: O, fotoId: null, nombre: { in: Object.keys(FOTOS_PROFESIONALES) } } })) {
    await guardarFotoProfesional(db, M, O, p.id, await archivo(FOTOS_PROFESIONALES[p.nombre]!)); cargadas++;
  }
  return cargadas;
}
