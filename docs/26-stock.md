# Compras, stock y consumo interno · 2026-10-14

Implementa O03. Migración `202610140015_stock`. Pantallas: Stock (listado por sede y ficha de producto) y Compras.

## Global y local

Sigue el mismo criterio que el catálogo (D12, todavía sin confirmar; ver 13-catalogo.md):

| Nivel | Qué define | Quién |
|---|---|---|
| Organización | Producto o insumo: nombre, código opcional, unidad de medida, si es vendible, activo | Master |
| Sede | Precio de venta (solo vendibles), stock, compras, consumos, ajustes y transferencias | Según el permiso de cada operación, dentro de su alcance |

- **Vendible o consumo interno:** un producto vendible puede venderse en recepción (cuando exista O01) y también consumirse. Uno no vendible es solo insumo: no lleva precio y el egreso por venta lo rechaza.
- **Unidad de medida:** unidad, ml, l, g o kg, fija por producto. No hay conversión entre unidades. Una vez que el producto tiene movimientos la unidad no cambia, porque reinterpretaría las cantidades ya registradas: se crea otro producto.
- **Precio de venta por sede:** con el mismo permiso que el precio de los servicios (`catalogo:precios`). Una sede no hereda el precio de otra.
- **Desactivar** un producto lo saca de compras y del alta de consumos del panel. Su stock y su historial se conservan, y el saldo que queda se puede consumir, ajustar o transferir.

## Cantidades exactas

- Cantidades fraccionarias con hasta 3 decimales, en la unidad del producto (por ejemplo, 0,25 g o 12,5 ml).
- En la base son `Decimal(14,3)`. En el dominio se manejan como milésimas enteras (`bigint`) y hacia afuera como cadenas («1.5»). Nunca `Number`: 0,1 + 0,2 da 0,3 exacto (está en los tests).
- Los formularios aceptan coma o punto decimal, sin separador de miles.
- **Costo de compra:** unitario por unidad de medida, en centavos en el dominio y `Decimal(12,2)` en la base. El subtotal de cada ítem es cantidad × costo, redondeado al centavo (mitad hacia arriba). El total de la compra es la suma de los subtotales.

## Movimientos: el saldo se deriva, nada se edita

`StockSede` guarda el saldo vigente por sede y producto. Solo lo escribe `packages/database/src/stock.ts`, en la misma transacción que el movimiento que lo explica. `MovimientoStock` es de solo inserción (trigger, como la auditoría). Cada movimiento guarda la cantidad con signo y el saldo que dejó.

| Tipo | Signo | Origen | Permiso |
|---|---|---|---|
| `COMPRA` | + | Ítem de una compra a proveedor | `stock:gestionar` |
| `CONSUMO_INTERNO` | − | Uso de insumos en la sede, con detalle opcional | `stock:consumir` |
| `AJUSTE` | ± | Conteo físico: se informa lo contado y se registra la diferencia. Motivo obligatorio | `stock:gestionar` |
| `VENTA` | − | `egresarPorVenta`, dentro de la transacción de la venta (O01). Guarda `ventaId` sin FK hasta que exista Venta | `stock:consumir` |
| `TRANSFERENCIA_SALIDA` / `_ENTRADA` | − / + | Transferencia inmediata entre dos sedes, con un `transferenciaId` compartido | `stock:gestionar` en ambas sedes |
| `REVERSO` | ± | Anula una compra, un consumo o un ajuste con el movimiento inverso. Motivo obligatorio | `stock:gestionar` |

- **Corrección por reverso:** un movimiento se revierte una sola vez (índice único sobre `revierteId`, también en paralelo). Un reverso no se revierte. Ventas y transferencias no se revierten desde stock: la venta se anulará desde O01 y una transferencia se corrige con otra en sentido contrario.
- **Compras:** también son de solo inserción. Una compra mal cargada se corrige revirtiendo sus ingresos desde la ficha del producto y cargándola de nuevo. Si el stock ya se consumió, el reverso se rechaza porque dejaría el saldo negativo: en ese caso corresponde un ajuste.
- **Defensa en la base:** `CHECK` de saldo no negativo en `StockSede` y en el saldo resultante, de signo por tipo y de origen coherente. Por ejemplo, una compra lleva su ítem, un reverso lleva el original, ajuste y reverso llevan motivo, y solo una venta lleva `ventaId`.
- **Auditoría:** el alta y edición de productos, precios, compras y reversos quedan en `AuditLog`. Los movimientos ya son su propio registro, con actor y fecha.

## Venta concurrente sin negativo

Mismo enfoque que la exclusión de turnos (doc 16), aplicado a filas de saldo:

