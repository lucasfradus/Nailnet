# API pública del portal · 2026-10-01

Implementa R05. Migración `202610010010_portal_publico`. Contrato en `packages/contracts/src/publico.ts`, que el portal importa sin dependencias. Lógica en `packages/database/src/publico.ts`. Rutas delgadas en el backoffice bajo `/api/public/v1`.

## Endpoints

| Método y ruta | Uso | Respuestas |
|---|---|---|
| `GET /organizaciones/{slug}/sedes` | Sedes activas de la organización | 200, 404 |
| `GET /sedes/{sedeId}/servicios` | Solo servicios reservables online (habilitados, con precio y seña definida, D3) | 200, 404 |
| `GET /sedes/{sedeId}/profesionales?servicioId=` | Profesionales aptos; nombre e inicial del apellido | 200, 404 |
| `GET /sedes/{sedeId}/disponibilidad?fecha=&servicio=&profesional=` | Turnos con reglas online (anticipación, horizonte). `servicio` y `profesional` se repiten en orden para varios servicios; sin IDs de recursos | 200, 404, 422 |
| `POST /reservas` + `Idempotency-Key` | Reserva invitada | 201, 409, 422, 429 |
| `GET /reservas/actual` + `Authorization: Bearer <token>` | Estado de la reserva del invitado | 200, 404 |

- **Errores:** siempre `{ error: { codigo, mensaje } }` con `INVALIDO`, `NO_DISPONIBLE`, `CONFLICTO_IDEMPOTENCIA`, `LIMITE`, `NO_ENCONTRADO` o `INTERNO`. Un error interno no expone detalles.
- **Recursos inexistentes o ajenos:** 404, sin distinguir uno de otro.
- **Caché:** todas las respuestas son `no-store`.
- **Organización pública:** se identifica por `slug`, nuevo y opcional, formato con `CHECK`. El seed de demo usa `demo`.

## Reserva invitada (D2)

- **Validación:** primero la estructural (contrato), después la de negocio en el servidor (cliente, catálogo, motor).
- **Cliente:** se busca por email en la organización. Si existe, se usa **sin modificar** sus datos (D13): desde el portal no se puede pisar la identidad de otra persona. Si no existe, se crea. Queda vinculado a la sede.
- **Términos:** si la organización publicó consentimientos de tipo `TERMINOS`, se registra su aceptación con canal `PORTAL` y evidencia mínima (hash de la IP y clave de idempotencia).
- **Estado inicial** (doc 17): con seña, `PENDIENTE_PAGO` por 15 minutos (D4); sin seña, `CONFIRMADA`. El cobro de la seña llega con R04.
- **Token del invitado:**
  - opaco, de 32 bytes, guardado solo como hash;
  - vence 7 días después del último servicio y es revocable;
  - se envía en el header `Authorization`, nunca en la URL, para que no quede en logs ni en `Referer`;
  - la consulta devuelve estado, sede, servicios, profesional (solo nombre), horarios y seña, sin datos de contacto;
  - una retención vencida se informa como `EXPIRADA` aunque el worker no haya pasado todavía.

## Idempotencia

`Idempotency-Key` es obligatoria (16 a 100 caracteres; el portal genera una por intento de reserva).

- **Misma clave y mismo contenido:** misma respuesta. Para una reserva creada se devuelve la misma reserva con un **token nuevo**, y se revocan los anteriores. Así nunca se guarda un token en claro.
- **Misma clave con otro contenido:** 409 `CONFLICTO_IDEMPOTENCIA`. Si la primera solicitud sigue en curso, también 409.
- **Resultados que se recuerdan:** 201, 409 por horario no disponible y 422. Los 429 y los errores internos liberan la clave para poder reintentar más tarde.
- **Vida:** las claves duran 24 horas.

## Anti-acaparamiento

Son valores técnicos propuestos en `POLITICA_PUBLICA`, para ajustar con tráfico real.

- **Por IP:** 20 intentos de reserva cada 10 minutos, con registro durable (`EventoPublico`, solo hashes). Solo aplica si `TRUST_PROXY=true`; sin un proxy confiable no se puede leer la IP real.
- **Por contacto:** como máximo 2 turnos pendientes de pago vigentes por email. Con el tope alcanzado no se toman más turnos con ese contacto, tampoco gratuitos.
  - El conteo corre **dentro de la transacción del turno**, serializado por email: tres solicitudes en paralelo dejan 2 creadas y 1 rechazada (probado).
- **Captcha escalonado:** fuera de esta etapa; se evaluará con el portal (P01) si el abuso lo justifica.

## CORS y despliegue

- **Variables:**
  - `PORTAL_ORIGIN`: único origen con CORS. En desarrollo, `http://localhost:5173`. En producción, sin esta variable no hay CORS.
  - `TRUST_PROXY=true`: solo detrás de un proxy propio que fije `X-Forwarded-For`.
- **Límites de la protección:** CORS no autoriza nada; cada operación valida igual en el servidor. El cuerpo JSON tiene tope de 10 KB.

## Pendiente

- **Seña:** cobro por Mercado Pago, confirmación por webhook y pago que llega tarde (R04, requiere credenciales sandbox).
- **Gestión del invitado:** cancelar o reprogramar con el token, sujeto a D5.
- **Emails:** confirmación con el enlace del token (P03).
- **Limpieza:** de `EventoPublico` y claves de idempotencia vencidas, como tarea del worker.

## Verificación

- `npm run test:database`: 105 tests. Los de R05 cubren:
  - catálogo público y organización inactiva;
  - reserva invitada con términos, token hasheado, consulta sin datos de contacto y vencimiento informado;
  - idempotencia (reintento, rotación de token, conflicto);
  - 409 recordado;
  - identidad existente intacta;
  - límite por contacto en paralelo, también para turnos sin seña;
  - límite por IP con la clave liberada;
  - 422.
- Smoke HTTP sin base:
  - sin token → 404 `no-store`;
  - sin `Idempotency-Key` → 422;
  - preflight desde un origen ajeno sin CORS.
- E2E HTTP con PostgreSQL embebido y `next dev`:
  - sedes por slug con CORS del portal;
  - servicios con precio y seña;
  - disponibilidad;
  - POST 201 pendiente con seña $9.000;
  - reintento idempotente con la misma reserva;
  - otro contenido → 409;
  - otra persona en el mismo horario → 409 `NO_DISPONIBLE`;
  - token anterior revocado.
- Durante la verificación el smoke detectó que la ruta de consulta abría la conexión antes de validar el token (500 sin base). Ahora valida el formato primero.
