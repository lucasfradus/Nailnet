# Ventas, cobros y caja · 2026-10-14

Implementa O01 (cobros manuales y ventas mixtas), O02 (caja y cierres) y la parte operativa de M03 (aplicación de seña y saldo). Migraciones `202610150010_ventas_caja` y `202610150030_recepcion_comanda` (flujo de recepción: «Atender ahora», comanda y cierre con diferencia explicado). Reglas puras en `packages/domain/src/ventas.ts` y `packages/domain/src/caja.ts`. Repositorios en `packages/database/src/ventas.ts` y `packages/database/src/caja.ts`, con enganches en `gastos.ts` (egreso de caja) y `stock.ts` (egreso y reposición por venta). Pantallas: Ventas (del día, cobro con comanda y detalle), Caja (abierta, movimientos, cierre e historial), «Atender ahora» y el botón «Cobrar» en la agenda.

**Ajuste 2026-10-14 (D19, confirmado por Sicurella):** el flujo se adaptó a cómo opera Sicurella hoy. Muchos clientes llegan sin turno y recepción los deriva a una profesional. La profesional entrega una comanda en papel con lo realizado y el valor, y recepción la carga y cobra, siempre después de atender. De ahí salen:

- «Atender ahora»;
- la comanda editable al cobrar;
- los permisos nuevos de recepción;
- el arqueo con observación obligatoria;
- que la anulación no repone stock por defecto.

Ver «Respuestas de Sicurella» en 04-decisiones.md.

## Flujo de recepción

1. **Llega el cliente.**
   - Con turno: ya está en la agenda.
   - Sin turno: **Atender ahora**. Se busca o se crea el cliente, se eligen la profesional y los servicios, y el turno empieza en ese minuto.
2. **La profesional trabaja** y entrega la comanda en papel.
3. **Recepción marca el turno como atendido** (desde la agenda, o desde la pantalla de cobro si todavía no lo estaba).
4. **Cobrar:** recepción carga la comanda.
   - Puede quitar servicios que no se hicieron y agregar los que se hicieron de más, cada uno con su profesional.
   - Ajusta el precio de cada servicio y suma productos si los hubo.
   - Carga los cobros (uno o varios medios). La seña de Mercado Pago, si la hubo, ya está descontada.

## Qué se puede hacer

| Pantalla | Operaciones |
|---|---|
| Agenda / Inicio | **Atender ahora** (cliente sin turno). En la agenda, los turnos sin turno previo se marcan como tales |
| Agenda | En un turno **atendido**: «Cobrar» abre el cobro del turno. Si el turno ya tiene venta, el botón lleva a la venta |
| Ventas › Cobrar turno | **Comanda:** servicios realizados con profesional por ítem y precio editable, más productos, seña aplicada, descuento y hasta 3 cobros con medios distintos. Si el turno no está atendido, ofrece marcarlo |
| Ventas › Venta de productos | Lo mismo sin turno: productos sueltos |
| Ventas (del día) | Ventas de la sede en un día, con lo vendido, las señas aplicadas, lo cobrado por medio y lo pendiente |
| Venta (detalle) | Ítems, seña, cobros y sus reversos. Cobrar el saldo. Anular con motivo |
| Caja | Abrir con efectivo inicial, entradas y salidas manuales con motivo, revertirlas, cerrar con conteo. Historial de cierres con el detalle de cada uno |
| Gastos | Un gasto en efectivo con la caja abierta sale de ella (casilla «sale de la caja», marcada por defecto). Recepción ve los gastos de su sede y carga solo los pagados con la caja |

## Permisos

Tabla propia en `packages/domain/src/access.ts`, como gastos. Se evalúan con el mismo `cubreSede` que el resto del panel.

