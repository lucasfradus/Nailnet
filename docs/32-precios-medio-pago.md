# Precios por medio de pago · propuesta · 2026-11-16

Propuesta (D22). Sale de una charla con el usuario el 2026-11-16. Extiende ventas y caja (27-ventas-caja.md) y el catálogo (13-catalogo.md). **Las etapas 1 (medios de pago de la sede), 2 (cobro rápido) y 3 (portal) quedaron implementadas entre el 2026-11-16 y el 17.** Ver «Etapa 1: cómo quedó», «Etapa 2: cómo quedó» y «Portal».

## El problema

El local cobra sobre todo en efectivo y con tarjeta, y a veces por transferencia. Siempre hay un precio de referencia: **el precio de lista es el de tarjeta**, y a otros medios se les aplica un porcentaje, por ejemplo **efectivo −10%**.

Hoy el sistema tiene **un solo precio** por servicio y sede (`ServicioSede.precio`) y por producto (`ProductoSede.precio`). Los medios de pago son una lista fija en el código (`MedioCobro`). Para cobrar en efectivo, recepción hace la cuenta a mano y la carga como descuento en pesos. Además, la pantalla de cobro no muestra el total mientras se arma la comanda.

## Lo que respondió el usuario (2026-11-16)

| Tema | Respuesta |
|---|---|
| Forma del ajuste | Porcentaje sobre el precio de lista |
| Redondeo | Siempre, por el cambio. Por defecto a $100 hacia abajo |
| Recargos (cuotas, tratamientos caros) | Hoy no hay, pero el modelo tiene que admitirlos |
| Débito y crédito | Pueden tener precios distintos |
| Transferencia | Paga como efectivo |
| Quién define la regla | Cada sede |
| Excepciones por servicio o producto | No hay. Las excepciones se resuelven al cobrar (precio editable y descuento manual) |
| Medios configurables | Sí: cada sede activa los suyos y puede sumar otros |
| Pago mixto (parte efectivo y parte tarjeta) | Lo decide el mostrador en cada caso |
| Descuento de efectivo y descuento manual | Primero el del medio y después el manual |
| Seña online | Siempre se calcula sobre el precio de lista |
| Portal | La clienta ve los dos precios |
| Comisiones sobre lista o sobre lo cobrado | Sin definir (sigue abierto en D10) |
| Pantalla | Tiene que ser intuitiva y rápida para recepción |

## Modelo

### El precio de lista no cambia

`ServicioSede.precio` y `ProductoSede.precio` siguen siendo el **precio de lista** (el de tarjeta). No se carga un precio por cada medio: el precio de cada medio sale de la lista y de la regla de ese medio. Así, cambiar la lista o el porcentaje actualiza todo junto.

### Medio de pago de la sede

Cada sede tiene sus medios de pago, cada uno en una fila de una tabla nueva, `MedioPagoSede`:

| Campo | Detalle |
|---|---|
| `nombre` | El que ve recepción: «Efectivo», «Débito», «Cuenta DNI» |
| `tipo` | El `MedioCobro` de hoy: `EFECTIVO`, `TRANSFERENCIA`, `TARJETA_DEBITO`, `TARJETA_CREDITO`, `MERCADO_PAGO`, `OTRO`. Define el comportamiento: solo `EFECTIVO` mueve la caja. También agrupa los medios en los reportes |
| `ajustePct` | Porcentaje sobre la lista. Negativo es descuento (`-10`) y positivo es recargo (`+15`). Cero: paga la lista |
| `habilitado` | Si recepción lo ve al cobrar |
| `orden` | Orden de los botones en la pantalla de cobro |

