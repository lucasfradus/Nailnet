# Decisiones que bloquean implementación

Las propuestas siguen pendientes salvo donde se registra una confirmación explícita. No interpretar el tiempo transcurrido como aceptación. Se puede cerrar estructura técnica y documentación mientras se responden; no implementar reglas financieras definitivas con supuestos ocultos.

| ID | Decisión/pregunta | Propuesta o dato necesario | Bloquea |
|---|---|---|---|
| D1 | Nombre del repositorio | Confirmado: repositorio creado por el usuario en https://github.com/lucasfradus/Nailnet; nombre del proyecto NailNet | Resuelto |
| D2 | Cuenta del cliente | Invitado con enlace seguro por email; cuenta posterior opcional | Identidad y portal |
| D3 | Tipo e importe de seña | Confirmado el 2026-10-01: porcentaje por servicio, definido por el master; la sede puede usar otro valor (o monto fijo como excepción). Sin porcentaje general: un servicio sin seña definida no se ofrece online | Resuelto el mecanismo; valores por servicio a cargar |
| D4 | Retención | Confirmado el 2026-10-01: 15 minutos por defecto, sin extensión por reintento; configurable por organización/sede (`retencionMinutos`) | Resuelto |
| D5 | Cancelación/reprogramación | Pendiente (2026-10-01: «lo definimos después»). Se implementan cancelar y reprogramar sin reembolso automático; devoluciones manuales hasta definir horas y porcentaje | Reembolsos automáticos |
| D6 | Reservas de recepción | Confirmado el 2026-10-01: configurable por sede, por defecto confirma directo sin seña; la sede puede exigir seña por Mercado Pago | Resuelto |
| D7 | Reembolsos | Propuesta: aprobación manual por rol autorizado, ejecución por sistema y seguimiento. Pago tardío confirmado el 2026-10-12: si el horario sigue libre se confirma; si no, el pago queda a devolver con revisión manual (ver 23-pagos-mercadopago.md) | Circuito financiero; pago tardío resuelto |
| D8 | Cuenta receptora y emisor | Confirmado: cada sede tiene sus propias cuentas de proveedores. Varias sedes pueden usar el mismo CUIT, con puntos de venta diferentes | Resuelto; credenciales pendientes |
| D9 | Facturación | ¿Cada cobro, venta completada, manual o posterior? Definir tratamiento de anticipo/saldo con responsable contable | ComprobanteAplicacion y disparador |
| D10 | Comisiones | Propuesta: servicios atendidos y totalmente cobrados, después de descuento, sin productos/propinas, mensual. Confirmar bruto/neto impositivo y porcentaje | Devengamiento y liquidación |
| D11 | Royalties/fondo/canon | Indicar base (ventas/cobros, bruto/neto, servicios/productos), porcentajes, periodicidad; canon único/periódico | Contratos y cargos |
| D12 | Global versus sede | Propuesta: catálogo/skills/consentimientos globales, precio/horario/recurso locales, reglas comerciales con excepciones permitidas; sin aprobaciones corporativas | Configuración y permisos |
| D13 | Clientes compartidos | Confirmado el 2026-09-10: por ahora los clientes serán compartidos entre franquiciados de la misma organización. El alcance del historial no fue confirmado; se conserva la propuesta de limitarlo a sedes autorizadas | Identidad compartida resuelta; visibilidad del historial pendiente |
| D14 | Capacidad y calendario | ¿50 días corridos/hábiles? ¿Equipo disponible? ¿Sedes/profesionales y volumen del piloto? | Viabilidad, carga y alcance de lanzamiento |
| D15 | Reserva con varios servicios | Confirmado el 2026-09-30: el esquema de reservas admite varios servicios consecutivos, cada uno con su profesional e intervalo. La UI del portal lo habilita en una etapa posterior | Resuelto; modelo Reserva 1:N ítems |
| D16 | Elección de profesional | Confirmado el 2026-09-30: opcional; «cualquiera» por defecto con asignación balanceada dentro del motor | Resuelto; portal y motor |
| D17 | Grilla de inicio de turnos | Pendiente. Modelado el 2026-10-01 como parámetro heredable `pasoGrillaMinutos` sin valor por defecto: sin definirlo la sede no genera turnos (ver 15-disponibilidad.md). El sistema actual usa paso fijo de 60 min; se busca una definición prolija (configurable por sede y/o derivada de duración y buffers) | Motor de disponibilidad (C04) |
| D18 | Horizonte y anticipación | Confirmado el 2026-09-30: horizonte máximo y anticipación mínima configurables por sede. Valores iniciales pendientes (referencia del sistema actual: ~14 días) | Resuelto el criterio; valores con D12 |
| D19 | Operación de recepción: clientes sin turno, comanda, caja | Confirmado por Sicurella el 2026-10-14 (reunión con el usuario): ver «Respuestas de Sicurella · 2026-10-14» abajo y 27-ventas-caja.md | Resuelto |

