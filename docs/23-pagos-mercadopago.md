# Seña con Mercado Pago · 2026-10-12

Implementa R04 (Checkout Pro y webhook). Migración `202610120013_pagos`. Lógica en `packages/database/src/pagos.ts`; el cliente HTTP en `packages/integrations/src/mercadopago.ts`; la firma del webhook en `packages/domain/src/mercadopago.ts`.

**Estado:** validado en staging el 2026-10-14 con un cobro real. La sede Lomada tenía una cuenta real vinculada por OAuth; se reservó un servicio de prueba con seña de $ 200 y se pagó desde otra cuenta. Resultado:
- Mercado Pago aprobó y acreditó el pago.
- Se registró `APROBADO` y la reserva quedó `CONFIRMADA`.
- Llegaron las dos vías: el Webhook firmado y el retorno al portal. Cada una encoló su consulta y no hubo doble confirmación.

Con eso se cierra R04 y la parte de Mercado Pago de F05.

Las pruebas con usuarios de prueba de Mercado Pago no funcionaron con la aplicación productiva:
- el checkout de sandbox falla con tokens `APP_USR-` (ver «Preferencia»);
- un pago directo por API entre un vendedor de prueba vinculado a la aplicación productiva y un comprador cualquiera devolvió `2034 Invalid users involved`.

Por eso la validación se hizo con dinero real y un monto chico.

## Decisiones (2026-10-12)

- **Checkout Pro**, no Bricks: Mercado Pago muestra el formulario de pago y nosotros nunca tocamos datos de tarjeta.
- **Pago tardío** (llega con la retención vencida): se confirma si el horario sigue libre; si no, el pago queda `A_DEVOLVER` para revisión manual. Es parte de D7; el resto de la política de reembolsos sigue pendiente.

## Recorrido

1. El portal muestra «Pagar seña» mientras la reserva está `PENDIENTE_PAGO` y la retención vigente.
2. `POST /api/public/v1/reservas/actual/pago` (token en `Authorization`) crea un `CheckoutPago` y la preferencia, y devuelve la URL de Mercado Pago.
   - Una preferencia por retención: varios clics devuelven la misma.
   - Si la llamada a Mercado Pago falla, el próximo intento reusa el id del checkout como clave de idempotencia.
3. El cliente paga en Mercado Pago y vuelve a `/?pago=retorno&payment_id=…`.
4. Mercado Pago notifica a `POST /api/webhooks/mercadopago/{sedeId}`. Se valida la firma con la clave secreta de la aplicación (`MP_WEBHOOK_SECRET`) y se encola un trabajo `pagos.mercadopago`. Se responde enseguida.
5. El worker consulta el pago a la API con el access token de la sede y lo aplica (ver abajo).
6. Al volver, el portal llama a `POST …/reservas/actual/pago/verificar` con el `payment_id`. Encola la misma consulta y adelanta la confirmación si la notificación se demora. En local, sin webhook, es la única vía. Después consulta el estado cada 3 s durante un minuto.

**El retorno y el cuerpo de la notificación nunca confirman nada.** El estado sale siempre de `GET /v1/payments/{id}`. Un retorno manipulado o una notificación inventada solo hacen que consultemos la API.

## Preferencia

- `external_reference` = id del `CheckoutPago`. Así un pago se vincula a su reserva.
- `binary_mode`: el pago se aprueba o se rechaza en el momento, sin quedar pendiente.
- Se excluyen los pagos en efectivo (`ticket`, `atm`), que se acreditan días después de vencida la retención. Una sola cuota.
- Vence junto con la retención (`expiration_date_to`).
- `notification_url` solo con HTTPS; en local no se envía.
- Se usa `init_point`. `sandbox_init_point` solo con credenciales `TEST-` de la aplicación: una cuenta vinculada por OAuth tiene token `APP_USR-` aunque sea un usuario de prueba, y con ella el checkout de sandbox falla al pagar ("Oh, no, algo anduvo mal", probado en staging el 2026-10-14). Entre usuarios de prueba, el checkout normal simula el pago.

## Aplicación del pago

| Pago en Mercado Pago | Reserva | Resultado |
|---|---|---|
| `approved` | `PENDIENTE_PAGO` vigente | Reserva `CONFIRMADA`, pago `APROBADO`, evento `CONFIRMADA` con `origen: mercadopago` |
| `approved` | Retención vencida (`EXPIRADA` o pendiente vencida) y horario libre | Igual, con `tardio: true`. Los recursos se vuelven a asignar con el motor |
| `approved` | Vencida y horario ocupado | Pago `A_DEVOLVER`; la reserva no cambia |
| `approved` | `CANCELADA` | `A_DEVOLVER` |
| `approved` | Ya tenía otro pago aprobado | `A_DEVOLVER` (pago duplicado) |
| `approved` | `CONFIRMADA` sin pago (p. ej. por recepción) | `APROBADO`, se registra contra el turno |
| `approved` con cuenta, moneda o monto distintos | Cualquiera | `A_DEVOLVER`; nunca confirma |
| `rejected` / `cancelled` | Sin cambios | `RECHAZADO`; el cliente puede reintentar mientras dure la retención |
| `pending` / `in_process` / desconocido | Sin cambios | `EN_PROCESO`; nunca confirma |
| `refunded` / `charged_back` | Sin cambios | `REEMBOLSADO`. El turno lo resuelve una persona (M01) |