- **Medios iniciales:** al crear la sede (y en la migración para las sedes que ya existen) se cargan Efectivo, Transferencia, Débito, Crédito, Mercado Pago y Otro, todos con 0%. Así nada cambia hasta que la sede configure sus porcentajes.
- **Medios nuevos:** la sede suma uno eligiendo nombre y tipo. Por ejemplo, «Cuenta DNI» con tipo `OTRO` o `TRANSFERENCIA`.
- **Un medio no se borra:** se deshabilita. Así sus cobros conservan la referencia.
- **Los recargos quedan admitidos** con un porcentaje positivo. Las cuotas (un recargo distinto según la cantidad de cuotas) no entran ahora. Si hacen falta, serán varios medios («Crédito 3 cuotas», «Crédito 6 cuotas»), cada uno con su recargo.

### Redondeo

Es una configuración de la sede: el múltiplo (sin redondeo, $10, $50, $100, $500 o $1.000) y el sentido. **Por defecto, a $100 hacia abajo** (confirmado por el usuario el 2026-11-16): favorece a la clienta y nunca cobra más que el porcentaje anunciado.

- **Se redondea el precio de cada ítem**, no el total. Así el precio en efectivo que la clienta vio en el portal es exactamente el que paga, y la suma de varios servicios queda igual en el múltiplo.
- **Se redondean solo los precios con ajuste.** La lista se cobra tal cual está cargada.
- **Productos con cantidad fraccionaria:** se redondea el precio unitario, y el subtotal queda al centavo, como hoy.

Ejemplo con lista $15.500, efectivo −10% y redondeo a $100 hacia abajo: $15.500 × 0,90 = $13.950, que redondeado da **$13.900**.

### Cálculo de una venta

1. Cada ítem tiene su **precio de lista** (el pactado en el turno, o el de la sede).
2. Se elige el **precio que se aplica** (ver «Pantalla de cobro»): el de un medio. A cada ítem se le aplica su `ajustePct` y el redondeo.
3. Recepción puede **editar el precio** de un ítem (la excepción, como hoy).
4. Subtotal = suma de los ítems.
5. **Descuento manual** en pesos, sobre ese subtotal.
6. Total = subtotal − descuento manual.
7. La **seña** se calculó sobre la lista al reservar y se resta del total. Saldo = total − seña.

Ejemplo: lista $15.500, seña 30% = $4.650 (pagada por Mercado Pago al reservar). Si el resto se paga en efectivo: total $13.900 − seña $4.650 = **$9.250 a cobrar**.

### Qué se congela en la venta

Como el resto de los importes, lo aplicado queda guardado en la venta y no cambia si después la sede modifica sus porcentajes:

- en la `Venta`: el medio cuyo precio se aplicó (`medioPrecioId`), su `ajustePct` y el redondeo;
- en cada `VentaItem`: `precioLista` (la lista, como hoy), `precioMedio` (nuevo: con el ajuste y redondeado) y `precioUnitario` (el cobrado; distinto de `precioMedio` solo si recepción lo editó).

Con los tres precios guardados, la comisión puede calcularse sobre la lista, sobre el precio del medio o sobre lo cobrado, lo que se decida en D10, sin tener que reconstruir nada.

### Cobros

`CobroVenta` pasa a referenciar el `MedioPagoSede` y guarda una copia de su `tipo` y su `nombre`. La caja, el arqueo y los reportes siguen funcionando por tipo: la regla «solo el efectivo mueve la caja» no cambia.

## Pantalla de cobro

La pantalla de hoy (Ventas › Cobrar turno) es un formulario: no muestra el total mientras se arma la comanda, y hay que escribir a mano el medio y el monto de cada cobro. La propuesta es que **cobrar un caso normal tome dos toques**.

**Arriba, la comanda:** los servicios y productos, como hoy. Cada uno muestra su precio de lista.

**Abajo, «¿Cómo paga?»:** un botón grande por cada medio habilitado de la sede, con **el total a cobrar con ese medio** ya calculado (con ajuste, redondeo, descuento manual y seña restada). Hay un botón por medio aunque dos den el mismo total: efectivo y transferencia cuestan lo mismo, pero solo el efectivo entra en la caja, así que el cobro tiene que saber cuál fue.

