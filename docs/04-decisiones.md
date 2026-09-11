# Decisiones que bloquean implementación

Las propuestas siguen pendientes salvo donde se registra una confirmación explícita. No interpretar el tiempo transcurrido como aceptación. Se puede cerrar estructura técnica y documentación mientras se responden; no implementar reglas financieras definitivas con supuestos ocultos.

| ID | Decisión/pregunta | Propuesta o dato necesario | Bloquea |
|---|---|---|---|
| D1 | Nombre del repositorio | Confirmado: repositorio creado por el usuario en https://github.com/lucasfradus/Nailnet; nombre del proyecto NailNet | Resuelto |
| D2 | Cuenta del cliente | Invitado con enlace seguro por email; cuenta posterior opcional | Identidad y portal |
| D3 | Tipo e importe de seña | Fija/porcentual por servicio, excepción por sede; indicar monto o porcentaje inicial | Checkout, snapshots y configuración |
| D4 | Retención | 15 minutos desde intención; sin extensión por reintento; revisión sujeta al mismo vencimiento | Agenda, worker y pagos tardíos |
| D5 | Cancelación/reprogramación | Indicar horas de anticipación, devolución total/parcial/nula, ausencias y cancelación por la sede | Políticas, UI y reembolsos |
| D6 | Reservas de recepción | Confirmar si también exigen MP o hay excepción autorizada y cómo se cobra | Estados y canales |
| D7 | Reembolsos | Propuesta: aprobación manual por rol autorizado, ejecución por sistema y seguimiento; definir pago tardío | Circuito financiero |
| D8 | Cuenta receptora y emisor | Confirmado: cada sede tiene sus propias cuentas de proveedores. Varias sedes pueden usar el mismo CUIT, con puntos de venta diferentes | Resuelto; credenciales pendientes |
| D9 | Facturación | ¿Cada cobro, venta completada, manual o posterior? Definir tratamiento de anticipo/saldo con responsable contable | ComprobanteAplicacion y disparador |
| D10 | Comisiones | Propuesta: servicios atendidos y totalmente cobrados, después de descuento, sin productos/propinas, mensual. Confirmar bruto/neto impositivo y porcentaje | Devengamiento y liquidación |
| D11 | Royalties/fondo/canon | Indicar base (ventas/cobros, bruto/neto, servicios/productos), porcentajes, periodicidad; canon único/periódico | Contratos y cargos |
| D12 | Global versus sede | Propuesta: catálogo/skills/consentimientos globales, precio/horario/recurso locales, reglas comerciales con excepciones permitidas; sin aprobaciones corporativas | Configuración y permisos |
| D13 | Clientes compartidos | Confirmado el 2026-09-10: por ahora los clientes serán compartidos entre franquiciados de la misma organización. El alcance del historial no fue confirmado; se conserva la propuesta de limitarlo a sedes autorizadas | Identidad compartida resuelta; visibilidad del historial pendiente |
| D14 | Capacidad y calendario | ¿50 días corridos/hábiles? ¿Equipo disponible? ¿Sedes/profesionales y volumen del piloto? | Viabilidad, carga y alcance de lanzamiento |

## Escenarios a cerrar con las respuestas

Decisión D8: separar la identidad fiscal (EmisorFiscal/CUIT) de la configuración de cada sede. Dos sedes pueden referenciar al mismo emisor, pero cada una tiene su propio punto de venta y credenciales de proveedor. Compartir CUIT no comparte cuentas, cobros ni permisos. La combinación emisor/punto de venta/ambiente no debe asignarse a dos sedes. El momento de emisión y tratamiento de anticipos siguen pendientes en D9.

Decisión D13: Cliente pertenece a Organizacion, sin propietario franquiciado. ClienteSede vincula su relación con las sedes sin crear una ficha independiente por franquiciado. La identidad compartida no concede automáticamente permisos de edición ni acceso a visitas, pagos u observaciones de otras sedes. Esos permisos y la deduplicación se definirán al implementar el módulo. No compartir clientes entre organizaciones distintas.

- Seña $9.000 en servicio $30.000, luego cambio de precio: conservar precio pactado o regla explícita aceptada; nunca cambiarlo silenciosamente.
- Cliente cancela después del límite: liberar horario y aplicar devolución acordada; no mezclar liberación con éxito de MP.
- MP aprueba después de vencer: propuesta de incidencia/reembolso sin confirmar un horario liberado.
- Servicio atendido pero saldo pendiente: propuesta sin comisión hasta cobro completo; definir si se prefiere prorratear.
- Reembolso luego de liquidación cerrada: ajuste en siguiente período, sin reescribir cierre histórico.

Con las respuestas se versionará esta tabla, se cerrará el modelo y se podrá comenzar la fase 1. La documentación y revisión actuales no dependen de aprobar despliegues ni de contratar servicios.
