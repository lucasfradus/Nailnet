import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { clasificarNotificacionMercadoPago, estadoPagoMercadoPago, verificarFirmaMercadoPago } from "../src/mercadopago.ts";

test("clasificación de notificaciones: solo se procesan Webhooks de pago", () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.deepEqual(clasificarNotificacionMercadoPago(q("data.id=183090827545&type=payment"), { type: "payment", data: { id: "183090827545" } }), { accion: "verificar", dataId: "183090827545" });
  // Sin data.id en la consulta, se toma del cuerpo (también numérico).
  assert.deepEqual(clasificarNotificacionMercadoPago(q(""), { type: "payment", data: { id: 42 } }), { accion: "verificar", dataId: "42" });
  // IPN (formato viejo, sin firma): se ignora aunque sea de un pago.
  assert.deepEqual(clasificarNotificacionMercadoPago(q("topic=payment&id=183090827545"), null), { accion: "ignorar", motivo: "ipn" });
  assert.deepEqual(clasificarNotificacionMercadoPago(q("topic=merchant_order&id=1"), null), { accion: "ignorar", motivo: "ipn" });
  // Otros eventos y pedidos mal formados.
  assert.deepEqual(clasificarNotificacionMercadoPago(q("data.id=1&type=topic_merchant_order_wh"), null), { accion: "ignorar", motivo: "otro_evento" });
  assert.deepEqual(clasificarNotificacionMercadoPago(q("type=payment"), null), { accion: "ignorar", motivo: "otro_evento" });
  assert.deepEqual(clasificarNotificacionMercadoPago(q("type=payment&data.id=../x"), null), { accion: "ignorar", motivo: "otro_evento" });
});

const secreto = "clave-secreta-de-prueba-123";
const firmar = (manifiesto: string, clave = secreto) => createHmac("sha256", clave).update(manifiesto).digest("hex");

test("firma de notificaciones de Mercado Pago", () => {
  const v1 = firmar("id:123456;request-id:bb56a2f1-6aae-46ac-982e-9dcd3581d08e;ts:1742505638683;");
  const base = { firma: `ts=1742505638683,v1=${v1}`, requestId: "bb56a2f1-6aae-46ac-982e-9dcd3581d08e", dataId: "123456", secreto };
  assert.equal(verificarFirmaMercadoPago(base), true);
  // Espacios alrededor de las partes de la cabecera.
  assert.equal(verificarFirmaMercadoPago({ ...base, firma: `ts=1742505638683, v1=${v1}` }), true);

  // Cualquier dato alterado invalida la firma.
  assert.equal(verificarFirmaMercadoPago({ ...base, dataId: "123457" }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, requestId: "otro" }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, firma: `ts=1742505638684,v1=${v1}` }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, secreto: "otra-clave-secreta-123" }), false);

  // Cabeceras ausentes o mal formadas.
  assert.equal(verificarFirmaMercadoPago({ ...base, firma: null }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, firma: "ts=1742505638683" }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, firma: `v1=${v1}` }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, firma: "ts=1,v1=corta" }), false);
  assert.equal(verificarFirmaMercadoPago({ ...base, secreto: "" }), false);

  // Las partes que no llegaron se omiten del manifiesto; data.id alfanumérico va en minúsculas.
  assert.equal(verificarFirmaMercadoPago({ firma: `ts=10,v1=${firmar("ts:10;")}`, requestId: null, dataId: null, secreto }), true);
  assert.equal(verificarFirmaMercadoPago({ firma: `ts=10,v1=${firmar("id:abc123;ts:10;")}`, requestId: null, dataId: "ABC123", secreto }), true);
});

test("estados de pago de Mercado Pago", () => {
  assert.equal(estadoPagoMercadoPago("approved"), "APROBADO");
  for (const s of ["rejected", "cancelled"]) assert.equal(estadoPagoMercadoPago(s), "RECHAZADO");
  for (const s of ["refunded", "charged_back"]) assert.equal(estadoPagoMercadoPago(s), "REEMBOLSADO");
  // Pendientes y estados desconocidos nunca confirman.
  for (const s of ["pending", "in_process", "authorized", "in_mediation", "algo_nuevo"]) assert.equal(estadoPagoMercadoPago(s), "EN_PROCESO");
});
