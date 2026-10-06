# Portal de reservas · 2026-10-05

Implementa P01 sobre la API pública de R05 (doc 18). El portal (`apps/booking`, React/Vite) solo importa `@nailnet/contracts`; no tiene secretos ni acceso a la base.

## Recorrido

Sede → servicio → profesional → día y horario → datos → estado de la reserva.

- **Sede:** si la organización tiene una sola, se elige sola y el recorrido empieza en servicio.
- **Servicio:** agrupado por categoría, con duración, precio y seña. Solo aparecen los reservables online (D3: sin seña definida no se ofrece).
- **Profesional:** «Cualquier profesional» primero (D16). Con «cualquiera» el portal no fija profesional al reservar: el backend vuelve a asignar uno libre bajo lock.
- **Día y horario:** 14 días desde hoy en la zona de la sede. Anticipación y horizonte los aplica el backend; un día fuera del horizonte viene sin turnos. Las horas se muestran en la zona de la sede, no en la del navegador.
- **Datos:** nombre, apellido opcional, email y teléfono. Los términos vigentes se muestran desplegables antes del checkbox. El cuerpo se valida con `validarReservaPublica` del contrato antes de enviar; el backend vuelve a validar.
- **Estado:** siempre consultado al backend con el token; el portal nunca confirma por su cuenta. Con `PENDIENTE_PAGO` muestra la cuenta regresiva de la retención (D4) y, al llegar a cero, vuelve a consultar (el backend informa `EXPIRADA` aunque el worker no haya pasado). Con `EXPIRADA` ofrece volver a los horarios con la misma elección.

Volver atrás conserva lo elegido y los datos cargados. El resumen muestra lo elegido en los pasos anteriores.

Las fotos de servicios y profesionales, la portada y el comprobante con imágenes se describen en [20-imagenes.md](20-imagenes.md).

## Envío e idempotencia

- **Clave:** una `Idempotency-Key` (UUID) por intento. Se conserva mientras el contenido no cambie: reintentar tras un corte de red devuelve la misma reserva en vez de duplicarla. Si cambia el contenido, es un intento nuevo con otra clave.
- **409 `NO_DISPONIBLE`:** vuelve a horarios con el aviso «Ese horario se acaba de ocupar» y la lista actualizada.
- **409 `CONFLICTO_IDEMPOTENCIA`:** pide esperar unos segundos (la primera solicitud sigue en curso).
- **422:** muestra el mensaje del backend. Como el backend recuerda el 422 para esa clave, el siguiente intento usa otra.
- **429 y errores de red:** muestra el mensaje y permite reintentar.

## Token del invitado

Se guarda en `sessionStorage` junto con la zona de la sede: sobrevive a recargar la pestaña (y a volver de Mercado Pago en R04), pero no queda en el navegador después de cerrarla. El acceso posterior llega con el enlace por email (P03). Va en `Authorization`, nunca en la URL. Si el token venció o fue reemplazado, el portal informa que no encuentra la reserva y ofrece empezar de nuevo.

## Términos

Nuevo endpoint `GET /api/public/v1/organizaciones/{slug}/terminos`: última versión de cada consentimiento de tipo `TERMINOS`, la misma consulta que registra la aceptación al reservar. Los de tipo `PRACTICA` no se publican. 404 si la organización no existe o está inactiva.

## Configuración

Variables públicas de Vite (terminan en el bundle; nunca poner secretos):

| Variable | Uso | Predeterminado |
|---|---|---|
| `VITE_API_URL` | Origen del backoffice que sirve la API pública | `http://localhost:3000` |
| `VITE_ORGANIZACION` | Slug de la organización | `demo` |

El backoffice debe permitir el origen del portal con `PORTAL_ORIGIN` (doc 18).

## Datos de demo

El seed agrega un catálogo para recorrer el portal (`prisma/demo-catalogo.ts`), también sobre una demo creada antes, siempre que la organización no tenga servicios:

- **Centro y Norte:** semipermanente (seña 30 %), kapping gel (30 %, requiere la skill Gel), belleza de pies (seña fija $5.000) y retiro sin seña, que no aparece online. Horario de lunes a viernes de 9 a 20 y sábados de 9 a 14.
- **Profesionales:** Ana trabaja en Centro y Norte en días distintos; Bea solo en Centro y sin la skill Gel; Carla en Norte.
- **Sur:** sin catálogo online, para ver el estado vacío.
- **Organización:** grilla de 30 min, horizonte 14 días, anticipación 2 h y términos de demostración. Son valores de demo, no política: D17 y D18 siguen pendientes.

Para cargarlo en una base Docker existente: `docker compose run --rm setup` (o `npm run db:seed` con `DATABASE_URL` y `ALLOW_DEMO_SEED=true`).

## Pendiente

- **Seña:** el botón «Reservar» deja la reserva `PENDIENTE_PAGO`; el pago por Mercado Pago y su retorno llegan con R04. La pantalla de estado ya informa la retención y consulta el backend (base para P02).
- **Varios servicios:** el contrato y el backend admiten hasta 4 encadenados (D15); el portal ofrece uno por reserva.
- **Términos al reservar:** se acepta la versión vigente al enviar. Si se publica una nueva entre la lectura y el envío, se registra la nueva; evaluar enviar la versión leída si el contenido legal lo exige.
- **Captcha:** sin implementar; evaluar con tráfico real (doc 18).

## Verificación

- `npm run lint`, `npm run typecheck` y build del portal.
- `npm run test:database`: 105 tests; el de R05 suma términos públicos (solo última versión, solo `TERMINOS`, slug inexistente). El seed se ejecuta dos veces: la segunda no modifica el catálogo.
- Recorrido en Chrome headless (390 px y 1280 px) contra Docker: catálogo sin el servicio sin seña, profesionales aptos según skill, horarios con anticipación, términos obligatorios, reserva `PENDIENTE_PAGO` con cuenta regresiva de 15:00, recarga conserva la reserva, sede sin catálogo, y carrera con otra persona que toma el mismo horario → aviso y lista actualizada. Sin scroll horizontal a 360 px.
