import { test } from "node:test";
import assert from "node:assert/strict";
import { tienePermiso, type Asignacion } from "../src/access.ts";
import { accionesPermitidas, alcanzaIncidencia, clasificarEmail, clasificarPago, clasificarTrabajo, estadoIncidencia, referenciasTrabajo, reintentable, validarNota } from "../src/incidencias.ts";

const ahora = new Date("2026-10-14T12:00:00Z");
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);

test("trabajos: fallido, atrasado y trabado con la tolerancia del worker", () => {
  assert.equal(clasificarTrabajo({ estado: "FALLIDO", proximoIntento: ahora, leaseHasta: null }, ahora), "TRABAJO_FALLIDO");
  assert.equal(clasificarTrabajo({ estado: "PENDIENTE", proximoIntento: hace(6), leaseHasta: null }, ahora), "TRABAJO_ATRASADO");
  assert.equal(clasificarTrabajo({ estado: "PENDIENTE", proximoIntento: hace(4), leaseHasta: null }, ahora), null, "dentro de la tolerancia");
  assert.equal(clasificarTrabajo({ estado: "EN_PROCESO", proximoIntento: hace(60), leaseHasta: hace(6) }, ahora), "TRABAJO_TRABADO");
  assert.equal(clasificarTrabajo({ estado: "EN_PROCESO", proximoIntento: hace(60), leaseHasta: hace(1) }, ahora), null);
  assert.equal(clasificarTrabajo({ estado: "COMPLETADO", proximoIntento: hace(60), leaseHasta: null }, ahora), null);
  assert.equal(clasificarTrabajo({ estado: "CANCELADO", proximoIntento: hace(60), leaseHasta: null }, ahora), null);
});

test("pagos: a devolver, sin imputar, ambiguo y reembolsado con turno vigente", () => {
  const base = { motivo: null, actualizado: hace(1), reserva: { estado: "CONFIRMADA" }, otroAprobado: false };
  assert.equal(clasificarPago({ ...base, estado: "A_DEVOLVER", motivo: "pago duplicado" }, ahora), "PAGO_A_DEVOLVER");
  assert.equal(clasificarPago({ ...base, estado: "APROBADO" }, ahora), null);
  assert.equal(clasificarPago({ ...base, estado: "APROBADO", reserva: { estado: "CANCELADA" } }, ahora), "PAGO_SIN_IMPUTAR");
  assert.equal(clasificarPago({ ...base, estado: "EN_PROCESO" }, ahora), null, "recién llegado");
  assert.equal(clasificarPago({ ...base, estado: "EN_PROCESO", actualizado: hace(31) }, ahora), "PAGO_AMBIGUO");
  assert.equal(clasificarPago({ ...base, estado: "REEMBOLSADO" }, ahora), "PAGO_REEMBOLSADO_CON_TURNO");
  assert.equal(clasificarPago({ ...base, estado: "REEMBOLSADO", motivo: "pago duplicado" }, ahora), null, "la devolución esperada de un A_DEVOLVER");
  assert.equal(clasificarPago({ ...base, estado: "REEMBOLSADO", otroAprobado: true }, ahora), null, "otro pago sostiene el turno");
  assert.equal(clasificarPago({ ...base, estado: "REEMBOLSADO", reserva: { estado: "CANCELADA" } }, ahora), null);
  assert.equal(clasificarPago({ ...base, estado: "RECHAZADO" }, ahora), null);
});

test("emails: fallido, rebote y queja; omitido no es falla", () => {
  assert.deepEqual(["FALLIDO", "REBOTADO", "QUEJA", "OMITIDO", "ENTREGADO", "PENDIENTE"].map(clasificarEmail), ["EMAIL_FALLIDO", "EMAIL_REBOTADO", "EMAIL_QUEJA", null, null, null]);
});

test("estado derivado: solo cuentan las acciones de la ocurrencia actual", () => {
  const marca = hace(10);
  const a = (accion: "REVISADA" | "RESUELTA" | "REABIERTA" | "DEVOLUCION_GESTIONADA" | "REINTENTADA", min: number, m = marca) => ({ accion, marcaFuente: m, fecha: hace(min) });
  assert.equal(estadoIncidencia(marca, []), "ABIERTA");
  assert.equal(estadoIncidencia(marca, [a("REVISADA", 5)]), "EN_SEGUIMIENTO");
  assert.equal(estadoIncidencia(marca, [a("DEVOLUCION_GESTIONADA", 5)]), "EN_SEGUIMIENTO");
  assert.equal(estadoIncidencia(marca, [a("REVISADA", 5), a("RESUELTA", 4)]), "RESUELTA");
  assert.equal(estadoIncidencia(marca, [a("RESUELTA", 4), a("REVISADA", 3)]), "RESUELTA", "una revisión posterior no reabre");
  assert.equal(estadoIncidencia(marca, [a("RESUELTA", 4), a("REABIERTA", 2)]), "ABIERTA");
  // Orden por fecha, no por posición en el arreglo.
  assert.equal(estadoIncidencia(marca, [a("REABIERTA", 2), a("RESUELTA", 4)]), "ABIERTA");
  // Resuelta sobre una ocurrencia anterior (el trabajo volvió a fallar después).
  assert.equal(estadoIncidencia(marca, [a("RESUELTA", 30, hace(40))]), "ABIERTA");
});

