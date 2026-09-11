# Backlog inicial — objetivo de 50 días

Calendario relativo, pendiente de confirmar días corridos/hábiles, equipo y tamaño del piloto. Es un objetivo de planificación, no una garantía de plazo. Facturante y franquicias básicas están incluidas explícitamente; no quedarán ocultas detrás de reportes al final. Tests se implementan junto a cada módulo.

## Fase 0 · cierre de diseño · antes de implementar

| ID | Entrega | Aceptación/dependencias |
|---|---|---|
| D01 | Resolver `04-decisiones.md` | Políticas numéricas, cuenta receptora/emisor, propiedad de datos y nombre registrados |
| D02 | Aprobar modelo y alcance del piloto | Entidades, estados, matriz permisos y ejemplos seña/saldo/reembolso revisados |
| D03 | Accesos de prueba a proveedores | Cuentas sandbox, datos de emisor y dominio email disponibles; secretos fuera del repo |

## Fase 1 · días 1–5 · fundación

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| F01 | Monorepo, Next, Vite, TypeScript, Prisma/PostgreSQL | Builds independientes, lint/typecheck y CI; dependencias fijadas; no secretos en bundle |
| F02 | Organización, franquiciado, sede, usuarios | Migración reproducible y seed sintético; relaciones entre organizaciones inválidas rechazadas |
| F03 | Login, logout y recuperación | Hash de contraseña, token de un uso, límites de intentos, usuario inactivo rechazado; sin rol implícito |
| F04 | Staging, worker y outbox base | Job persiste/reanuda tras reinicio; health checks y documentación de variables |
| F05 | Prueba temprana MP/Facturante | Contratos y credenciales de prueba funcionan; documentar deduplicación/consulta de resultados ambiguos |

Dependencias: D01–D03. Si falla el acceso a proveedores, completar base local y elevar ese bloqueo del calendario, sin simular integración como terminada.

## Fase 2 · días 6–10 · permisos y sedes

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| A01 | Roles y alcances | Master/franquiciado/admin/recepción/profesional; pruebas de acceso cruzado por ID en lectura y escritura |
| A02 | CRUD sede, usuarios y selector | Recepción con varias sedes; selector no amplía alcance; franquiciado ve consolidado de sus sedes |
| A03 | Configuración y secretos por sede | Herencia/excepciones según D01; cifrado y secretos redactados en logs/respuestas |

## Fase 3 · días 11–16 · catálogo y disponibilidad

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| C01 | Clientes y consentimientos versionados | Sin datos médicos/fotos; contacto invitado; alcance e historial según política; aceptación por práctica |
| C02 | Servicios y precios por sede | Duración, skills, recursos y seña validados; precio independiente del profesional |
| C03 | Profesionales y recursos | Multi-sede, habilidades, habilitaciones, jornadas, pausas y bloqueos |
| C04 | Motor de disponibilidad | Intervalo completo con todos los recursos; bloqueos entre sedes; feriados y buffers; «cualquiera» compatible |
| C05 | Prueba de exclusión PostgreSQL | Dos conexiones intentan mismo profesional o recurso: solo una retención gana; intervalos contiguos válidos |

Dependencias: A01–A03. C05 es una puerta de salida de fase, no una prueba diferida al día 47.

## Fase 4 · días 17–24 · reservas y primer flujo de pago

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| R01 | Agenda y reserva manual | Día/semana, filtros, reserva por motor común; sin sobreocupación |
| R02 | Retenciones y vencimientos | Worker reiniciado no deja retenciones perpetuas; carrera vencimiento/aprobación resuelta |
| R03 | Cancelar/reprogramar/atender/ausente | Historial conservado; reprogramación atómica y política congelada |
| R04 | Checkout MP y webhook en staging | Firma, cuenta/monto/moneda/referencia; aprobación idempotente; retorno manipulado no confirma |
| R05 | Contrato público y protección de invitado | Validación backend, claves idempotentes, límites contra acaparamiento, tokens acotados |

