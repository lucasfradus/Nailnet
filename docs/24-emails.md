# Emails transaccionales con Resend · 2026-10-14

Implementa P03. Migración `202610140020_emails`. Lógica en `packages/database/src/emails.ts`, plantillas en `packages/domain/src/emails.ts`, cliente HTTP en `packages/integrations/src/resend.ts` y firma del webhook en `packages/domain/src/resend.ts`. El worker conecta el transporte (`apps/worker/src/manejadores.ts`).

**Estado:** probado con transportes falsos y Postgres real. **Falta enviar de verdad:** no hay API key de Resend ni dominio verificado (D03). Sin eso, staging simula y producción deja los emails en cola.

## Qué se envía

| Trabajo | Cuándo se encola | Clave (idempotencia) | A quién |
|---|---|---|---|
| `email.reserva_confirmada` | Reserva creada ya confirmada (recepción, online sin seña) o pendiente que se confirma (seña aprobada, R04) | `email.reserva_confirmada:{reservaId}` | Cliente |
| `email.reserva_cancelada` | Cancelación (R03) | `email.reserva_cancelada:{reservaId}` | Cliente |
| `email.reserva_reprogramada` | Reprogramación (R03). Lleva el horario nuevo y menciona el anterior; la reserva nueva no manda otra confirmación | `email.reserva_reprogramada:{reservaId original}` | Cliente |
| `email.recuperacion` | Pedido de «Recuperar acceso» en el backoffice | `email.recuperacion:{tokenId}` | Usuario |

- **Reservas:** el gancho está en `registrarEvento` (`reservas.ts`), que todas las transiciones ya usan. Así cualquier camino que confirme, cancele o reprograme (recepción, portal, Mercado Pago) avisa sin que cada uno se acuerde.
- **Sin email del cliente** (frecuente en recepción) no se encola nada.
- Un vencimiento de retención (`EXPIRADA`), atendido o ausente no mandan email.

## Garantías

- **Outbox:** se encola con `encolarJob` en la misma transacción que el evento. Si el cambio se revierte, no sale ningún email; si confirma, el trabajo existe aunque el proceso se caiga.
- **Sin duplicados:**
  - la misma clave identifica al trabajo, a la evidencia (`EnvioEmail.clave`) y al header `Idempotency-Key` de Resend;
  - dos eventos de confirmación sobre la misma reserva (creada confirmada y luego confirmada otra vez) dan un solo trabajo;
  - si el trabajo se repite después de un envío aceptado (lease vencido), la evidencia ya tiene el id de Resend y no se vuelve a mandar. Y si el envío salió pero no llegamos a guardarlo, Resend devuelve el mismo email por la clave durante 24 h.
- **Datos frescos:** el payload solo lleva ids. Al enviar se leen la reserva, el cliente y la sede. Si mientras tanto la situación cambió, el email se **omite** y queda registrado por qué:
  - una confirmación cuya reserva ya se canceló o se reprogramó: el cliente recibe el email del cambio, que es el que vale;
  - el turno ya empezó;
  - el cliente ya no tiene email;
  - el enlace de recuperación ya se usó, venció o fue reemplazado por otro pedido.
- **Reintentos:**
  - red, tiempo agotado, 429, 5xx y 409 `concurrent_idempotent_requests` se reintentan con la espera creciente de la cola (doc 21): 8 intentos, 5 para la recuperación, que vence a los 30 minutos;
  - el resto de los 4xx (validación, dominio sin verificar, API key inválida) es `ErrorPermanente`: el trabajo pasa a `FALLIDO` para revisión (M04);
  - un 200 sin id se trata como transitorio y se reintenta con la misma clave.

## Evidencia (`EnvioEmail`)

Una fila por clave, actualizada en cada intento:

- **Qué:** tipo, destinatario, asunto, organización, y `reservaId` (la que originó el evento) o `usuarioId`.
- **Resultado:** proveedor (`resend` o `simulado`), `proveedorId` (id de Resend), intentos, último error resumido y fecha de envío.
- **Estados:**

| Estado | Significado |
|---|---|
| `PENDIENTE` | Hubo un intento fallido y se reintenta |
| `ENVIADO` | Resend lo aceptó (tiene `proveedorId`) |
| `SIMULADO` | Lo aceptó el transporte falso: no salió a la red |
| `OMITIDO` | No correspondía enviarlo (ver `motivo`) |
| `FALLIDO` | Error permanente o intentos agotados; o Resend informó `email.failed` |
| `DEMORADO`, `ENTREGADO`, `REBOTADO`, `QUEJA` | Informados por el webhook de Resend |

