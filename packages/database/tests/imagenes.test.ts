import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { AccesoDenegado } from "@nailnet/domain";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { crearCategoria, guardarImagenServicio, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { imagenPublica, procesarImagen, rutaImagen } from "../src/imagenes.ts";
import { crearProfesional, guardarFotoProfesional, guardarHabilidades } from "../src/profesionales.ts";
import { profesionalesPublicos, serviciosPublicos } from "../src/publico.ts";
import { crearFixture } from "../prisma/fixture.ts";

/** JPEG sintético con EXIF (incluido un GPS) para comprobar que no llega a la imagen publicada. */
async function jpegConExif(ancho: number, alto: number) {
  return new Uint8Array(await sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 200, g: 120, b: 110 } } })
    .withExif({ IFD0: { Copyright: "Cámara de prueba", Make: "Marca" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "34/1 36/1 0/1" } })
    .jpeg().toBuffer());
}

test("imágenes de servicios y profesionales", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id;
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const base = { categoriaId: cat.id, duracionMinutos: 60, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, activo: true, skillIds: [], recursos: [], consentimientos: [] };
    const semi = (await guardarServicio(db, M, O, { ...base, nombre: "Semi", descripcion: "Esmaltado que dura hasta tres semanas.", sena: { tipo: "PORCENTAJE", valor: "30" } }))!.id;
    await guardarServicioSede(db, M, O, a.centro.id, semi, { habilitado: true, precio: "18000", duracionMinutos: null, sena: null, reservableOnline: true });
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana", apellido: "Pérez" })).id;
    const sol = (await crearProfesional(db, M, O, a.sur.id, { nombre: "Sol" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [], servicioIds: [semi] });

    await t.test("procesamiento: WebP, tamaño acotado, retrato cuadrado y sin metadatos", async () => {
      const original = await jpegConExif(3000, 2000);
      assert.ok((await sharp(original).metadata()).exif, "el original trae EXIF");
      const servicio = await procesarImagen(original, "SERVICIO");
      const m = await sharp(servicio.datos).metadata();
      assert.deepEqual([m.format, m.width, m.height, servicio.ancho, servicio.alto], ["webp", 1200, 800, 1200, 800]);
      assert.equal(m.exif, undefined, "sin EXIF ni GPS");
      const retrato = await procesarImagen(original, "RETRATO");
      assert.deepEqual([retrato.ancho, retrato.alto], [600, 600]);
      const chica = await procesarImagen(await jpegConExif(400, 300), "SERVICIO");
      assert.deepEqual([chica.ancho, chica.alto], [400, 300], "no se agranda");
      assert.match(servicio.sha256, /^[0-9a-f]{64}$/);
    });

    await t.test("rechaza archivos que no son imágenes admitidas o son demasiado grandes", async () => {
      await assert.rejects(procesarImagen(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "SERVICIO"), DatosInvalidos);
      await assert.rejects(procesarImagen(new TextEncoder().encode("no es una imagen"), "SERVICIO"), DatosInvalidos);
      const gif = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).gif().toBuffer());
      await assert.rejects(procesarImagen(gif, "SERVICIO"), /Formato no admitido/);
      await assert.rejects(procesarImagen(new Uint8Array(8 * 1024 * 1024 + 1), "SERVICIO"), /8 MB/);
      await assert.rejects(procesarImagen(new Uint8Array(), "SERVICIO"), DatosInvalidos);
    });

    await t.test("permisos: imagen de servicio solo el master; foto según alcance del profesional", async () => {
      const jpg = await jpegConExif(800, 600);
      await assert.rejects(guardarImagenServicio(db, a.admin.id, O, semi, jpg), AccesoDenegado);
      await assert.rejects(guardarImagenServicio(db, a.recepcion.id, O, semi, jpg), AccesoDenegado);
      await assert.rejects(guardarFotoProfesional(db, a.recepcion.id, O, ana, jpg), AccesoDenegado, "recepción no administra profesionales");
      await assert.rejects(guardarFotoProfesional(db, a.admin.id, O, sol, jpg), AccesoDenegado, "Sol trabaja en una sede fuera del alcance del admin");
      const otra = await crearFixture(db);
      await assert.rejects(guardarImagenServicio(db, otra.master.id, otra.org.id, semi, jpg), AccesoDenegado, "otra organización");
      await guardarFotoProfesional(db, a.admin.id, O, ana, jpg);
      assert.equal(await db.imagen.count({ where: { organizacionId: O } }), 1);
    });

    await t.test("reemplazar y quitar borran la imagen anterior; solo se sirve lo que está en uso", async () => {
      await guardarImagenServicio(db, M, O, semi, await jpegConExif(800, 600));
      const primera = (await db.servicio.findUniqueOrThrow({ where: { id: semi } })).imagenId!;
      assert.equal((await imagenPublica(db, primera)).mime, "image/webp");
      await guardarImagenServicio(db, M, O, semi, await jpegConExif(900, 600));
      const segunda = (await db.servicio.findUniqueOrThrow({ where: { id: semi } })).imagenId!;
      assert.notEqual(primera, segunda);
      assert.equal(await db.imagen.count({ where: { id: primera } }), 0, "la anterior se borró");
      await assert.rejects(imagenPublica(db, primera), AccesoDenegado);
      await assert.rejects(imagenPublica(db, "no-es-uuid"), AccesoDenegado);
      // Una imagen huérfana (p. ej. de un error a mitad de camino) no se publica.
      const huerfana = await db.imagen.create({ data: { organizacionId: O, mime: "image/webp", ancho: 1, alto: 1, datos: new Uint8Array([1]), sha256: "0".repeat(64) } });
      await assert.rejects(imagenPublica(db, huerfana.id), AccesoDenegado);
      await guardarImagenServicio(db, M, O, semi, null);
      assert.equal((await db.servicio.findUniqueOrThrow({ where: { id: semi } })).imagenId, null);
      assert.equal(await db.imagen.count({ where: { id: segunda } }), 0);
      await guardarImagenServicio(db, M, O, semi, await jpegConExif(800, 600));
    });

    await t.test("contrato público con descripción, imagen y foto; organización inactiva no sirve imágenes", async () => {
      const [s] = await serviciosPublicos(db, a.centro.id);
      const imagenId = (await db.servicio.findUniqueOrThrow({ where: { id: semi } })).imagenId!;
      assert.deepEqual([s!.descripcion, s!.imagenUrl], ["Esmaltado que dura hasta tres semanas.", rutaImagen(imagenId)]);
      const [p] = await profesionalesPublicos(db, a.centro.id, semi);
      assert.match(p!.fotoUrl!, /^\/api\/public\/v1\/imagenes\/[0-9a-f-]{36}$/);
      await db.organizacion.update({ where: { id: O }, data: { activo: false } });
      await assert.rejects(imagenPublica(db, imagenId), AccesoDenegado);
      await db.organizacion.update({ where: { id: O }, data: { activo: true } });
    });
  } finally {
    await db.$disconnect();
  }
});