| Permiso | Master | Franquiciado | Admin de sede | Recepción | Profesional |
|---|---|---|---|---|---|
| `venta:leer` | ✓ | sus sedes | su sede | sus sedes | |
| `venta:registrar` (alta, comanda y cobros) | ✓ | sus sedes | su sede | sus sedes | |
| `venta:anular` | ✓ | sus sedes | su sede | sus sedes | |
| `caja:leer` (incluye el historial de cierres) | ✓ | sus sedes | su sede | sus sedes | |
| `caja:operar` (abrir, entradas y salidas, revertirlas, cerrar) | ✓ | sus sedes | su sede | sus sedes | |
| `gasto:leer` | ✓ | sus sedes | su sede | sus sedes | |
| `gasto:registrar` (cualquier gasto) | ✓ | sus sedes | su sede | | |
| `gasto:registrar_caja` (solo efectivo pagado con la caja abierta) | ✓ | sus sedes | su sede | sus sedes | |
| `gasto:anular`, `gasto:categorias` | ✓ | sus sedes | su sede | | |

- Vender productos exige además `stock:consumir` en la sede, que recepción ya tiene (doc 26).
- «Atender ahora» usa `reserva:gestionar`, como la reserva manual.
- **Recepción anula ventas** (Sicurella, 2026-10-14). La primera versión lo reservaba para administración.
- **Recepción y gastos:**
  - ve los gastos de su sede;
  - registra solo gastos en efectivo que salen de la caja abierta. Con otro medio, o indicando que no sale de la caja, el repositorio lo rechaza;
  - no anula gastos ni administra categorías.
- Como en el resto del panel, la sede elegida arriba es solo un filtro. Cada operación vuelve a autorizar en el repositorio. Un ID de sede, venta, caja, movimiento, reserva o producto fuera del alcance (o mal formado) responde acceso denegado, igual que si no existiera. Las pruebas cubren lectura y escritura por ID.

## Venta

| Campo | Detalle |
|---|---|
| Sede | Obligatoria y activa |
| Turno | Opcional. Solo una reserva **ATENDIDA** de la misma sede, con o sin reserva previa. Sin turno, la venta es de productos sueltos y no lleva servicios |
| Ítems de servicio | La **comanda** (ver abajo). Sin comanda explícita, los servicios del turno al precio pactado |
| Ítems de producto | Productos **vendibles, activos y con precio en la sede** (precio de `ProductoSede`, copiado en el ítem). Cantidad en la unidad del producto, hasta 3 decimales. Subtotal al centavo, mitad hacia arriba (igual que las compras) |
| Descuento | Opcional, un importe en pesos sobre el subtotal. No puede superar el subtotal ni dejar el total por debajo de la seña |
| Total | Subtotal − descuento |
| Anticipo | La seña aprobada del turno (ver abajo) |
| Fecha | Fecha local de la sede al registrar |

- **Estados:** `PENDIENTE` (falta cobrar), `COMPLETADA` (anticipo + cobros = total) y `ANULADA`.
- **Montos:** `Decimal(12,2)`, como catálogo, pagos y gastos. El dominio calcula en centavos `bigint` (`aCentavos`/`importe`) y el repositorio convierte en el borde. Nunca `Number`.
- **Stock:** el egreso es `egresarPorVenta(tx, …)` dentro de la transacción de la venta. Si no alcanza el stock, no queda nada: ni venta, ni ítems, ni cobros, ni movimientos (probado). `MovimientoStock.ventaId` ahora tiene FK a `Venta`.
- **Un turno, una venta vigente:** índice único parcial sobre `reservaId` para las ventas no anuladas.

## Comanda (servicios realmente hechos)

Al cobrar cualquier turno atendido, recepción carga la comanda de la profesional.

| Línea | Detalle |
|---|---|
| Servicio | Cualquiera habilitado en la sede. Los del turno vienen precargados; elegir «no se hizo» los quita |
| Profesional | Por ítem. Tiene que trabajar en la sede. Queda en `VentaItem.profesionalId` para las comisiones (L01) |
| Precio | **Editable.** Se propone el pactado (servicio del turno) o el de lista de la sede (servicio agregado). Vacío = el propuesto. Se guardan `precioLista` (el propuesto) y `precioUnitario` (el cobrado). Cero se admite (cortesía) |
| Vínculo con el turno | `reservaItemId` si la línea es un servicio del turno y el servicio no cambió. Si se cambió el servicio, cuenta como agregado |