Dependencias: C04–C05 y F05. Primer recorrido reserva-seña-confirmación antes de construir todo el portal.

## Fase 5 · días 25–31 · portal y comunicaciones

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| P01 | Portal separado responsive | Sede → servicio → profesional → horario → datos → seña → confirmación |
| P02 | Estado real de reserva | Consulta backend tras retorno; UX para pendiente, conflicto, rechazo y expiración |
| P03 | Emails Resend | Confirmación/cancelación/reprogramación y recuperación; job reintentable y evidencia de entrega/resultado |
| P04 | Cancelación por enlace y revisión de reembolso | Token válido y política aplicados; devolución no se marca completa por solicitud enviada |

## Fase 6 · días 32–36 · robustez financiera y facturación

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| M01 | Reembolsos y reconciliación | Parcial/total, callback duplicado/desordenado, pago tardío y duplicado; saldo no excedido |
| M02 | Facturante completo según política | Emisión, consulta, PDF/referencia, nota de crédito y reintentos; timeout ambiguo no reemite a ciegas |
| M03 | Aplicación seña/saldo | Ejemplo $30.000/$9.000/$21.000 produce venta y cobros correctos sin doble ingreso |
| M04 | Operación de incidencias | Roles habilitados pueden revisar jobs/pagos/comprobantes fallidos con trazabilidad |

## Fase 7 · días 37–42 · operación de sede

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| O01 | Cobros manuales y ventas mixtas | Efectivo/transferencia/tarjeta/MP; productos con servicios; anticipo aplicado |
| O02 | Caja y cierres | Apertura, entradas/salidas, diferencia y reversos; digitales no inflan efectivo esperado |
| O03 | Compras, stock y consumo interno | Stock por sede, cantidades fraccionarias, movimientos; venta concurrente no produce negativo |
| O04 | Gastos | Categorías y sede, egreso trazable, anulación por reverso |

## Fase 8 · días 43–46 · liquidaciones e informes

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| L01 | Comisión y liquidación profesional | Base/porcentaje versionados, servicio elegible único, ajuste por reembolso |
| L02 | Royalties, canon y fondo básicos | Configuración y cálculo por período según política; no duplica al recalcular; cierre preservado |
| L03 | Reportes y CSV | Ventas, cobros, ocupación, atendidos/cancelados/ausentes, nuevos/recurrentes, ticket, comisiones, caja/gastos/stock |
| L04 | Consolidados | Comparativa sedes, franquiciado y master; exportación no revela sedes ajenas |

## Fase 9 · días 47–50 · piloto

| ID | Entrega | Criterio de aceptación |
|---|---|---|
| Q01 | E2E y regresión | Reserva invitada/manual, rechazo, pago tardío, devolución, atención, saldo, factura y cierre |
| Q02 | Pruebas de fallos y carga | Reinicio durante jobs; webhook duplicado; concurrencia de agenda/stock; carga acordada del piloto |
| Q03 | Producción | Migración ensayada, backup/restauración, credenciales de producción, smoke tests y alertas |
| Q04 | Documentación y capacitación | Manual recepción/master, procedimiento de incidencias y conciliación, responsable del piloto |

## Condiciones de salida y contingencia

No habilitar reservas pagas si faltan exclusión concurrente, alcance de permisos, confirmación validada o reconciliación. No considerar Facturante aprobado solo por proforma de testing; verificar operación requerida en el ambiente correspondiente. El piloto exige saldos/cobros correctos y recuperación ante caída.

Si el calendario queda corto, negociar reducir personalización visual, variedad de reportes y automatización de liquidaciones; mantener exportación y cálculo trazable. No retirar requisitos imprescindibles sin decisión del usuario. Trabajo fuera del MVP: app móvil, marketplace, WhatsApp API, grupos/recurrentes/lista de espera, membresías/bonos/regalos/fidelidad, fotos/historias clínicas, marketing avanzado, POS y franquicias avanzadas.