- **Idempotencia:** el pago se identifica por su id externo. Procesarlo otra vez no hace nada. Un pago `APROBADO` o `A_DEVOLVER` solo puede pasar a `REEMBOLSADO`. Un índice único parcial impide dos pagos `APROBADO` para la misma reserva.
- **Concurrencia:** se bloquean los profesionales y recursos (mismo protocolo que el doc 16) y después la fila de la reserva. Eso serializa con el worker que vence retenciones, con otra notificación del mismo pago y con una reserva nueva sobre el mismo horario. Probado con cuatro notificaciones simultáneas: una sola confirmación.
- **Pago tardío:** el horario se revalida con el motor y las reglas de recepción, para los mismos profesionales e intervalos. Si el servicio cambió de duración o el turno ya empezó, no se confirma solo.
- **Pagos ajenos:** un pago sin referencia, o con la referencia de un checkout de otra sede, se ignora (`AJENO`). Puede ser otra venta de la misma cuenta.

## Webhook

- **URL:** `/api/webhooks/mercadopago/{sedeId}`. La sede identifica qué access token usar (D8: cuentas propias por sede).
- **Firma:** con la clave secreta de la aplicación de NailNet (`MP_WEBHOOK_SECRET`). Las cuentas de las sedes están vinculadas por OAuth a esa aplicación, así que Mercado Pago firma con su clave, no con una de cada sede. La sede de la URL no entra en la firma: una notificación válida reenviada a otra sede solo provoca una consulta que esa cuenta no puede ver (y un pago de otro cobrador queda `AJENO` o `A_DEVOLVER`). Formato `x-signature: ts=…,v1=…`. Manifiesto `id:{data.id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256 en hexadecimal ([documentación](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks)).
- **Respuestas:**
  - 200: encolado o ignorado. Se ignora sin verificar la firma el formato IPN (`?topic=…&id=…`) y los eventos que no son `payment` (por ejemplo `merchant_order`). IPN no viene firmado y Mercado Pago lo está discontinuando; para el mismo pago también llega el Webhook firmado. Antes se respondía 401 y Mercado Pago reintentaba esas notificaciones durante horas;
  - 401: firma inválida, falta `x-request-id` o la sede no tiene credenciales. Las tres son iguales a propósito, para no revelar qué sedes cobran online;
  - 500: no se pudo encolar; Mercado Pago reintenta.
- **Deduplicación:** el trabajo tiene clave `mp:{ambiente}:{pagoId}:req:{x-request-id}`. Un reenvío de la misma notificación no duplica la consulta.
- **Errores del worker:** 400, 401 y 403 (credenciales o pedido inválidos) pasan a `FALLIDO` para revisión (M04). Todo lo demás se reintenta con espera creciente, incluido el 404: el pago puede no ser consultable todavía segundos después de la notificación.
- **Rearme:** si llega otra vez una notificación cuyo trabajo había quedado `FALLIDO` (por ejemplo, después de corregir las credenciales), el trabajo vuelve a `PENDIENTE`. La deduplicación nunca deja un pago sin aplicar para siempre.
- **Retorno del portal:** como mucho 5 ids de pago distintos por reserva (429). Así nadie usa la cola, ni la cuota de la API de la sede, como canal de abuso.

## Ambiente

`NAILNET_AMBIENTE=produccion` usa las credenciales `PRODUCCION` de la sede; cualquier otro valor (staging, local) usa las `PRUEBA`. El worker ahora descifra credenciales: en Railway recibe `NAILNET_CLAVES_CIFRADO` y `NAILNET_CLAVE_ACTIVA` por referencia a las del backoffice (`.railway/railway.ts`).

## Vinculación de cuentas (OAuth) · 2026-10-13

Cada sede conecta su propia cuenta de Mercado Pago autorizando a la aplicación de NailNet, en lugar de pegar tokens. Mismo esquema que Clicnet, con dos diferencias: el `state` está atado al navegador y la renovación manda el refresh token.

1. En Configuración → la sede → «Conectar con Mercado Pago» (permiso `sede:credenciales`). La acción guarda en una cookie cifrada y httpOnly (10 minutos) quién vincula qué sede y un `state` al azar, y redirige a `auth.mercadopago.com.ar/authorization`.
2. Quien administra la cuenta inicia sesión en Mercado Pago y autoriza.
3. Mercado Pago vuelve a `GET /api/mercadopago/callback?code=…&state=…`:
   - el `state` tiene que coincidir con la cookie (tiempo constante) y la sesión tiene que ser la misma persona; si no, no se vincula nada. Un link de autorización armado por otro no trae la cookie, así que no puede vincular su cuenta a una sede ajena;
   - se canjea el `code` en `POST /oauth/token` y se guardan access token, refresh token, `user_id` (cuenta receptora) y vencimiento, cifrados como el resto de las credenciales (doc 11). El permiso se vuelve a exigir al guardar;
   - el resultado vuelve a la página de la sede como `?mp=vinculada|cancelado|duplicada|error`.
- **Ambiente:** se vincula el del despliegue (`NAILNET_AMBIENTE`): en staging, un usuario vendedor de prueba de Mercado Pago; en producción, la cuenta real. La pantalla solo ofrece ese.
- **Una cuenta, una sede:** el `user_id` sigue siendo único por ambiente (doc 11). Volver a conectar la misma cuenta en la misma sede reemplaza los tokens.
- **Renovación:** los tokens duran 180 días; el refresh token es de un solo uso. Se renuevan cuando les quedan menos de 30 días:
  - al usarlos (link de pago, consulta del worker), bajo lock de la fila para que dos procesos no gasten el mismo refresh token;
  - y con una tarea horaria del worker (`mercadopago.renovacion`), para sedes que no están cobrando.
  - Si la renovación falla pero el token todavía sirve, se usa igual. Una renovación nunca cambia la cuenta receptora.
- **Desvincular:** borra la credencial. No revoca la autorización en Mercado Pago; eso lo hace la sede desde su cuenta.
- **Carga manual:** ya no se acepta para Mercado Pago. Una fila cargada a mano antes de este cambio sigue cobrando, pero no se renueva y la pantalla pide volver a conectarla.

**Variables** (backoffice; el worker recibe las dos primeras por referencia):

| Variable | Uso |
|---|---|
| `MP_APP_ID` | Client ID de la aplicación de Mercado Pago de NailNet |
| `MP_CLIENT_SECRET` | Client secret. Canje del `code` y renovación |
| `MP_WEBHOOK_SECRET` | Clave secreta de notificaciones de la aplicación |
| `MP_REDIRECT_URI` | Opcional. Por defecto `{BACKOFFICE_URL o dominio público}/api/mercadopago/callback` |

La redirect URI tiene que estar registrada tal cual en la aplicación de Mercado Pago (una por entorno: staging y producción). Sin `MP_APP_ID` y `MP_CLIENT_SECRET`, la pantalla avisa que la integración no está configurada.

## Pendiente

- **Casos sin probar con Mercado Pago real:** pago rechazado, pago tardío (retención vencida) y reembolso hecho desde el panel de Mercado Pago. El formato de la firma (manifiesto y `ts`) quedó confirmado con la notificación real del 2026-10-14.
- **Conciliación periódica (M01):** si no llegan ni la notificación ni el retorno, un pago aprobado queda sin aplicar hasta que alguien lo revise. Falta una tarea que busque por `external_reference` los checkouts de retenciones recientes.
- **Ventana de carrera:** un pago aprobado segundos antes de vencer, pero notificado después de que otra persona tomó el horario, queda `A_DEVOLVER` aunque se pagó en término. La preferencia vence con la retención, así que la ventana es chica; se revisa con datos reales.
- **Bandeja de pagos a devolver (M04)** y devolución desde el sistema (M01, D7). Hoy los `A_DEVOLVER` solo se ven en la base.
- **Cancelar o reprogramar un turno pagado** no toca su `Pago`: sigue `APROBADO` contra la reserva original. La devolución o el traspaso de la seña son manuales hasta D5/M01.
- **Reservas de recepción con seña (D6):** el link de pago es solo para el portal. Recepción todavía no puede generar uno para enviar al cliente.

## Verificación

- `npm run test:domain`: firma (datos alterados, cabeceras mal formadas, partes ausentes, id alfanumérico) y traducción de estados.
- `npm run test -w @nailnet/integrations`: preferencia (cuerpo, idempotencia, sandbox o producción), clasificación de errores sin exponer el token y consulta de pago.
- `npm run test:database`: 11 casos de pagos sobre Postgres:
  - sin credenciales;
  - preferencia reutilizada;
  - rechazo y reintento;
  - confirmación idempotente;
  - pago duplicado;
  - reembolso;
  - monto, moneda o cuenta distintos;
  - pago tardío libre y ocupado;
  - reserva cancelada;
  - notificaciones concurrentes;
  - pagos ajenos;
  - deduplicación de la cola.
- `npm run check` y smoke.
