# Sistema de reservas actual · Sicurella Pilar · 2026-09-30

Sicurella es el cliente de NailNet (confirmado el 2026-10-05). Este análisis describe el sistema de reservas que usa hoy, como referencia para el reemplazo.

## Alcance y evidencia

Ingeniería inversa de https://sicurella.com.ar/calendario. Se descargaron el HTML, los bundles JS públicos y se consultaron los mismos endpoints de lectura que usa el navegador: configuración, catálogo, profesionales y disponibilidad. No se crearon reservas, no se enviaron formularios ni se invocaron endpoints de escritura; los flujos de reserva y pago se derivan del código cliente, no de ejecutarlos. No se registran nombres de profesionales ni datos de clientes.

## Plataforma

- El sitio es una SPA React/Vite generada con el builder «Vibe» de GoHighLevel. `/calendario` solo embebe un iframe: `https://api.leadconnectorhq.com/booking/sicurella`.
- El widget es el módulo **Services v2 de GoHighLevel/LeadConnector** (Nuxt/Vue), un SaaS genérico configurado, no un desarrollo propio. Location (sub-account) `T6sj4yD5XkutkLVty5ek`.
- API usada por el widget (base `https://backend.leadconnectorhq.com`, headers `channel: APP`, `source: WEB_USER`, `version: 2021-04-15`):

| Paso | Endpoint | Uso |
|---|---|---|
| Configuración | `GET calendars/global-settings/services?subAccount=` | Pasos del wizard, moneda, políticas, estilo |
| Catálogo | `GET calendars/bookings/options?locationId=` | Servicios, categorías, sedes, staff habilitado y precios |
| Staff | `POST calendars/bookings/staff {userIds, serviceIds}` | Nombres/fotos de profesionales |
| Disponibilidad | `POST calendars/bookings/availability` | Slots del mes para el carrito completo, con proveedores disponibles |
| Cupón | `POST calendars/bookings/verify-coupon` | Descuentos |
| Crear | `POST calendars/bookings/initiate` (multipart `formData`) | Crea contacto + booking pendiente + orden; 429 activa reCAPTCHA |
| Pago | Stripe/PayPal/Authorize.net embebido, `verify-general-payment` | Verificación de intent en servidor |
| Confirmar | `POST calendars/bookings/confirm/{id} {paymentStatus: completed}` | Llamado desde el navegador tras verificar el pago |
| Gestión | `GET details/widget/{id}`, `PUT reschedule/{id}`, `POST cancel/{id}` | Enlaces de autogestión por `service_booking_id` |

## Datos observados

- **1 sede** («Sicurella Del viso»), sin franquicias ni multi-sede (`enableMultipleLocations: false`).
- **115 servicios** en 5 categorías: Nails 30, Tratamientos Corporales 36, Tratamientos Faciales 28, Depilación 16, Cejas & Pestañas 5. Sin variantes ni adicionales en uso.
- **36 profesionales**; cada servicio tiene entre 1 y 23 habilitadas. Todas reservables online.
- Duraciones de 5 a 120 min; la más común es 50 min (42 servicios).
- **Precio por profesional**: el campo existe, pero ningún servicio tiene dos precios distintos no nulos. En la práctica el precio es único por servicio; el `0` por profesional equivale a «sin override».
- **Seña** fija en pesos por servicio (`depositType: amount`): 109 servicios con seña = 100% del precio, 2 parciales (~83–85%), 2 en 0 y 2 sin definir. Sin embargo `isLivePaymentMode: false`, `paymentProvider: null` y `paymentOption: onsite`: **hoy no cobran online**. El mensaje final dice «nos pondremos en contacto para confirmarla», así que la reserva funciona como solicitud.
- Cupones habilitados; precios mostrados como rango.
- Cancelación y reprogramación sin límite de anticipación (`expiryTime: 0`).
- Formulario: nombre, apellido, email, teléfono, notas y consentimiento **de marketing** (no de práctica). Contacto «pegajoso» por cookie. Pixel de Facebook.

## Motor de disponibilidad (comportamiento medido)