- **Entrega:** `POST /api/webhooks/resend` recibe los eventos de Resend. Valida la firma Svix con `RESEND_WEBHOOK_SECRET` (HMAC-SHA256 de `{svix-id}.{svix-timestamp}.{cuerpo}`, ventana de 5 minutos) y actualiza el envío por su `proveedorId`.
  - Los estados solo avanzan: un `delivery_delayed` que llega después del `delivered` no lo pisa; una queja sí, porque llega después de la entrega.
  - Para un rebote se guarda el motivo que informa Resend.
  - Responde 200 a eventos que no usamos (`sent`, `opened`, `clicked`) y a ids desconocidos (otro ambiente en la misma cuenta). Responde 401 sin firma válida y 500 si no pudo guardar, para que Resend reintente.
- **Restricciones en la base:** un envío aceptado siempre tiene id del proveedor y fecha. Los textos están acotados (error ≤ 1000, motivo ≤ 500). La tabla no tiene claves foráneas, a propósito: es auditoría y sobrevive a la purga de trabajos completados (30 días).
- **Sin cuerpo:** no se guarda el HTML ni el texto enviado. Se regenera desde la reserva si hace falta, y así el enlace de recuperación nunca queda guardado.

## Plantillas

- HTML con tablas y estilos en línea, más una versión de texto, en español rioplatense.
- **Marca:** el nombre de la organización (Sicurella) en el encabezado y en el asunto, con el teal del kit (`#008094`). El modelo todavía no tiene logo ni datos de contacto por sede, así que no se incluyen.
- Fecha y hora en la zona horaria de la sede («martes, 13 de octubre» y «15:30 h»), con servicios, profesional (solo el nombre) y sede.
- **Escape:**
  - todo dato del cliente o de la configuración (nombres, servicios, sede) se escapa en el HTML;
  - el asunto y los campos se limpian de saltos de línea y caracteres de control;
  - el enlace de recuperación solo se acepta `https` (o `http://localhost` en desarrollo).
- **No viaja al cliente:** el motivo interno de una cancelación y los importes. La cancelación avisa que, si hubo seña, la sede contacta por la devolución (D5 sigue pendiente).

## Recuperación de contraseña

1. El backoffice emite el token (doc 09) y en la misma transacción encola el email. El enlace `{BACKOFFICE_URL}/restablecer#{token}` se arma en el backoffice, que conoce su URL pública, y viaja **cifrado** en el payload con el llavero del servidor (`NAILNET_CLAVES_CIFRADO`, doc 11). El contexto del cifrado es el id del token. En la base no queda el token en claro en ningún lado.
2. El worker lo descifra al enviar. Si el token ya se usó, venció o fue reemplazado, omite el envío.
3. **Desarrollo sin llavero** (fuera de Docker): no se encola nada y el enlace se muestra en la consola del backoffice, como antes. En producción, sin llavero, falla cerrado.
4. **Pantalla:** en producción y staging se ofrece solo con `RECUPERACION_POR_EMAIL=true`. Si no, sigue derivando a un administrador, para no emitir enlaces que nadie recibe. En desarrollo se ofrece siempre.

Rotación del llavero: un email de recuperación encolado con la clave vieja necesita esa versión hasta enviarse. Como vence a los 30 minutos, alcanza con no retirar la versión vieja enseguida (doc 11, paso 4).

## Transporte

| Situación | Transporte | Efecto |
|---|---|---|
| `RESEND_API_KEY` y `RESEND_FROM` | Resend | Envío real. `RESEND_FROM` sin la clave, o con formato inválido, hace fallar el arranque del worker |
| Sin clave, `NODE_ENV` ≠ `production` (desarrollo, Docker, tests) | Falso | No sale nada. La consola del worker muestra destinatario enmascarado, asunto y texto. Evidencia `SIMULADO` |
| Sin clave, `EMAIL_SIMULADO=true` (staging) | Falso | Igual, pero la consola muestra solo el asunto: el texto de una recuperación lleva un enlace de acceso |
| Sin clave en producción | Ninguno | El worker no toma los trabajos `email.*`. Quedan pendientes sin gastar intentos y `/ready` se pone `degradado` a los 5 minutos. Se envían cuando se configura la clave, salvo los que ya no corresponden (se omiten) |

El cliente es `fetch` contra `POST https://api.resend.com/emails`, sin SDK, con tiempo límite de 10 s y etiqueta `tipo` para filtrar en el panel de Resend. La API key nunca aparece en errores ni logs.

## Variables

Todas solo de servidor; nunca con prefijo `VITE_`.