- **Agregar un servicio no reserva agenda:** ya se hizo. No pasa por el motor ni toma locks de agenda.
- **Los servicios solo se cobran contra un turno.** Para un cliente sin turno, primero «Atender ahora». La base lo exige con un trigger. Un ítem de reserva tiene que ser del mismo turno.
- **Validaciones:** servicio habilitado en la sede, profesional de la sede y precio válido. IDs de otra organización o de otro turno responden acceso denegado.
- **Sin stock:** los servicios nunca tocan el stock. Solo los productos de la venta lo descuentan (probado).

## Atender ahora (cliente sin turno)

- **Cliente rápido:** se busca un cliente existente o se crea uno con **nombre y un teléfono o email**. Es el mínimo que hoy exige el modelo de clientes (doc 12: «Indicá al menos un email o un teléfono de contacto»). Se reutiliza ese alta sin cambiar la regla, porque el contacto sirve para recontactar y para la ficha. El resto se completa después.
- **Turno:** recepción elige profesional y servicios (hasta 3, encadenados). `atenderAhora` (`packages/database/src/reservas.ts`) llama a `tomarTurno` de la reserva manual (R01):
  - mismos locks de agenda y mismo motor;
  - inicio en el minuto actual, sin grilla. El motor ya acepta cualquier inicio y valida jornada, ausencias, otros turnos y recursos.
- **Si la profesional no está libre** (otro turno, un bloqueo o fuera de su horario), se rechaza con: «La profesional no está libre ahora… Elegí otra profesional o reservá un turno para más tarde».
- **Estado:** queda `CONFIRMADA` y ocupa la agenda desde ese minuto, así el portal no ofrece el horario.
  - No exige seña aunque la sede la pida en recepción.
  - No manda email de confirmación.
  - Al terminar se marca atendido y se cobra como cualquier turno.
- **Marca:** `Reserva.sinTurnoPrevio = true` (columna nueva). Distingue estas atenciones de una reserva previa para los reportes (L03). La agenda muestra «sin turno previo» y la marca se conserva al reprogramar.
- **Acceso:** botón «Atender ahora» en la agenda y en Inicio.

## La seña como anticipo (M03)

Ejemplo de la arquitectura, probado tal cual: servicio de $30.000, seña de $9.000 cobrada por Mercado Pago al reservar, se atiende y se cobra en recepción.

| | Importe | Dónde queda |
|---|---|---|
| Venta | $30.000 | `Venta.total` |
| Anticipo aplicado | $9.000 | `Venta.anticipo` + `Venta.pagoAnticipoId` (el `Pago` de R04) |
| Cobro en recepción | $21.000 | `CobroVenta` (y en la caja, si es efectivo) |

- **Sin doble ingreso:** la venta suma $30.000, no $39.000. La seña no es un `CobroVenta` ni un movimiento de caja: ya entró por Mercado Pago. Ventas del día muestra «Vendido $30.000», «Señas aplicadas $9.000» y «Cobrado en recepción $21.000». La caja sube solo los $21.000 si se cobran en efectivo.
- **Qué seña cuenta:** solo un `Pago` `APROBADO` de la reserva o de las que reemplazó al reprogramarse (el pago queda contra la reserva original, doc 23). `A_DEVOLVER` y `REEMBOLSADO` no son anticipo. El monto es el del pago, no el snapshot `ReservaItem.sena`: un turno de recepción guarda la seña calculada aunque nunca se haya cobrado.
- **Una sola vez:** índice único parcial sobre `pagoAnticipoId` para las ventas no anuladas. Un trigger exige que el pago sea `APROBADO`, de la misma sede y por el mismo monto que el anticipo.
- **Casos raros:** si el turno tuviera más de una seña aprobada, o la seña fuera de otra sede, no se adivina: se pide revisarlo antes de cobrar.
- **Anular la venta libera la seña:** el turno se puede volver a cobrar y el anticipo se aplica de nuevo. La seña sigue cobrada en Mercado Pago; devolverla es manual hasta M01/D7.
- **Lo que depende de D9:** si la seña y el saldo se facturan juntos, por separado o al completar la venta. Ver «Facturación».

## Cobros

