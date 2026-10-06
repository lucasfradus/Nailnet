import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/client.ts";
import { DatosInvalidos } from "../src/access.ts";
import { ErrorPermanente, completarJob, encolarJob, esperaReintento, estadoCola, fallarJob, procesarJobs, purgarJobsCompletados, tomarJobs } from "../src/jobs.ts";
import { limpiarDatosPublicos } from "../src/publico.ts";
import { crearFixture } from "../prisma/fixture.ts";

// Los archivos de prueba corren en paralelo sobre la misma base: cada caso usa tipos propios para no
// tomar trabajos de otro.
const tipoUnico = () => `prueba.t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const T0 = new Date("2099-01-01T12:00:00Z");
const mas = (ms: number) => new Date(T0.getTime() + ms);

test("cola durable de trabajos (F04)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    await t.test("encolar deduplica por clave y valida tipo, clave y tamaño", async () => {
      const tipo = tipoUnico(), clave = `k-${randomUUID()}`;
      const a = await encolarJob(db, { tipo, clave, payload: { reservaId: "x" } });
      const b = await encolarJob(db, { tipo, clave, payload: { otro: true } });
      assert.deepEqual([a.creado, b.creado, a.id === b.id], [true, false, true]);
      assert.equal(await db.job.count({ where: { clave } }), 1);
      await assert.rejects(encolarJob(db, { tipo: "SinPunto", clave: "c", payload: {} }), DatosInvalidos);
      await assert.rejects(encolarJob(db, { tipo, clave: "", payload: {} }), DatosInvalidos);
      await assert.rejects(encolarJob(db, { tipo, clave: "grande", payload: { texto: "x".repeat(20_000) } }), DatosInvalidos);
    });

    await t.test("outbox: si la transacción se revierte no queda trabajo; si confirma, sí", async () => {
      const tipo = tipoUnico(), clave = `k-${randomUUID()}`;
      await assert.rejects(db.$transaction(async tx => { await encolarJob(tx, { tipo, clave, payload: {} }); throw new Error("rollback"); }));
      assert.equal(await db.job.count({ where: { clave } }), 0);
      await db.$transaction(tx => encolarJob(tx, { tipo, clave, payload: {} }));
      assert.equal(await db.job.count({ where: { clave } }), 1);
    });

    await t.test("dos workers en paralelo no toman el mismo trabajo", async () => {
      const tipo = tipoUnico();
      for (let i = 0; i < 12; i++) await encolarJob(db, { tipo, clave: `${tipo}:${i}`, payload: { i }, disponibleDesde: T0 });
      const [a, b, c] = await Promise.all(["a", "b", "c"].map(w => tomarJobs(db, { workerId: w, tipos: [tipo], limite: 5, ahora: mas(1) })));
      const ids = [...a!, ...b!, ...c!].map(j => j.id);
      assert.equal(ids.length, 12);
      assert.equal(new Set(ids).size, 12, "sin repetidos");
      assert.equal(await db.job.count({ where: { tipo, estado: "EN_PROCESO", intentos: 1 } }), 12);
    });

    await t.test("respeta el próximo intento y solo toma tipos conocidos", async () => {
      const tipo = tipoUnico(), otro = tipoUnico();
      await encolarJob(db, { tipo, clave: `${tipo}:futuro`, payload: {}, disponibleDesde: mas(60_000) });
      await encolarJob(db, { tipo: otro, clave: `${otro}:1`, payload: {}, disponibleDesde: T0 });
      assert.equal((await tomarJobs(db, { workerId: "w", tipos: [tipo], ahora: mas(1) })).length, 0, "todavía no");
      assert.equal((await tomarJobs(db, { workerId: "w", tipos: [tipo], ahora: mas(60_000) })).length, 1);
      assert.equal((await db.job.findUniqueOrThrow({ where: { clave: `${otro}:1` } })).intentos, 0, "tipo desconocido: no gasta intentos");
    });

    await t.test("reinicio: un lease vencido se retoma y el worker anterior ya no puede cerrarlo", async () => {
      const tipo = tipoUnico();
      await encolarJob(db, { tipo, clave: `${tipo}:1`, payload: {}, disponibleDesde: T0 });
      const [viejo] = await tomarJobs(db, { workerId: "caido", tipos: [tipo], leaseMs: 60_000, ahora: mas(1) });
      assert.equal((await tomarJobs(db, { workerId: "nuevo", tipos: [tipo], ahora: mas(30_000) })).length, 0, "lease vigente");
      const [nuevo] = await tomarJobs(db, { workerId: "nuevo", tipos: [tipo], ahora: mas(61_000) });
      assert.equal(nuevo!.intentos, 2);
      assert.equal(await completarJob(db, viejo!, "caido"), false, "el dueño anterior perdió el lease");
      assert.equal(await fallarJob(db, viejo!, "caido", new Error("tarde")), "PERDIDO");
      assert.equal(await completarJob(db, nuevo!, "nuevo", { ok: true }, mas(62_000)), true);
      const fila = await db.job.findUniqueOrThrow({ where: { id: nuevo!.id } });
      assert.deepEqual([fila.estado, fila.leaseDe, fila.resultado], ["COMPLETADO", null, { ok: true }]);
    });

    await t.test("fallas: reintento con espera creciente, permanente y agotado van a FALLIDO", async () => {
      assert.ok(esperaReintento(1, 0.5) === 30_000 && esperaReintento(2, 0.5) === 60_000 && esperaReintento(20, 0.5) === 3_600_000);
      assert.ok(esperaReintento(1, 0) >= 24_000 && esperaReintento(1, 1) <= 36_000, "±20 %");
      const tipo = tipoUnico();
      await encolarJob(db, { tipo, clave: `${tipo}:r`, payload: {}, maxIntentos: 2, disponibleDesde: T0 });
      let [j] = await tomarJobs(db, { workerId: "w", tipos: [tipo], ahora: mas(1) });
      assert.equal(await fallarJob(db, j!, "w", new Error("timeout del proveedor"), mas(1)), "REINTENTO");
      const fila = await db.job.findUniqueOrThrow({ where: { id: j!.id } });
      assert.equal(fila.estado, "PENDIENTE");
      assert.ok(fila.proximoIntento.getTime() >= mas(24_000).getTime(), "espera al menos ~30 s");
      assert.equal(fila.ultimoError, "Error: timeout del proveedor");
      [j] = await tomarJobs(db, { workerId: "w", tipos: [tipo], ahora: mas(3_600_000) });
      assert.equal(await fallarJob(db, j!, "w", new Error("otra vez"), mas(3_600_000)), "FALLIDO", "agotó 2 intentos");
      await encolarJob(db, { tipo, clave: `${tipo}:p`, payload: {}, disponibleDesde: T0 });
      [j] = await tomarJobs(db, { workerId: "w", tipos: [tipo], ahora: mas(3_600_000) });
      assert.equal(await fallarJob(db, j!, "w", new ErrorPermanente("reserva inexistente")), "FALLIDO", "sin reintentos");
    });

    await t.test("procesarJobs: ejecuta, reintenta, corta lo que se cuelga y no reejecuta agotados", async () => {
      const ok = tipoUnico(), falla = tipoUnico(), colgado = tipoUnico(), caido = tipoUnico();
      await encolarJob(db, { tipo: ok, clave: `${ok}:1`, payload: { n: 2 }, disponibleDesde: T0 });
      await encolarJob(db, { tipo: falla, clave: `${falla}:1`, payload: {}, disponibleDesde: T0 });
      await encolarJob(db, { tipo: colgado, clave: `${colgado}:1`, payload: {}, disponibleDesde: T0 });
      let abortado = false;
      const r = await procesarJobs(db, {
        workerId: "w", leaseMs: 500, ahora: () => mas(1),
        manejadores: {
          [ok]: async job => ({ doble: (job.payload as { n: number }).n * 2 }),
          [falla]: async () => { throw new Error("proveedor caído"); },
          [colgado]: (_, { signal }) => new Promise(resolve => { signal.addEventListener("abort", () => { abortado = true; resolve(); }); }),
        },
      });
      assert.deepEqual(r, { tomados: 3, completados: 1, reintentos: 2, fallidos: 0, perdidos: 0 });
      assert.ok(abortado, "el manejador colgado recibió la señal de abortar");
      assert.deepEqual((await db.job.findUniqueOrThrow({ where: { clave: `${ok}:1` } })).resultado, { doble: 4 });
      assert.match((await db.job.findUniqueOrThrow({ where: { clave: `${colgado}:1` } })).ultimoError!, /Superó/);
      // Un trabajo que tumba al proceso en cada intento: al vencer el último lease no se vuelve a ejecutar.
      await encolarJob(db, { tipo: caido, clave: `${caido}:1`, payload: {}, maxIntentos: 1, disponibleDesde: T0 });
      await tomarJobs(db, { workerId: "muerto", tipos: [caido], leaseMs: 1000, ahora: mas(1) });
      let ejecutado = false;
      const r2 = await procesarJobs(db, { workerId: "w2", ahora: () => mas(5000), manejadores: { [caido]: async () => { ejecutado = true; } } });
      assert.deepEqual([r2.fallidos, ejecutado], [1, false]);
      assert.equal((await db.job.findUniqueOrThrow({ where: { clave: `${caido}:1` } })).estado, "FALLIDO");
    });

    await t.test("estado de la cola y purga de completados viejos", async () => {
      const tipo = tipoUnico();
      const ahora = new Date();
      const base = await estadoCola(db, ahora);
      await encolarJob(db, { tipo, clave: `${tipo}:atrasado`, payload: {}, disponibleDesde: new Date(ahora.getTime() - 10 * 60_000) });
      const despues = await estadoCola(db, ahora);
      assert.equal(despues.atrasados, base.atrasados + 1);
      const viejo = await db.job.create({ data: { tipo, clave: `${tipo}:viejo`, payload: {}, estado: "COMPLETADO", completadoEn: new Date(ahora.getTime() - 31 * 86_400_000) } });
      const reciente = await db.job.create({ data: { tipo, clave: `${tipo}:reciente`, payload: {}, estado: "COMPLETADO", completadoEn: ahora } });
      assert.ok(await purgarJobsCompletados(db, ahora) >= 1);
      assert.equal(await db.job.count({ where: { id: { in: [viejo.id, reciente.id] } } }), 1, "solo el viejo");
      await db.job.deleteMany({ where: { tipo } });
    });

    await t.test("limpieza de datos públicos vencidos", async () => {
      const a = await crearFixture(db);
      const ahora = new Date(), hace = (ms: number) => new Date(ahora.getTime() - ms);
      const base = { organizacionId: a.org.id, ambito: "prueba", hashSolicitud: "0".repeat(64), estado: "COMPLETADA" };
      const vencida = await db.claveIdempotencia.create({ data: { ...base, clave: randomUUID(), expiraEn: hace(1000) } });
      const vigente = await db.claveIdempotencia.create({ data: { ...base, clave: randomUUID(), expiraEn: new Date(ahora.getTime() + 3_600_000) } });
      const clave = "e".repeat(64);
      const viejo = await db.eventoPublico.create({ data: { tipo: "prueba", clave, createdAt: hace(2 * 86_400_000) } });
      const nuevo = await db.eventoPublico.create({ data: { tipo: "prueba", clave, createdAt: hace(60_000) } });
      const r = await limpiarDatosPublicos(db, ahora);
      assert.ok(r.claves >= 1 && r.eventos >= 1);
      assert.deepEqual([await db.claveIdempotencia.count({ where: { id: { in: [vencida.id, vigente.id] } } }), await db.eventoPublico.count({ where: { id: { in: [viejo.id, nuevo.id] } } })], [1, 1]);
      const otra = await limpiarDatosPublicos(db, ahora);
      assert.equal(await db.claveIdempotencia.count({ where: { id: vigente.id } }), 1, "idempotente");
      assert.ok(otra.claves >= 0);
    });
  } finally {
    await db.$disconnect();
  }
});
