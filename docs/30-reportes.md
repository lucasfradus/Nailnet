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

## Por universo (doc 31, etapa 5) · 2026-11-11

Si la sede tiene servicios habilitados de los dos universos (Manos y pies y Tratamientos), la pantalla muestra arriba «Toda la sede / Manos y pies / Tratamientos». Toda la sede es lo de siempre, sin ningún cambio. El universo elegido va en la URL (`?universo=manos` o `?universo=tratamientos`, los mismos slugs que Recepción) y se conserva al cambiar el período, en «Este mes», en «Mes anterior» y en los CSV.

`reporteSede` acepta `universo` y devuelve `universos` (los que tienen algún servicio habilitado y activo en la sede) y `universo` (el que se aplicó). **Con un solo universo activo, el pedido se ignora** y el reporte es el de toda la sede, igual que en el tablero. Un servicio es del universo de su categoría (en el momento del reporte, no en el de la venta).

| Sección | Con un universo elegido |
|---|---|
| Ventas por servicio y por profesional | Solo las líneas de servicios del universo. El descuento se prorratea sobre la venta completa, productos incluidos, como siempre, y después se filtran las líneas. «Ventas» cuenta las que tienen alguna línea del universo; el total y los descuentos son los de esas líneas. Las anuladas se informan igual, con sus líneas del universo. |
| Productos | No tienen universo: quedan fuera (`productos` es nulo). |
| Ticket promedio y cobros | Son de la venta completa y no se pueden partir: no se calculan (`ticketPromedio` y `cobros` nulos). La pantalla lo dice en una línea y el CSV `cobros` responde 400. |
| Turnos | Las reservas con algún servicio del universo. Una con servicios de los dos cuenta en los dos, así que la suma de los dos universos puede superar a la sede. |
| Ocupación | Las profesionales del universo, con la regla del tablero: hace algún servicio suyo habilitado en la sede (con todas sus habilidades); sin servicios, es de los dos. Disponible: toda su jornada, aunque también trabaje en el otro universo. Ocupado y pendiente de pago: solo los servicios del universo. |
| Clientes | Los que tuvieron en el período alguna atención con un servicio del universo. «Nuevo» sigue siendo la primera atención en la sede, de cualquier universo: quien ya vino a Tratamientos y prueba Manos y pies es recurrente. |
| Recepción | Presencia de las profesionales del universo (misma regla que en ocupación). Atendiendo: solo los servicios del universo. Atenciones (cantidad, duración real y estimada): las que tienen algún servicio del universo, con la duración de la atención completa, porque «Llegó» y «Terminó» son de la reserva. Lista de espera: por el universo del primer servicio pedido, como en el tablero; si ese servicio ya no existe, cuenta en los dos. |
| Base comisionable | Solo los servicios del universo, con su parte del descuento prorrateado sobre la venta completa. |

Para la regla de la profesional se miran todas las que estuvieron vinculadas a la sede, también las dadas de baja, porque el período puede ser pasado. Una profesional que ya no figura en la sede cuenta en los dos.

CSV: `GET /reportes/csv?seccion=…&desde=…&hasta=…&universo=manos|tratamientos`. Mismo alcance y permisos que sin universo; un valor desconocido responde 400. El nombre del archivo lleva el universo.

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
- Por universo (`reportes por universo` en el mismo archivo): sede con servicios de los dos universos; venta mixta (servicio de cada universo y un producto) con descuento prorrateado, base comisionable, turnos con una reserva mixta, ocupación de profesionales de uno, de los dos y sin servicios, clienta recurrente por una atención del otro universo, presencia, atenciones y lista de espera por el primer servicio; pedido inválido y sin permiso; y con un solo universo activo, pedir uno da exactamente el reporte de toda la sede. Las pruebas de toda la sede no cambiaron.
- Backoffice local con la demo: pantalla del mes en curso y descarga CSV (200 con `text/csv`, 400 con período invertido, 404 con sección inexistente).