- **Medios:** efectivo, transferencia, tarjeta de débito, tarjeta de crédito, Mercado Pago (QR o link en el mostrador, cargado a mano) y otro. Los mismos valores que en gastos.
- **Mixtos:** varios cobros por venta, cada uno con su medio y una referencia opcional (número de operación, cupón). Hasta 3 en el alta. Lo que falte se cobra después desde el detalle de la venta.
- **Nunca de más:** anticipo + cobros no pueden superar el total. Hoy no se registra vuelto: en efectivo se carga el importe exacto. Lo controlan el dominio, el repositorio bajo lock y un trigger.
- **Idempotencia:** el formulario lleva una clave (`randomUUID` generado al mostrarlo).
  - Alta: un doble envío con la misma clave devuelve la misma venta. También si los dos envíos llegan a la vez desde dos conexiones: uno gana y el otro recibe la venta del primero (probado).
  - Cobro: un doble envío del cobro tampoco duplica (clave en `CobroVenta`).
- **Completar:** cuando anticipo + cobros = total, la venta pasa a `COMPLETADA` en la misma transacción.

## Anulación por reverso

Una venta no se edita ni se borra. Se anula con motivo (5 a 500 caracteres), con `venta:anular` (recepción incluida):

- **Cobros:** cada cobro recibe un `CobroVenta` `REVERSO` con el monto negado y el mismo medio. El original no cambia.
- **Efectivo:** sale de la **caja abierta al momento de anular**, nunca de una caja cerrada. Sin caja abierta, o sin efectivo suficiente en ella, la anulación se rechaza. Los demás medios se devuelven por fuera del sistema (la tarjeta o la transferencia), como los reembolsos de M01.
- **Stock:** con «los productos vuelven al stock» (**desmarcado por defecto**: para Sicurella el stock es casi virtual), cada egreso `VENTA` recibe un `REVERSO` de stock (`reponerPorAnulacionVenta`). Si no se marca, el stock no vuelve, que es además el criterio de la arquitectura de no reponer sin devolución física.
- **Seña:** queda libre para otra venta del mismo turno.
- **Estado:** la venta pasa a `ANULADA` con quién, cuándo y por qué. Sigue a la vista en Ventas del día, tachada, y no suma.
- **Sin anulación parcial:** no se anula un cobro suelto. Si un cobro se cargó con el medio equivocado, se anula la venta y se carga de nuevo.

## Caja

Una caja por sede, desde que se abre hasta que se cierra. **Solo efectivo.**

| Movimiento | Signo | Origen |
|---|---|---|
| `INGRESO_COBRO` | + | Cobro en efectivo de una venta (`cobroId`) |
| `EGRESO_GASTO` | − | Gasto en efectivo pagado con la caja (`gastoId`) |
| `ENTRADA` | + | Manual, con motivo (cambio traído del banco, aporte) |
| `SALIDA` | − | Manual, con motivo (retiro para depositar) |
| `REVERSO` | ± | Contra-movimiento de otro, con motivo. Lo generan la anulación de una venta o de un gasto, o «Revertir» en una entrada o salida manual |

- **Apertura:** con el efectivo inicial (cero o más). **Una sola caja abierta por sede**, garantizado por un índice único parcial en la base. Dos aperturas simultáneas: gana una y la otra recibe «La sede ya tiene una caja abierta» (probado con dos conexiones).
- **Efectivo esperado** = inicial + suma de movimientos.
- **Los digitales no inflan el efectivo esperado:** un cobro con tarjeta, transferencia, MP u otro no genera movimiento de caja. Si se cobró con la caja abierta, queda asociado a ella (`CobroVenta.cajaId`) y la pantalla lo muestra aparte, por medio, como «Otros medios (no se cuentan)». Un test recorre la base y verifica que ningún cobro digital movió efectivo.
- **Sin efectivo negativo:** una salida, un gasto o la devolución de un cobro no pueden sacar más efectivo del que la caja tiene.
- **Cierre (arqueo no ciego):** se informa el efectivo contado, con el esperado a la vista. Bajo el lock de la caja se calcula el esperado y se guarda `esperado`, `contado` y `diferencia = contado − esperado` (negativa = faltante). El cierre queda fijo.
  - **Con diferencia, la observación es obligatoria** (al menos 5 caracteres). La validan el dominio, contra el esperado calculado bajo lock, y un `CHECK` de la base.
  - Sin diferencia es opcional.