test("acciones permitidas: reintento solo de fallidos conocidos; devolución gestionada solo en pagos", () => {
  assert.deepEqual(accionesPermitidas({ tipo: "TRABAJO_FALLIDO", estado: "ABIERTA", tipoTrabajo: "email.reserva_confirmada", estadoTrabajo: "FALLIDO" }), ["REVISADA", "RESUELTA", "REINTENTADA"]);
  assert.deepEqual(accionesPermitidas({ tipo: "TRABAJO_FALLIDO", estado: "ABIERTA", tipoTrabajo: "algo.desconocido", estadoTrabajo: "FALLIDO" }), ["REVISADA", "RESUELTA"]);
  assert.deepEqual(accionesPermitidas({ tipo: "TRABAJO_ATRASADO", estado: "EN_SEGUIMIENTO", tipoTrabajo: "pagos.mercadopago", estadoTrabajo: "PENDIENTE" }), ["RESUELTA"]);
  assert.deepEqual(accionesPermitidas({ tipo: "PAGO_A_DEVOLVER", estado: "ABIERTA" }), ["REVISADA", "RESUELTA", "DEVOLUCION_GESTIONADA"]);
  assert.deepEqual(accionesPermitidas({ tipo: "PAGO_A_DEVOLVER", estado: "RESUELTA" }), ["REABIERTA"]);
  assert.deepEqual(accionesPermitidas({ tipo: "PAGO_AMBIGUO", estado: "ABIERTA" }), ["REVISADA", "RESUELTA"]);
  assert.deepEqual(accionesPermitidas({ tipo: "EMAIL_REBOTADO", estado: "ABIERTA" }), ["REVISADA", "RESUELTA"]);
  assert.deepEqual(accionesPermitidas({ tipo: null, estado: "ABIERTA" }), [], "sin incidencia vigente solo historial");
  assert.equal(reintentable("pagos.mercadopago"), true);
  assert.equal(reintentable("facturante.emitir"), false, "un tipo nuevo se revisa antes de habilitarlo");
});

test("nota obligatoria y acotada", () => {
  assert.match(validarNota("")!, /obligatoria/);
  assert.match(validarNota("   ok   ")!, /obligatoria/);
  assert.equal(validarNota("Devuelto desde el panel de MP, op. 123"), null);
  assert.match(validarNota("x".repeat(1001))!, /hasta 1000/);
});

test("alcance: master todo; franquiciado y admin solo sus sedes; sin sede u organización solo el master", () => {
  const sedes: Record<string, string> = { centro: "franA", norte: "franA", sur: "franB" };
  const de = (id: string) => sedes[id];
  const master: Asignacion = { rol: "MASTER_FRANQUICIADOR", alcance: "ORGANIZACION", franquiciadoId: null, sedeId: null };
  const fran: Asignacion = { rol: "FRANQUICIADO", alcance: "FRANQUICIADO", franquiciadoId: "franA", sedeId: null };
  const admin: Asignacion = { rol: "ADMIN_SEDE", alcance: "SEDE", franquiciadoId: null, sedeId: "centro" };
  const recepcion: Asignacion = { rol: "RECEPCIONISTA", alcance: "SEDE", franquiciadoId: null, sedeId: "centro" };
  const profesional: Asignacion = { rol: "PROFESIONAL", alcance: "PROPIO", franquiciadoId: null, sedeId: null };
  const en = (sedeId: string | null, organizacionId: string | null = "org") => ({ organizacionId, sedeId });
  assert.deepEqual([master, fran, admin, recepcion, profesional].map(a => tienePermiso(a, "incidencia:gestionar")), [true, true, true, false, false]);
  assert.equal(alcanzaIncidencia([master], en("sur"), de), true);
  assert.equal(alcanzaIncidencia([fran], en("norte"), de), true);
  assert.equal(alcanzaIncidencia([fran], en("sur"), de), false);
  assert.equal(alcanzaIncidencia([admin], en("centro"), de), true);
  assert.equal(alcanzaIncidencia([admin], en("norte"), de), false);
  assert.equal(alcanzaIncidencia([recepcion], en("centro"), de), false);
  assert.equal(alcanzaIncidencia([profesional], en("centro"), de), false);
  assert.equal(alcanzaIncidencia([fran, admin], en(null), de), false, "trabajo de la organización sin sede");
  assert.equal(alcanzaIncidencia([master], en(null), de), true);
  assert.equal(alcanzaIncidencia([fran], en(null, null), de), false, "trabajo del sistema");
  assert.equal(alcanzaIncidencia([master], en(null, null), de), true);
  assert.equal(alcanzaIncidencia([master], en("otra-org"), de), false, "sede que no es de la organización");
});

test("referencias del payload: solo ids válidos", () => {
  const u = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab", v = "7f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
  assert.deepEqual(referenciasTrabajo({ sedeId: u, ambiente: "PRUEBA", pagoId: "123" }), { sedeId: u, reservaId: null });
  assert.deepEqual(referenciasTrabajo({ reservaId: u, anteriorId: v }), { sedeId: null, reservaId: v }, "reprogramación: la reserva original");
  assert.deepEqual(referenciasTrabajo({ sedeId: "'; DROP TABLE" }), { sedeId: null, reservaId: null });
  assert.deepEqual(referenciasTrabajo(null), { sedeId: null, reservaId: null });
  assert.deepEqual(referenciasTrabajo([u]), { sedeId: null, reservaId: null });
});