1. **Filas a bloquear:** se crean en cero las filas de saldo que falten (`INSERT … ON CONFLICT DO NOTHING`). Así siempre hay una fila que bloquear, aunque el producto nunca haya tenido stock en esa sede.
2. **Bloqueo:** `SELECT … FOR UPDATE` sobre esas filas en **orden estable (sede, producto)**. Una transferencia toca dos sedes y una venta varios productos: con el mismo orden no hay deadlocks entre ellas. Igual hay reintento acotado (`conReintento`, 3 intentos).
3. **Cálculo bajo lock:** se aplican los movimientos sobre el saldo leído (`aplicarDeltas`, función pura). Si alguno quedaría negativo se lanza `SinStock` y no se escribe nada, ni siquiera los otros ítems. `SinStock` extiende `DatosInvalidos`, así el panel muestra el mensaje; para O01 equivale a HTTP 409.
4. **Escritura:** saldo y movimientos en la misma transacción.

El ajuste calcula la diferencia contra el saldo **bajo el mismo lock**. Un consumo que entra durante el conteo no queda pisado.

`egresarPorVenta(tx, …)` recibe la transacción de quien llama: la venta de O01 y su egreso quedan juntos o no queda ninguno. Quien llama envuelve su transacción con `conReintento`.

## Permisos

| Permiso | Master | Franquiciado | Admin de sede | Recepción | Profesional |
|---|---|---|---|---|---|
| `producto:administrar` (definición global) | ✓ | | | | |
| `stock:leer` | ✓ | sus sedes | su sede | sus sedes | |
| `stock:consumir` (consumo interno, venta) | ✓ | sus sedes | su sede | sus sedes | |
| `stock:gestionar` (compras, ajustes, transferencias, reversos) | ✓ | sus sedes | su sede | | |

Todo se autoriza en el repositorio con el mecanismo de alcance de siempre (`asignacionesActor` + `cubreSede`). Probado por ID en lectura y escritura:

- sede ajena;
- producto o movimiento de otra organización;
- ID mal formado;
- transferencia a una sede de otro franquiciado o sin alcance en el destino.

La ficha muestra el saldo de otras sedes solo si el actor tiene `stock:leer` en ellas.

## Pendiente y a confirmar con Sicurella

- ~~**Venta de productos (O01):** el egreso ya existe, pero no hay venta ni anulación de venta. La anulación deberá generar un movimiento de ingreso con referencia a la venta.~~ Hecho el 2026-10-14 (27-ventas-caja.md): la venta usa `egresarPorVenta` en su transacción, `MovimientoStock.ventaId` ya tiene FK a `Venta`, y la anulación repone con un `REVERSO` por cada egreso (`reponerPorAnulacionVenta`), solo si se indica que los productos volvieron.
- **Quién hace qué:** propuesta de que recepción vea el stock y registre consumos (y ventas), pero no compras, ajustes ni transferencias. Confirmar.
- **Transferencias entre franquiciados:** hoy solo las hace quien tiene alcance en las dos sedes (el franquiciado entre sus sedes; el master entre cualquiera). Entre franquiciados distintos implican una operación comercial que no está modelada. Tampoco hay estado «en tránsito» ni confirmación de recepción.
- **Proveedores:** texto libre en la compra. Un maestro de proveedores queda para cuando haga falta (reportes, cuentas a pagar).
- **Compras y gastos (O04):** la compra registra el costo, pero no genera un gasto ni un egreso de caja. Definir si una compra pagada debe impactar en gastos o en caja (O02) y cómo, sin contarla dos veces.
- **Valorización:** no se calcula el costo promedio ni el valor del inventario. Los costos quedan guardados por ítem para hacerlo después (L03).
- **Consumo por servicio:** el consumo interno es manual. Descontar insumos automáticamente al atender un turno (receta por servicio) queda fuera del MVP.
- **Stock mínimo y alertas, categorías de producto (CategoriaProducto del doc 02) y códigos de barras:** no se implementaron.
- **Paginación:** la ficha muestra los últimos 200 movimientos y Compras las últimas 50.

## Verificación

- `npm run test:domain`: cantidades exactas, signos por tipo, todo o nada sin negativos, ajuste por conteo, subtotal al centavo y permisos por rol.
- `npm run test:database`: 11 escenarios de stock en PostgreSQL:
  - productos solo del master, nombres y códigos únicos, unidad bloqueada con movimientos;
  - precio por sede solo para vendibles;
  - compra con cantidades fraccionarias y total al centavo;
  - consumo todo o nada sin negativos;
  - ajuste con motivo, reverso único y reverso rechazado si deja negativo;
  - transferencia dentro del alcance;
  - acceso cruzado por ID;
  - triggers de inmutabilidad y `CHECK`;
  - egreso por venta;
  - **venta concurrente desde dos conexiones:** una retiene el lock y la otra espera y se rechaza con saldo 0,5. Además, 10 ventas en paralelo sobre 5,5: ganan 7 y quedan 0,25;
  - saldo igual a la suma de sus movimientos.
- `npm run check`.
- La UI no se probó en un navegador real.