- **Reversos después del cierre:** una caja cerrada no se reescribe. El contra-movimiento va a la caja abierta al momento de revertir y apunta al original (`revierteId`), aunque esté en otra caja.
- **Historial:** los últimos 30 cierres, con esperado, contado, diferencia, observaciones y quién cerró. Cada uno abre su detalle de movimientos.
  - Filtro «solo con diferencia» para revisar faltantes.
  - Lo ven recepción, admin y franquiciado de la sede (`caja:leer`). Según Sicurella, los faltantes los revisan recepción y franquiciado.

### Cobro en efectivo con la caja cerrada (decisión)

**Se rechaza.** El mensaje pide abrir la caja desde el menú Caja. Con los demás medios se puede cobrar con la caja cerrada: esos cobros no quedan asociados a ninguna caja y aparecen igual en Ventas del día. Motivo: el efectivo que entra sin caja no tendría dónde contarse y descuadraría el próximo cierre. En la base, un `CHECK` exige caja en todo cobro en efectivo, y un trigger diferido exige su movimiento de caja al confirmar la transacción.

### Gastos en efectivo

Es la propuesta del doc 25, implementada.

- `registrarGasto` acepta `desdeCaja`:
  - `true` exige caja abierta;
  - `false` no la toca (lo pagó alguien desde afuera);
  - sin indicar, sale de la caja si hay una abierta.
- La pantalla de Gastos muestra la casilla «Si es en efectivo, sale de la caja abierta» solo con la caja abierta, marcada por defecto.
- **Recepción** (`gasto:registrar_caja`): el formulario fija efectivo desde la caja. Con la caja cerrada pide abrirla. Anular sigue en administración de sede, franquiciado o master.
- **Anulación:** si el gasto había salido de la caja, el efectivo vuelve a la caja abierta al anular (`REVERSO` con el gasto `REVERSO` y el movimiento original). Sin caja abierta, la anulación se rechaza.
- Un gasto con otro medio no toca la caja.

## Concurrencia

Mismo enfoque que stock y la exclusión de turnos (doc 16): lock de fila y cálculo bajo lock.

- **Dos cobros sobre la misma venta:** `SELECT … FOR UPDATE` sobre la fila de la venta, después la suma de cobros y la validación del saldo. El segundo espera y ve el saldo que dejó el primero. Probado con dos conexiones:
  - una retiene el lock 0,6 s y la otra espera y se rechaza;
  - diez cobros de $1.000 en paralelo sobre $4.500: pasan 4.
  - El trigger `cobro_coherente` también toma el lock de la venta, así que la base lo garantiza aunque una escritura esquive el repositorio.
- **Caja:** la fila de la caja (`FOR UPDATE`) serializa movimientos y cierre. Un cobro en efectivo concurrente con el cierre entra antes o espera y encuentra la caja cerrada.
- **Orden de locks:** venta → saldos de stock → caja, en todas las operaciones (alta, cobro, anulación, gastos). Igual hay reintento acotado ante deadlock (`conReintento`).

## Defensa en la base

- **Solo inserción:** `VentaItem`, `CobroVenta` y `MovimientoCaja` tienen el trigger `solo_insercion`.
- **`Venta`:**
  - nace `PENDIENTE` y solo avanza `PENDIENTE → COMPLETADA → ANULADA` (o `PENDIENTE → ANULADA`);
  - sus importes, ítems, reserva, anticipo y clave no cambian;
  - `COMPLETADA` exige anticipo + cobros = total (trigger);
  - no se borra.
- **`Caja`:**
  - nace `ABIERTA` y se cierra una sola vez;
  - los datos de apertura no cambian;
  - el esperado del cierre tiene que coincidir con inicial + movimientos (trigger);
  - no se borra.
- **`CHECK` de forma:**
  - importes de la venta;
  - cobro positivo sin motivo, o reverso negativo con motivo;
  - efectivo con caja;
  - signo y origen de cada movimiento de caja;
  - ítem de servicio con servicio, profesional y cantidad 1, o ítem de producto;
  - cierre con diferencia y observación.
- **Triggers de coherencia:**
  - un servicio solo se cobra en una venta con turno, y su ítem de reserva es de ese turno;
  - el reverso copia el original y niega su monto;
  - el movimiento de caja corresponde a su cobro o gasto en efectivo;
  - la caja está abierta y es de la misma sede;
  - el efectivo no queda negativo.