## Respuestas de Sicurella · 2026-10-14

Relevadas por el usuario en una reunión con Sicurella. Confirmado por Sicurella; aplicadas en O01/O02 (27-ventas-caja.md).

- **Cómo operan:**
  - muchos clientes llegan sin turno;
  - recepción los deriva a una profesional;
  - la profesional hace los trabajos y entrega una comanda en papel con los trabajos realizados y el valor;
  - recepción la carga y cobra.
  - **Se cobra siempre después de atender.**
- **«Atender ahora»:** el cliente sin turno entra al sistema al llegar.
  - Recepción elige profesional y servicios, y se crea un turno que arranca en ese momento y ocupa la agenda (el portal deja de ofrecer ese horario).
  - Si la profesional está ocupada, se rechaza.
  - Queda marcado como «sin turno previo» para reportes.
- **Comanda al cobrar** (cualquier turno atendido):
  - recepción agrega o quita los servicios realmente hechos, con la profesional de cada uno (para comisiones, L01);
  - el precio de cada servicio es editable: se propone el de lista y se guardan el de lista y el cobrado;
  - un servicio agregado no re-reserva agenda.
- **Recepción:**
  - puede anular ventas;
  - ve y registra gastos de su sede pagados desde la caja;
  - la anulación de gastos sigue en administración de sede, franquiciado o master.
- **Vuelto:** no se registra. **Puestos de cobro:** uno por sede. **Descuentos:** sin tope ni restricción de rol.
- **Arqueo no ciego:**
  - el esperado se muestra;
  - con diferencia, la observación del cierre es obligatoria;
  - los faltantes los revisan recepción y franquiciado, que ven el historial de cierres de su sede (con filtro de diferencias).
- **Stock:** es «prácticamente virtual» (un esmalte rinde unos 50 servicios y dura años).
  - Al anular una venta, el stock no se repone por defecto.
  - El flujo de servicios no depende del stock.
- **Facturación (D9):** sigue sin definir; no cambia nada.

## Escenarios a cerrar con las respuestas

Decisión D8: separar la identidad fiscal (EmisorFiscal/CUIT) de la configuración de cada sede. Dos sedes pueden referenciar al mismo emisor, pero cada una tiene su propio punto de venta y credenciales de proveedor. Compartir CUIT no comparte cuentas, cobros ni permisos. La combinación emisor/punto de venta/ambiente no debe asignarse a dos sedes. El momento de emisión y tratamiento de anticipos siguen pendientes en D9.

Decisión D13: Cliente pertenece a Organizacion, sin propietario franquiciado. ClienteSede vincula su relación con las sedes sin crear una ficha independiente por franquiciado. La identidad compartida no concede automáticamente permisos de edición ni acceso a visitas, pagos u observaciones de otras sedes. Esos permisos y la deduplicación se definirán al implementar el módulo. No compartir clientes entre organizaciones distintas.

- Seña $9.000 en servicio $30.000, luego cambio de precio: conservar precio pactado o regla explícita aceptada; nunca cambiarlo silenciosamente.
- Cliente cancela después del límite: liberar horario y aplicar devolución acordada; no mezclar liberación con éxito de MP.
- MP aprueba después de vencer: propuesta de incidencia/reembolso sin confirmar un horario liberado.
- Servicio atendido pero saldo pendiente: propuesta sin comisión hasta cobro completo; definir si se prefiere prorratear.
- Reembolso luego de liquidación cerrada: ajuste en siguiente período, sin reescribir cierre histórico.

Con las respuestas se versionará esta tabla, se cerrará el modelo y se podrá comenzar la fase 1. La documentación y revisión actuales no dependen de aprobar despliegues ni de contratar servicios.