- **Un medio (el caso normal):** recepción toca el medio y confirma. El cobro se carga por el total exacto. Sin escribir montos.
- **Varios medios («Dividir pago»):** recepción elige primero qué precio se aplica (por defecto el de lista, que es el más alto) y después reparte el total entre los medios. Al escribir el monto del primero, el segundo se completa con lo que falta. Así el mostrador decide cada caso, como pidió el usuario.
- **Los totales se actualizan en vivo** al sumar o quitar ítems, editar un precio o cargar el descuento manual.
- **Para dejar saldo pendiente** (cobrar después), se sigue pudiendo registrar la venta sin cobrar.
- Con el medio elegido, cada ítem muestra su precio con el ajuste al lado de la lista, para que recepción pueda explicárselo a la clienta.

## Portal

El portal de reservas muestra los dos precios de cada servicio, por ejemplo «$15.500 · $13.900 en efectivo o transferencia».

- Se muestra la lista y, debajo, cada precio distinto de la lista con los nombres de sus medios.
- Si un medio tiene recargo, el portal no lo muestra, para no confundir.
- La seña se sigue calculando sobre la lista.

**Cómo quedó (etapa 3, 2026-11-17).** `serviciosPublicos` devuelve `preciosMedio` en cada servicio: un precio por cada valor distinto con descuento, con los medios que lo dan, en el orden de la sede (`preciosPortal` en el dominio, con el mismo redondeo que cobra recepción). En el portal, debajo del precio de lista de cada tarjeta, va por ejemplo «$16.200 con Efectivo, Transferencia o Cuenta DNI», y lo mismo en el resumen de la reserva. Un precio que redondeado da la lista no se muestra.

## Permisos

Configurar los medios y el redondeo de la sede lo hacen el master, el franquiciado y el administrador de sede (`sede:administrar`, el mismo permiso con que ya administran la sede; confirmado). Recepción no lo hace: solo elige el medio al cobrar.

## Etapas

1. **Medios de pago de la sede.** Tabla `MedioPagoSede`, medios iniciales, configuración del redondeo y pantalla en la configuración de la sede para editar porcentajes, nombres, orden y habilitación. `CobroVenta` pasa a referenciar el medio. Sin cambios visibles en el cobro: todos arrancan en 0%.
2. **Pantalla de cobro rápida.** Precios por medio en la venta, botones «¿Cómo paga?» con los totales en vivo, «Dividir pago» y lo que se congela en la venta y los ítems.
3. **Portal con los dos precios.**
4. **Más adelante:** recargos por cuotas, si hacen falta.

## Etapa 1: cómo quedó

| Pieza | Detalle |
|---|---|
| Base | Migración `202611160010_medios_pago_sede`: tabla `MedioPagoSede`, `ConfiguracionSede.redondeoPaso`/`redondeoSentido` y `CobroVenta.medioPagoId`/`medioNombre` |
| Medios iniciales | Un trigger sobre `Sede` crea los seis medios en cada sede nueva; la migración los crea en las existentes |
| Reglas en la base | Nombre único por sede sin distinguir mayúsculas, ajuste entre −90 % y +100 %, el tipo y la sede de un medio no cambian, un medio no se borra, el cobro lleva el tipo de su medio y el medio está habilitado al cobrar. El reverso repite el medio del cobro aunque después se haya deshabilitado |
| Dominio | `@nailnet/domain/medios-pago`: `precioConAjuste`, redondeo, lectura y validación del porcentaje y de los medios. Todavía no se usa para cobrar (etapa 2) |
| Repositorio | `@nailnet/database/medios-pago`: listar, guardar todos de una vez, agregar uno y `mediosHabilitados` para validar cobros |
| Pantalla | Sedes › (sede) › **Medios de pago**: orden, nombre, ajuste, ejemplo con lista $15.500 y activo; redondeo y sentido; agregar un medio. Quien no administra la sede la ve en modo lectura |
| Cobro | Los selectores de medio (Cobrar y detalle de la venta) muestran los medios activos de la sede, en su orden. El cobro guarda el medio y su nombre; la venta muestra ese nombre |
| Compatibilidad | Un cobro todavía puede indicar un tipo (`EFECTIVO`) en lugar del medio: se usa el primer medio activo de ese tipo. Los cobros anteriores se muestran por su tipo |