- **Auditoría:** alta, cobro y anulación de ventas, apertura, movimientos manuales, reversos y cierre de caja quedan también en `AuditLog`.

## Facturación (D9): punto de enganche, sin implementar

D9 sigue abierta: no se sabe si se factura cada cobro, la venta completada, a pedido o después, ni cómo se trata la seña frente al saldo. **No se emite ni se simula ningún comprobante.**

El enganche queda en `completarSiCorresponde` (`packages/database/src/ventas.ts`): ahí la venta pasa a `COMPLETADA` dentro de la transacción del último cobro. Cuando D9 se defina:

- si se factura la venta completada, se encola en el outbox (doc 21) un trabajo `facturacion.venta` en esa misma transacción;
- si se factura cada cobro, el enganche es `asentarCobros`.

La seña ya está identificada (`Venta.pagoAnticipoId`), así que también se puede facturar aparte si así se decide. Las notas de crédito se engancharían en `anularVenta`.

## Diferencias con el modelo de 02-arquitectura

- **`Caja` es la sesión:** la arquitectura proponía `Caja`, `SesionCaja` y `CierreCaja`. Con una sola caja física por sede, una fila `Caja` va de la apertura al cierre y guarda el cierre (esperado, contado, diferencia). Si una sede necesita dos cajas (dos puestos de cobro), se agrega un `PuntoCaja` y el índice único pasa a ser por puesto.
- **Sin tabla `MedioPago`:** es un enum, como en gastos.
- **Sin `AplicacionPago`:** el anticipo es `Venta.anticipo` + `Venta.pagoAnticipoId`, con unicidad entre ventas vigentes. Si hiciera falta aplicar un pago a varias ventas (o varias señas a una), se agrega la tabla sin romper lo existente.
- **`CobroVenta` en vez de `Pago`:** los cobros de recepción no son pagos de un proveedor. `Pago` sigue siendo el de Mercado Pago (R04).

## Confirmado por Sicurella (2026-10-14, D19)

| Pregunta | Respuesta | Cómo quedó |
|---|---|---|
| ¿Recepción anula ventas? | Sí | `venta:anular` para recepción |
| ¿Cobran antes de atender? | No: siempre después | Se cobra solo un turno atendido; la pantalla de cobro ofrece marcarlo |
| ¿Clientes sin turno? | Muchos | «Atender ahora» y la comanda |
| ¿Vuelto? | No se registra | Sin cambios: se carga el importe exacto |
| ¿Arqueo ciego? | No | El esperado se muestra |
| ¿Observación ante diferencia? ¿Quién revisa? | Obligatoria. Revisan recepción y franquiciado | Validación en dominio y `CHECK`; historial con filtro de diferencias, visible para ambos |
| ¿Puestos de cobro? | Uno por sede | Sin cambios: una caja abierta por sede |
| ¿Gastos de recepción? | Registra y ve los de su sede, pagados desde la caja; no anula | `gasto:leer` + `gasto:registrar_caja` |
| ¿Descuentos con tope o rol? | No | Sin cambios: importe libre con `venta:registrar` (probado con descuento total) |
| ¿Reponer stock al anular? | Stock «prácticamente virtual» | La casilla viene desmarcada; los servicios no dependen del stock |
| Facturación (D9) | Sin definir | Sin cambios |

## Queda por definir

- **Cobro en efectivo sin caja abierta:** hoy se rechaza. No se preguntó explícitamente, pero es coherente con el arqueo.
- **Facturación (D9)** con el contador: cuándo se emite y cómo se trata la seña.
- **«Atender ahora» con duración real:** el turno ocupa la duración del catálogo. Si un servicio se extiende, la agenda no se corre sola. Si termina antes, «Terminó» en el tablero de recepción recorta la agenda (doc 29).

## Pendiente

