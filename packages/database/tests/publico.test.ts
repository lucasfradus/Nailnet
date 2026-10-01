import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccesoDenegado } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { createDatabase } from "../src/client.ts";
import { crearCategoria, crearSkill, guardarServicio, guardarServicioSede } from "../src/catalogo.ts";
import { crearCliente, publicarConsentimiento } from "../src/clientes.ts";
import { actualizarConfiguracionOrganizacion } from "../src/configuracion.ts";
import { crearProfesional, guardarHabilidades, guardarHorarioProfesional, guardarHorarioSede, semanaDesdeTextos } from "../src/profesionales.ts";
import { ConflictoIdempotencia, LimiteExcedido, POLITICA_PUBLICA, consultarReservaPublica, crearReservaPublica, disponibilidadPublica, profesionalesPublicos, sedesPublicas, serviciosPublicos } from "../src/publico.ts";
import { crearFixture } from "../prisma/fixture.ts";
import type { ReservaPublicaRespuesta } from "@nailnet/contracts/publico";

const TZ = "America/Argentina/Buenos_Aires";
const FECHA = "2099-10-13";
const en = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return aUtc(FECHA, h! * 60 + m!, TZ); };
const ahora = new Date("2099-10-01T12:00:00Z");
const clave = () => `k${crypto.randomUUID().replace(/-/g, "")}`;