Con la etapa 1 sola no cambiaba ningún precio: los ajustes se aplican al cobrar desde la etapa 2.

## Etapa 2: cómo quedó

| Pieza | Detalle |
|---|---|
| Base | Migración `202611160020_precio_aplicado_venta`: la venta guarda `medioPrecioId`, `ajustePct`, `redondeoPaso` y `redondeoSentido`; cada ítem, `precioMedio`. Un trigger impide editarlos y otro exige que el medio esté habilitado y que el ajuste sea el suyo |
| Dominio | `preciosConMedio` y `totalesConMedio`: ajuste por ítem, después el descuento manual y al final la seña. Los usan la pantalla y el repositorio, así lo que se ve es lo que se registra |
| Repositorio | `registrarVenta` recibe `medioPrecio` (vacío = lista). El precio editado en la comanda es la excepción y no se ajusta. Los productos también toman el precio del medio |
| Pantalla | Ventas › Cobrar: la comanda y los productos se editan con los totales en vivo. «¿Cómo paga?» muestra un botón por medio con el total a cobrar; tocar uno y «Cobrar» registra la venta y el cobro por el total exacto. «Dividir pago» elige el precio (por defecto, la lista) y reparte entre dos medios: el segundo completa lo que falta. «Registrar sin cobrar» guarda la venta con el precio elegido |
| Detalle de la venta | Muestra qué precio se aplicó («Precio de Efectivo (−10 %)») y, por ítem, la lista y el precio editado si lo hubo |

Verificado en el navegador contra la base local: turno de $18.000 cobrado en efectivo en dos toques ($16.200), y venta de 2 productos de $4.500 con precio de efectivo dividida en $5.000 en efectivo y $3.000 con débito.

### Cambio del precio de una venta pendiente

Confirmado por el usuario el 2026-11-17: **anular y rehacer**. Ventas e ítems son de solo inserción, así que no se recalculan en el lugar.

- En el detalle de una venta **pendiente y sin cobros**, «Cambiar el precio» ofrece la lista y cada medio con ajuste, con el total que quedaría. Solo aparecen los que cambian el total.
- Al elegir uno, en **una sola transacción** se anula la venta (los productos vuelven al stock) y se registra otra igual con el precio nuevo: mismos servicios, profesionales, productos y descuento manual, y la seña del turno se vuelve a aplicar. Los precios editados a mano se conservan; el resto se recalcula.
- La venta anulada queda con el motivo «Cambio del precio aplicado» y la auditoría `venta.cambiarPrecio` une las dos. La nueva lleva la fecha del día en que se cambió.
- Con algún cobro ya no se cambia: se ajusta con el descuento al cobrar o anulando.
- Permisos: hacen falta `venta:registrar` y `venta:anular` (recepción tiene los dos).

### Pendiente

- ~~Cambiar el precio aplicado de una venta pendiente sin cobros.~~ Hecho el 2026-11-17: ver «Cambio del precio de una venta pendiente».
- ~~Portal con los dos precios (etapa 3).~~ Hecho el 2026-11-17: ver «Portal».

## Confirmado por el usuario (2026-11-16)

- **Redondeo:** por defecto a $100 hacia abajo.
- **Pago mixto:** al dividir, el precio por defecto es el de lista. Recepción puede cambiarlo con un toque.
- **Venta pendiente:** mientras no tenga cobros, se puede cambiar el precio aplicado. Con cobros, la diferencia se ajusta a mano. Cómo: anular y rehacer (confirmado el 2026-11-17).
- **Permisos:** configuran los medios el master, el franquiciado y el administrador de sede.
- **Gastos:** siguen con su lista fija (`MedioPagoGasto`). Un porcentaje no tiene sentido en un gasto.

## Preguntas abiertas

- **Comisiones (D10):** ¿sobre la lista, sobre el precio del medio o sobre lo cobrado? Quedan guardados los tres para decidir después.