- **Grilla fija de 60 minutos**: los servicios de 20 y de 50 min ofrecen los mismos inicios, 09:00 a 19:00. La duración no determina el paso de la grilla.
- **Horizonte de ~14 días**: más allá devuelve `400 No available booking times within the allowed scheduling window`. Existe además un aviso mínimo (`skipSchedulingNotice`).
- Domingo cerrado; lunes a sábado 9 a 20 h.
- **Jornadas por profesional**: a las 9 y 10 h hay menos profesionales disponibles que al mediodía (turnos escalonados).
- **Excepciones**: el lunes 12/10 (feriado) quedan 1–2 profesionales en lugar de 7.
- **«Cualquiera» por defecto** (`allowStaffSelection: false`): cada slot trae `availableProviders` y un `staffId` preasignado. La distribución en un mes es pareja (13–17 slots por profesional), lo que indica un balanceo de carga.
- **Carrito multi-servicio** (`enableAddMultipleServices: true`): dos servicios se encadenan consecutivamente (09:00–09:50 y 09:50–10:40), **cada uno con su propia profesional**, en un único booking.
- Recursos físicos (cabinas/máquinas) no se usan: `enableMultipleResources: false`, `availableResources: []`.
- Retención: el booking se crea en `initiate` antes del pago; el cliente guarda el estado pendiente 10 minutos (`sessionStorage`, 600.000 ms).

## Contraste con el plan de NailNet

| Tema | Sistema actual | Plan NailNet | Recomendación |
|---|---|---|---|
| Multi-sede/franquicia | No existe | Núcleo del modelo | Diferencial; mantener |
| Selección de profesional | Oculta; «cualquiera» con asignación balanceada | Paso obligatorio sede → servicio → profesional | Profesional opcional con «cualquiera» por defecto; criterio de menor carga ya previsto en arquitectura |
| Varios servicios por turno | Sí, consecutivos, profesional por servicio | Excluido del MVP (1 servicio, 1 profesional) | **Revisar**: es el caso típico «manos + pies». Modelar ya Reserva 1:N ítems con intervalo y profesional propios, aunque la UI lo habilite después |
| Grilla de inicio | Paso fijo de 60 min | No definido | Agregar paso de grilla configurable por sede (y opcional por servicio), separado de duración y buffers |
| Horizonte/aviso mínimo | ~14 días + aviso mínimo | «anticipación permitida» | Explicitar horizonte máximo y anticipación mínima por sede |
| Precio por profesional | Soportado, no usado | Precio por sede, independiente del profesional | Validado para MVP |
| Seña | Monto fijo por servicio, frecuentemente 100% | D3 pendiente (fija/porcentual) | Soportar monto fijo y porcentaje; admitir 0 (sin seña) |
| Cobro online | Configurado pero apagado; confirmación manual | Seña MP obligatoria y confirmación por webhook | Diferencial real; evaluar un modo «solicitud sin seña» por servicio/sede (relacionado con D6) |
| Retención | ~10 min, del lado cliente | 15 min en servidor | Mantener servidor; D4 puede ser 10–15 min |
| Confirmación de pago | El navegador llama `confirm`/`payment-status` | Solo webhook + consulta al proveedor | Mantener: no copiar confirmación desde el cliente |
| Autogestión | Booking ID en la URL funciona como credencial | Token acotado, hasheado, con vencimiento | Mantener |
| Políticas de cancelación | Sin límite | D5 pendiente | Definir; el sistema actual no ofrece referencia |
| Recursos | No usados | Recursos por tipo/unidad | Mantener en modelo; permitir servicios sin requisitos para no frenar la carga del catálogo |
| Consentimiento | Solo marketing | Consentimiento por práctica versionado | Diferencial; separar además consentimiento de marketing |
| Cupones | Sí | No contemplado | Fuera del MVP salvo pedido del negocio |
| Anti-abuso | 429 → reCAPTCHA | Límites durables | Agregar desafío CAPTCHA escalonado ante 429 |
| Categorías | 5 categorías con imagen | CategoriaServicio | Validado |

## Decisiones propuestas a partir del análisis

Ninguna se considera aprobada sin confirmación del usuario.

1. Reserva multi-servicio: ¿se incluye en el MVP o solo se prepara el esquema?
2. Selección de profesional: ¿opcional con «cualquiera» por defecto?
3. Paso de grilla: ¿60 min fijo por sede como el sistema actual, o derivado de la duración?
4. Horizonte de reserva: ¿14 días? ¿Anticipación mínima?
5. Modo sin seña/solicitud: ¿se permite por servicio o sede, o la seña MP es siempre obligatoria (D3/D6)?
