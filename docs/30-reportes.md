# Reportes · 2026-10-22

> Era el doc 29; se renumeró a 30 el 2026-10-23 porque el 29 es el tablero de recepción.

Primera parte de L03: pantalla **Reportes** del backoffice para la sede elegida arriba y un período de fechas locales (por defecto el mes en curso, hasta 366 días). Cada tabla se descarga en CSV. Caja, gastos y stock del período quedan para la segunda parte; los consolidados entre sedes son L04.

Código: `packages/domain/src/reportes.ts` (prorrateo, porcentajes, CSV), `packages/database/src/reportes.ts` (`reporteSede`), `apps/backoffice/src/app/(panel)/reportes/` (pantalla, `tablas.ts` y `csv/route.ts`).

## Quién lo ve

Permiso nuevo `reporte:leer`, con tabla propia como ventas y gastos: master, franquiciado y administración de sede, cada uno en su alcance. Recepción y profesional no (confirmado por el usuario el 2026-10-22): recepción opera las ventas y la caja del día, pero no ve totales del período ni comisiones. El repositorio vuelve a autorizar la sede; un ID fuera del alcance es «no encontrado», también en el CSV.

## Definiciones

Cada sección tiene su propia fecha de corte, indicada en pantalla. Las definiciones siguen [02-arquitectura](02-arquitectura.md#reportes-y-definiciones).

| Sección | Fecha de corte | Qué cuenta |
|---|---|---|
| Ventas | Fecha de la venta | Ventas no anuladas, netas de descuento. El descuento de la venta se prorratea entre sus líneas por subtotal (los centavos de redondeo van a la línea con mayor resto) para repartir por servicio, profesional y productos. Las anuladas se informan aparte. |
| Ticket promedio | Fecha de la venta | Total de las ventas cobradas completas ÷ cantidad de ventas cobradas completas. Sin ventas completas: «—». |
| Cobros | Fecha del cobro | Por medio: cobrado, revertido (reversos de ventas anuladas o cobros corregidos) y neto. Las señas de Mercado Pago aprobadas en el período van aparte: en la venta se aplican como anticipo, no como cobro, así que no se suman dos veces. |
| Turnos | Inicio del primer servicio de la reserva | Atendidos, ausentes, cancelados, confirmados sin marcar y pendientes de pago forman el total. Una reprogramación cancela la reserva original y crea otra: la original se informa como reprogramada y no suma. Las retenciones vencidas tampoco suman. Ausentismo = ausentes ÷ (atendidos + ausentes); cancelación = cancelados ÷ total. Sin denominador: «—», no 0 %. |
| Ocupación | Día | Minutos con turnos firmes (confirmados, atendidos o ausentes) ÷ minutos disponibles (jornada dentro del horario de la sede, con feriados y fechas especiales, menos ausencias). Los turnos pendientes de pago vigentes se muestran aparte. Los superpuestos se cuentan una vez. |
| Clientes | Inicio del primer servicio | Clientes con al menos una atención en el período. Nuevo: su primera atención en la sede cae en el período; recurrente: ya tenía una anterior. |
| Base comisionable | Momento en que la venta quedó cobrada completa | Servicios (no productos) de ventas en estado cobrada, netos de su parte del descuento, por profesional. Una venta anulada después deja de contar. |

## Recepción (tablero, doc 29) · 2026-10-23

Sección **Recepción** con lo que registra el tablero de recepción. Tiene dos tablas con CSV (`recepcion` y `espera`).

| Indicador | Fecha de corte | Qué cuenta |
|---|---|---|
| En el local | Período | Minutos entre la entrada y la salida que marca recepción, dentro del período. Una presencia sin salida cuenta hasta el momento del reporte. |
| Atendiendo | Día en que terminó la atención | Por cada servicio de un turno terminado con «Terminó»: desde su inicio hasta que su profesional terminó. Tiempo atendiendo = atendiendo ÷ en el local. |
| Duración real y estimada | Día en que terminó | Real: de que empezó la atención (despacho o «Llegó») a «Terminó». Estimada: la del catálogo, contando los servicios a la vez. «Se pasó» = duró más que lo estimado más `MARGEN_DEMORA_MINUTOS` (5). |
| Lista de espera | Día en que se anotó la clienta | Anotadas, atendidas, se fueron, sin cerrar. Espera = de que se anotó a que la atendieron (solo las atendidas). Abandono = se fueron ÷ (atendidas + se fueron). |

Solo cuentan las atenciones cerradas con «Terminó» desde el tablero. Las marcadas «Atendido» en la agenda no tienen hora real de fin. Un profesional sin presencia ni atenciones en el período no aparece.

## Comisiones: qué falta

D10 sigue pendiente: porcentaje y si se calcula sobre el bruto o el neto impositivo. Por eso el reporte muestra la **base**, no un importe a pagar. Cuando se defina, se agrega el porcentaje (versionado por profesional o por servicio) y la columna a pagar. La liquidación cerrada (que no se recalcula y ajusta reembolsos posteriores) es L01.

Se eligió devengar al cobro completo (confirmado por el usuario el 2026-10-22): un servicio atendido en octubre y terminado de pagar en noviembre cae en noviembre, y el número de un mes ya pasado no cambia cuando se cobra un saldo viejo. Lo único que puede cambiarlo es anular una venta de ese mes.

## CSV

`GET /reportes/csv?seccion=…&desde=…&hasta=…`, con las secciones `profesionales`, `servicios`, `cobros`, `turnos`, `ocupacion`, `comisiones`, `recepcion` y `espera`. Mismo alcance que la pantalla. Formato pensado para abrir con doble clic en Excel con configuración regional argentina: separador `;`, coma decimal, importes en pesos sin símbolo y BOM UTF-8. Un texto que empieza con `=`, `+`, `-`, `@`, tabulación o retorno se antepone con `'` para que no se ejecute como fórmula. La pantalla y el CSV salen de la misma definición de tabla (`tablas.ts`), así que muestran lo mismo.

## Pendiente

- Segunda parte de L03: caja (cierres y diferencias), gastos por categoría y stock (compras y consumo interno) del período.
- Desglose de ventas por día o semana y comparación con el período anterior.
- Las ventas de productos sueltos no tienen cliente (doc 27), así que no entran en clientes nuevos y recurrentes.
- L04: la misma pantalla para varias sedes, sin revelar sedes ajenas.

## Verificación

- Dominio: prorrateo exacto (también con restos), porcentajes sin denominador, celdas CSV (números, negativos, comillas, `;` y fórmulas neutralizadas) y permisos por rol.
- Integración (`packages/database/tests/reportes.test.ts`): una venta cobrada con descuento, una con saldo pendiente y una anulada con reverso; turnos atendidos, ausente, cancelado y reprogramado; clienta nueva y recurrente; ocupación por profesional; recepción, admin de otra sede y franquiciado ajeno rechazados; período inválido; recepción del tablero (presencia abierta y cerrada, una atención que se pasa del estimado y una que termina antes, lista de espera con atendida, ida y sin cerrar, y un día sin datos).
- Backoffice local con la demo: pantalla del mes en curso y descarga CSV (200 con `text/csv`, 400 con período invertido, 404 con sección inexistente).