test("contrato público del portal (R05)", async (t) => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL es obligatoria");
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  try {
    const a = await crearFixture(db);
    const M = a.master.id, O = a.org.id;
    const slug = `demo-${O.slice(0, 8)}`;
    await db.organizacion.update({ where: { id: O }, data: { slug } });
    const cat = (await crearCategoria(db, M, O, "Nails"))!;
    const skill = (await crearSkill(db, M, O, "Semi"))!;
    const base = { categoriaId: cat.id, bufferAntesMinutos: 0, bufferDespuesMinutos: 0, activo: true, consentimientos: [], recursos: [] };
    const semi = (await guardarServicio(db, M, O, { ...base, nombre: "Semi", duracionMinutos: 50, sena: { tipo: "PORCENTAJE", valor: "30" }, skillIds: [skill.id] }))!.id;
    const sinSena = (await guardarServicio(db, M, O, { ...base, nombre: "Consulta", duracionMinutos: 20, sena: null, skillIds: [] }))!.id;
    for (const s of [semi, sinSena]) await guardarServicioSede(db, M, O, a.centro.id, s, { habilitado: true, precio: "30000", duracionMinutos: null, sena: null, reservableOnline: true });
    await guardarHorarioSede(db, M, O, a.centro.id, semanaDesdeTextos({ 2: "09:00-20:00" }));
    const ana = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Ana", apellido: "Pérez" })).id;
    const bea = (await crearProfesional(db, M, O, a.centro.id, { nombre: "Bea" })).id;
    await guardarHabilidades(db, M, O, ana, { skillIds: [skill.id], servicioIds: [semi, sinSena] });
    await guardarHabilidades(db, M, O, bea, { skillIds: [], servicioIds: [semi, sinSena] });
    for (const p of [ana, bea]) await guardarHorarioProfesional(db, M, O, p, a.centro.id, semanaDesdeTextos({ 2: "09:00-18:00" }));
    await actualizarConfiguracionOrganizacion(db, M, O, { pasoGrillaMinutos: 60, horizonteReservaDias: 30, anticipacionMinimaMinutos: 60 });
    await publicarConsentimiento(db, M, O, { tipo: "TERMINOS", clave: "terminos", titulo: "Términos", texto: "Acepto los términos y condiciones del servicio de turnos." });
    const solicitud = (extra: object = {}, cliente: object = {}) => ({ sedeId: a.centro.id, fecha: FECHA, inicio: en("10:00").toISOString(), items: [{ servicioId: semi }], cliente: { nombre: "Lucía", apellido: "Gómez", email: `lucia-${O}@example.invalid`, telefono: "1155551234", ...cliente }, aceptaTerminos: true as const, ...extra });
    const crear = (sol = solicitud(), k = clave(), ip: string | null = "198.51.100.7") => crearReservaPublica(db, { solicitud: sol, claveIdempotencia: k, ip }, ahora);

    await t.test("catálogo público: sedes por slug, solo servicios online y profesionales aptos", async () => {
      assert.deepEqual((await sedesPublicas(db, slug)).map(s => s.nombre), ["Centro", "Norte", "Sur"]);
      await assert.rejects(sedesPublicas(db, "no-existe"), AccesoDenegado);
      await assert.rejects(sedesPublicas(db, "Con Mayúsculas"), AccesoDenegado);
      assert.deepEqual((await serviciosPublicos(db, a.centro.id)).map(s => [s.nombre, s.sena]), [["Semi", "9000.00"]], "sin seña definida no se publica (D3)");
      assert.deepEqual((await profesionalesPublicos(db, a.centro.id, semi)).map(p => p.nombre), ["Ana P."], "Bea no tiene la skill");
      const turnos = await disponibilidadPublica(db, a.centro.id, FECHA, [{ servicioId: semi }], ahora);
      assert.ok(turnos.length > 0);
      assert.equal(JSON.stringify(turnos).includes("recursoIds"), false);
      await db.organizacion.update({ where: { id: O }, data: { activo: false } });
      await assert.rejects(serviciosPublicos(db, a.centro.id), AccesoDenegado);
      await db.organizacion.update({ where: { id: O }, data: { activo: true } });
    });

    let primera: ReservaPublicaRespuesta;
    await t.test("reserva invitada: cliente nuevo, pendiente de seña, términos aceptados y token de consulta", async () => {
      const r = await crear();
      assert.equal(r.codigo, 201);
      primera = r.cuerpo as ReservaPublicaRespuesta;
      assert.deepEqual([primera.estado, primera.sena], ["PENDIENTE_PAGO", "9000.00"]);
      assert.equal(new Date(primera.expiraEn!).getTime() - ahora.getTime(), 15 * 60_000, "D4");
      const reserva = await db.reserva.findUniqueOrThrow({ where: { id: primera.reservaId }, include: { cliente: true } });
      assert.deepEqual([reserva.canal, reserva.cliente?.email], ["ONLINE", `lucia-${O}@example.invalid`]);
      assert.equal(await db.clienteConsentimiento.count({ where: { clienteId: reserva.clienteId!, canal: "PORTAL", accion: "ACEPTA" } }), 1);
      assert.equal(await db.tokenReserva.count({ where: { tokenHash: primera.token } }), 0, "solo se guarda el hash");
      const estado = await consultarReservaPublica(db, primera.token, ahora);
      assert.deepEqual([estado.estado, estado.sede, estado.items[0]!.servicio, estado.items[0]!.profesional], ["PENDIENTE_PAGO", "Centro", "Semi", "Ana"]);
      assert.equal(JSON.stringify(estado).includes("1155551234"), false, "sin datos de contacto en la consulta");
      assert.equal((await consultarReservaPublica(db, primera.token, new Date(ahora.getTime() + 16 * 60_000))).estado, "EXPIRADA");
      await assert.rejects(consultarReservaPublica(db, "x".repeat(43)), AccesoDenegado);
      await assert.rejects(consultarReservaPublica(db, null), AccesoDenegado);
    });

    await t.test("idempotencia: mismo contenido → mismo resultado y token rotado; otro contenido → conflicto", async () => {
      const k = clave();
      const r1 = await crear(solicitud({ inicio: en("11:00").toISOString(), items: [{ servicioId: semi }] }, { email: `otra-${O}@example.invalid` }), k);
      const r2 = await crear(solicitud({ inicio: en("11:00").toISOString(), items: [{ servicioId: semi }] }, { email: `otra-${O}@example.invalid` }), k);
      const c1 = r1.cuerpo as ReservaPublicaRespuesta, c2 = r2.cuerpo as ReservaPublicaRespuesta;
      assert.equal(c1.reservaId, c2.reservaId);
      assert.notEqual(c1.token, c2.token);
      await assert.rejects(consultarReservaPublica(db, c1.token, ahora), AccesoDenegado, "token anterior revocado");
      await consultarReservaPublica(db, c2.token, ahora);
      assert.equal(await db.reserva.count({ where: { organizacionId: O, clienteId: (await db.reserva.findUniqueOrThrow({ where: { id: c1.reservaId } })).clienteId } }), 1);
      await assert.rejects(crear(solicitud({ inicio: en("12:00").toISOString() }, { email: `otra-${O}@example.invalid` }), k), ConflictoIdempotencia);
    });

    await t.test("un horario ya tomado responde 409 y el reintento devuelve lo mismo", async () => {
      const k = clave();
      // Ana es la única apta y ya está retenida a las 10:00.
      const r = await crear(solicitud({}, { email: `tercera-${O}@example.invalid` }), k);
      assert.equal(r.codigo, 409);
      const otra = await crear(solicitud({}, { email: `tercera-${O}@example.invalid` }), k);
      assert.deepEqual(otra, r);
    });

    await t.test("la identidad existente no se modifica desde el portal", async () => {
      const existente = (await crearCliente(db, M, O, a.norte.id, { nombre: "Carla", email: `carla-${O}@example.invalid`, telefono: "1199990000" }))!.id;
      const r = await crear(solicitud({ inicio: en("13:00").toISOString(), items: [{ servicioId: semi }] }, { nombre: "Otro Nombre", email: `CARLA-${O}@example.invalid` }));
      assert.equal(r.codigo, 201);
      const c = await db.cliente.findUniqueOrThrow({ where: { id: existente } });
      assert.equal(c.nombre, "Carla");
      assert.equal((await db.reserva.findUniqueOrThrow({ where: { id: (r.cuerpo as ReservaPublicaRespuesta).reservaId } })).clienteId, existente);
    });

    await t.test("límite de turnos pendientes por contacto, también en paralelo", async () => {
      const email = `acapara-${O}@example.invalid`;
      const res = await Promise.allSettled(["14:00", "15:00", "16:00"].map(h => crear(solicitud({ inicio: en(h).toISOString() }, { email }), clave(), null)));
      const ok = res.filter(x => x.status === "fulfilled" && x.value.codigo === 201).length;
      const limite = res.filter(x => x.status === "rejected" && x.reason instanceof LimiteExcedido).length;
      assert.deepEqual([ok, limite], [POLITICA_PUBLICA.pendientesPorContacto, 1]);
      // Con pendientes al tope no se toman más turnos con ese contacto, tampoco gratuitos (evita acaparar).
      // Un servicio sin seña confirma directo.
      await guardarServicio(db, M, O, { ...base, nombre: "Consulta", duracionMinutos: 20, sena: { tipo: "NINGUNA", valor: null }, skillIds: [] }, sinSena);
      await assert.rejects(crear(solicitud({ inicio: en("17:00").toISOString(), items: [{ servicioId: sinSena }] }, { email }), clave(), null), LimiteExcedido);
      const gratis = await crear(solicitud({ inicio: en("17:00").toISOString(), items: [{ servicioId: sinSena }] }, { email: `gratis-${O}@example.invalid` }), clave(), null);
      assert.equal((gratis.cuerpo as ReservaPublicaRespuesta).estado, "CONFIRMADA");
    });

    await t.test("límite por IP y clave liberada para reintentar", async () => {
      const ip = "203.0.113.99";
      for (let i = 0; i < POLITICA_PUBLICA.intentosPorIp; i++) await db.eventoPublico.create({ data: { createdAt: ahora, tipo: "reserva_publica", clave: (await import("node:crypto")).createHash("sha256").update(`ip:${ip}`).digest("hex") } });
      const k = clave();
      await assert.rejects(crear(solicitud({ inicio: en("09:00").toISOString() }, { email: `ip-${O}@example.invalid` }), k, ip), LimiteExcedido);
      assert.equal(await db.claveIdempotencia.count({ where: { clave: k } }), 0, "la clave queda libre");
    });

    await t.test("validaciones de negocio: 422 recordado", async () => {
      const r = await crear(solicitud({ inicio: en("09:00").toISOString(), items: [{ servicioId: semi }] }, { email: `inv-${O}@example.invalid`, telefono: "12" }));
      assert.equal(r.codigo, 422);
      assert.equal((await crear(solicitud({ sedeId: a.sur.id }))).codigo, 422, "servicio no habilitado en esa sede");
    });
  } finally { await db.$disconnect(); }
});