- **Facturación** (M02, depende de D9).
- **Devolución de la seña** al anular una venta o cancelar un turno pagado (M01, D7).
- **Anulación parcial** (un cobro o un ítem) y devoluciones parciales de productos.
- **Reportes:** ventas por fecha de venta y cobros por fecha de cobro, desglose por profesional y servicio, CSV y consolidados (L03/L04). Ventas del día agrupa los cobros por la fecha de su venta: un saldo cobrado otro día aparece en la venta original.
- **Comisiones** sobre servicios cobrados (L01, D10). Cada ítem de servicio ya guarda su profesional y los precios de lista y cobrado.
- **Reportes con `sinTurnoPrevio`** (atenciones sin reserva frente a reservadas): el dato ya está, falta el reporte (L03).
- **Cliente en una venta de productos sueltos:** hoy no se elige; solo las ventas de un turno tienen cliente.
- **Paginación:** Ventas del día muestra hasta 500 ventas y Caja los últimos 30 cierres.
- **Navegador:** la UI no se probó en un navegador real.

## Verificación

- `npm run test:domain`, `tests/ventas.test.ts`, 11 pruebas:
  - precio editable de la comanda;
  - observación obligatoria en un cierre con diferencia;
  - el ejemplo M03 en centavos;
  - venta mixta con cantidades fraccionarias y descuento;
  - validaciones del alta;
  - cobros sin exceso;
  - resumen por medio (efectivo aparte);
  - signos, esperado, diferencia y efectivo negativo de la caja;
  - importes de apertura y movimientos manuales;
  - descuento, motivo, clave de idempotencia y formato de pesos;
  - permisos por rol, incluidos los nuevos de recepción.
- `npm run test:database`, `tests/ventas.test.ts`, 15 escenarios en PostgreSQL:
  - **comanda:**
    - agregar un servicio con otra profesional y quitar el del turno;
    - precio editable, con lista y cobrado guardados;
    - servicio no habilitado, profesional de otra sede, ítem de otro turno, servicios sin turno y turno de otra organización;
    - descuento total sin restricción de rol;
    - los servicios no tocan el stock;
  - **Atender ahora:**
    - cliente rápido con nombre y teléfono;
    - turno que arranca en el minuto, marcado `sinTurnoPrevio` y sin email;
    - el motor deja de ofrecer ese horario;
    - profesional ocupada o fuera de horario rechazada con el mensaje claro;
    - otra profesional libre aceptada;
    - permisos y sede ajena;
    - cobro con comanda;
  - recepción anula ventas; recepción carga un gasto desde la caja, pero no con otro medio ni lo anula;
  - cierre con diferencia sin observación rechazado; recepción y franquiciado ven el historial filtrado por diferencia;
  - caja: una sola abierta (también con dos conexiones), entradas, salidas, reverso único y efectivo nunca negativo;
  - **M03:** reserva con seña aprobada por el mismo `aplicarPago` del worker, atendida y cobrada en efectivo: venta $30.000, anticipo $9.000, cobro $21.000, caja +$21.000, reporte del día sin $39.000, turno y seña no se cobran dos veces;
  - venta mixta: servicio + productos + descuento, efectivo + débito + MP, egreso de stock con `ventaId`, la caja solo suma el efectivo;
  - venta de productos sueltos;
  - validaciones: turno no atendido, producto sin precio, de consumo interno o sin stock (nada a medias);
  - efectivo con la caja cerrada rechazado; digital aceptado sin caja;
  - idempotencia del alta (secuencial y simultánea) y del cobro;
  - **cobros concurrentes desde dos conexiones** (lock retenido y diez en paralelo);
  - anulación: permisos, reversos, efectivo devuelto, stock repuesto, seña liberada y vuelta a cobrar;
  - gastos en efectivo con egreso y contra-movimiento; casilla y caja cerrada;
  - cierre con diferencia, caja cerrada inmutable, reverso en la caja nueva;
  - acceso cruzado por ID en lectura y escritura (otra sede, otro franquiciado, otra organización, profesional, sin rol, ID mal formado);
  - la base rechaza ediciones, borrados, cobros de más, efectivo sin caja o sin movimiento, cierres incoherentes y movimientos en cajas cerradas;
  - invariantes: esperado = inicial + movimientos, completada = anticipo + cobros, anulada suma cero, todo efectivo en una caja, ningún digital en la caja.
- Las pruebas de gastos (doc 25, actualizadas para el acceso nuevo de recepción) y de stock (doc 26) siguen pasando con los enganches nuevos.
- `npm run check`.
- La UI no se probó en un navegador real.