| Variable | Servicio | Uso |
|---|---|---|
| `RESEND_API_KEY` | worker | **Secreto.** API key de Resend con permiso de envío (`sending_access`), idealmente restringida al dominio |
| `RESEND_FROM` | worker | Remitente, p. ej. `Sicurella <turnos@sicurella.com.ar>`. El dominio tiene que estar verificado en Resend |
| `EMAIL_SIMULADO` | worker | `true` para simular sin clave con `NODE_ENV=production` (staging; el IaC lo fija ahí) |
| `NAILNET_CLAVES_CIFRADO`, `NAILNET_CLAVE_ACTIVA` | backoffice y worker | Ya existían (doc 11). El worker las necesita para descifrar el enlace de recuperación. `compose.yaml` ahora también se las pasa al worker local |
| `RESEND_WEBHOOK_SECRET` | backoffice | **Secreto.** `whsec_…` del webhook configurado en Resend |
| `RECUPERACION_POR_EMAIL` | backoffice | `true` para ofrecer «Recuperar acceso» en producción y staging |

`.railway/railway.ts` declara las nuevas con `preserve()` (y `EMAIL_SIMULADO=true` en staging). No se aplicó a Railway: correr `railway config plan` antes de aplicarlo.

## Puesta en marcha (pendiente del usuario)

1. **Dominio:** verificar en Resend el dominio del remitente (SPF y DKIM, y DMARC recomendado), por ejemplo un subdominio `mail.sicurella.com.ar` para no tocar el correo existente. Decidir la dirección: `turnos@…` o `no-responder@…`.
2. Crear una API key con permiso solo de envío y cargar `RESEND_API_KEY` y `RESEND_FROM` en el worker, por ambiente.
3. Crear el webhook en Resend hacia `https://<backoffice>/api/webhooks/resend` con los eventos `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained` y `email.failed`. Cargar su secreto en `RESEND_WEBHOOK_SECRET`.
4. Probar una reserva de recepción con un email propio: llega la confirmación, `EnvioEmail` pasa a `ENVIADO` y después a `ENTREGADO`.
5. Recién entonces, `RECUPERACION_POR_EMAIL=true` en el backoffice.

## Pendiente

- **Envío real y webhook** contra Resend (puesta en marcha, arriba). No se probó con la API real: el cuerpo, los códigos de error y la firma siguen la documentación y el vector de ejemplo de Svix.
- **Bandeja de revisión (M04):** hoy los envíos `FALLIDO`, `REBOTADO` o `QUEJA` y los trabajos fallidos solo se ven en la base. Falta mostrarlos en la ficha del turno y en una bandeja, y poder rearmar un trabajo (un `FALLIDO` propio, sin id de Resend, se vuelve a intentar si se rearma).
- **Rebotes:** un email que rebota no marca al cliente. Falta decidir si se deja de enviarle o se avisa a la sede.
- **Invitaciones de usuario:** el enlace de activación (doc 10) se sigue mostrando a quien lo genera; se puede pasar a este mismo mecanismo.
- **Más emails:** cancelación por enlace (P04), pago o reembolso (M01), recordatorio previo al turno. Cancelación y reprogramación todavía no incluyen enlace para gestionar el turno: el token del invitado solo se guarda hasheado y no se puede reenviar.
- **Retención:** `EnvioEmail` no se purga. Guarda destinatario y asunto como evidencia; definir un plazo junto con la política de datos (D13).
- **Logo y contacto por sede** en las plantillas, cuando existan en el modelo.

## Verificación

- `npm run test:domain` (8 casos nuevos):
  - escape de HTML y limpieza del asunto;
  - fecha y hora en la zona de la sede;
  - las cuatro plantillas;
  - datos maliciosos del cliente;
  - enlaces no `https` rechazados;
  - firma Svix con el vector de ejemplo de la documentación, rotación, datos alterados y ventana de tiempo;
  - mapeo y orden de estados de entrega.
- `npm run test:integrations` (5 casos nuevos):
  - cuerpo y headers del envío, con la clave como `Idempotency-Key`;
  - errores transitorios y permanentes, sin la API key en los mensajes;
  - remitente inválido;
  - transporte falso idempotente.
- `npm run test:database`, `emails.test.ts` sobre Postgres real (144 tests en total, todos verdes):
  - encolado con referencias y sin email del cliente;
  - outbox con rollback;
  - una sola confirmación para dos eventos;
  - envío con marca, escape y evidencia, y repetición sin reenvío;
  - transitorio que se reintenta y después sale;
  - permanente y agotado quedan `FALLIDO`;
  - cancelación que omite la confirmación pendiente;
  - reprogramación con un solo email;
  - turno ya empezado;
  - recuperación con el token cifrado en la cola, y pedido reemplazado que se omite;
  - eventos de entrega que solo avanzan;
  - restricción de la base.
- **Worker** (build de producción): sin clave arranca con transporte simulado; con `RESEND_API_KEY` y sin `RESEND_FROM` no arranca, con un mensaje claro; con ambas arranca.
- `npm run check`.
