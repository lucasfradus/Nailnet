# Gastos de sede · 2026-10-14

Implementa O04. Migración `202610140030_gastos`. Reglas puras en `packages/domain/src/gastos.ts`. Repositorio en `packages/database/src/gastos.ts`. Pantallas: Gastos y Gastos › Categorías.

## Qué se puede hacer

| Pantalla | Quién | Operaciones |
|---|---|---|
| Gastos | Master, franquiciado (sus sedes), admin de sede (su sede) | Ver los gastos de la sede elegida arriba, filtrar por período y categoría, ver totales |
| | Los mismos | Registrar un gasto y anularlo con motivo |
| Categorías | Los mismos | Ver categorías globales y las de la sede |
| | Master | Crear, renombrar, desactivar y reactivar categorías globales |
| | Master, franquiciado, admin de sede | Lo mismo con las categorías locales de las sedes de su alcance |

**Recepción y profesionales no ven gastos.** Los permisos nuevos (`gasto:leer`, `gasto:registrar`, `gasto:anular`, `gasto:categorias`) están en una tabla aparte en `packages/domain/src/access.ts`. Se evalúan con el mismo `cubreSede` que el resto del panel.

Como en las demás pantallas, la sede elegida arriba es solo un filtro. Cada operación vuelve a autorizar en el repositorio. Si un ID de sede, gasto o categoría está fuera del alcance (o está mal formado), el repositorio responde acceso denegado, lo mismo que si el recurso no existiera. Las pruebas cubren lectura y escritura por ID.

## Categorías: globales y locales (D12)

Se aplica el criterio de D12 (común en la organización, con excepciones locales). `CategoriaGasto.sedeId` vale null en las globales y tiene la sede en las locales, el mismo patrón que `ExcepcionHorario`.

- **Global:** vale en todas las sedes. Solo la administra quien tiene alcance de organización (el master).
- **Local:** vale solo en su sede. La administra el master, el franquiciado de la sede o su admin.
- **Nombres:** se comparan sin distinguir mayúsculas ni acentos.
  - Una global no puede repetir el nombre de ninguna categoría de la organización.
  - Una local no puede repetir una global ni otra local de su sede.
  - Dos sedes pueden tener locales con el mismo nombre.
  - El repositorio valida esto bajo el lock de la organización. Los índices únicos parciales de la base (`lower(nombre)`) son una segunda barrera, solo efectiva para letras sin acento con la collation C.
- **Sin borrado:** una categoría se desactiva. Deja de ofrecerse al cargar gastos, pero sigue en el historial y en los filtros. Los gastos ya cargados en ella se pueden anular igual.
- Un gasto solo puede usar una categoría global o local de su misma sede. Lo controlan el repositorio y un trigger.

## Gasto

| Campo | Detalle |
|---|---|
| Sede | Obligatoria y activa al registrar |
| Categoría | Activa, global o de la misma sede |
| Fecha | Fecha local de la sede en que se hizo el gasto. No puede ser futura ni tener más de 366 días |
| Monto | ARS en `Decimal(12,2)` (`monto`), como precios y pagos. Se ingresa como «12500,50». Nunca `Number` |
| Medio de pago | Efectivo, transferencia, tarjeta de débito, tarjeta de crédito, Mercado Pago u otro |
| Descripción | De 3 a 500 caracteres |
| Comprobante | Opcional, hasta 120 caracteres: referencia libre (tipo y número, proveedor). Sin archivo |
| Registrado por | Usuario de la sesión (`registradoPorId`) y momento (`createdAt`) |

## Anulación por reverso

Un gasto no se edita ni se borra. Para corregirlo se anula y se carga de nuevo.

- **Reverso:** la anulación inserta otro movimiento `REVERSO`. Tiene el monto negado, la misma sede, categoría, fecha y medio, y además el motivo (obligatorio, de 5 a 500 caracteres). Quién anuló queda en `registradoPorId` del reverso y cuándo, en su `createdAt`. El gasto original no cambia.
- **Una sola vez:** `@@unique([organizacionId, revierteId])` permite un único reverso por gasto. Anulaciones simultáneas: gana una y las demás reciben «El gasto ya fue anulado» (probado).
- **En la base:**
  - Un trigger `solo_insercion` impide `UPDATE` y `DELETE` sobre `Gasto`.
  - El `CHECK` `Gasto_forma` exige monto positivo y sin motivo en un `GASTO`, y monto negativo, `revierteId` y motivo en un `REVERSO`.
  - El trigger `gasto_coherente` rechaza un reverso que no copie exactamente el original o que revierta otro reverso.
  - El mismo trigger rechaza una categoría local de otra sede o inactiva.
- **Auditoría:** cada alta, anulación y cambio de categoría se registra también en `AuditLog`.

## Totales

El total del período es la suma de los movimientos con fecha en el período. **El reverso lleva la fecha del gasto original**, así que un gasto anulado suma cero en su propio período, aunque se anule semanas después. El listado muestra:

- el total del período;
- el subtotal en efectivo;
- el total por categoría.

Los anulados siguen a la vista, tachados, con quién, cuándo y por qué. El período por defecto es el mes en curso de la sede. Admite hasta 366 días y como máximo 2000 movimientos; si hay más, pide acotarlo.

## Preparado para caja (O02), sin implementarla

- El medio de pago queda guardado en cada movimiento. `afectaCajaEfectivo(medio)` (dominio) define que solo `EFECTIVO` sale del efectivo de la sede. El listado ya separa el subtotal en efectivo.
- Propuesta para O02:
  - registrar un gasto en efectivo crea en la misma transacción un egreso de la caja abierta de la sede, que referencia `gastoId`;
  - el reverso crea el contra-movimiento en la caja abierta al momento de anular, no en la del día del gasto (una caja cerrada no se reescribe);
  - para eso alcanza con sumar una columna o tabla de vínculo cuando exista la caja.
- No se agregó ninguna columna de caja ni se simula su comportamiento.

## Diferencias con el modelo de 02-arquitectura

- **Sin `GastoPago`:** la arquitectura proponía `CategoriaGasto`, `Gasto` y `GastoPago`, separando el devengamiento del pago real. En el MVP un gasto se registra ya pagado, con su medio. Si Sicurella necesita registrar facturas a pagar o pagos en cuotas, se agrega `GastoPago` sin romper lo existente.
- **Montos en `Decimal(12,2)`, como catálogo y pagos:** el dominio calcula en centavos `bigint` (`aCentavos`/`importe`, igual que la seña) y el repositorio convierte en el borde. Así caja (O02) y reportes (L03) suman importes del mismo tipo.

## A confirmar con Sicurella

- **Recepción:** ¿registra gastos menores (artículos de limpieza, café) o solo el admin? Hoy no tiene acceso. Si la respuesta es sí, se le da `gasto:registrar` (y probablemente `gasto:leer` limitado), en línea con su papel en la caja.
- **Período del reverso:** hoy el reverso lleva la fecha del gasto original. Si la contabilidad cierra meses, quizá prefieran imputarlo al mes de la anulación.
- **Lista inicial de categorías globales:** por ejemplo alquiler, expensas, servicios, limpieza, insumos no inventariables, mantenimiento, publicidad local, honorarios e impuestos.
- **Antigüedad máxima** de un gasto (hoy 366 días) y si hace falta adjuntar el archivo del comprobante (hoy es una referencia de texto).
- **Medios de pago:** si se suman otros (cheque, cuenta corriente del proveedor).

## Pendiente

- Egreso de caja para gastos en efectivo (O02).
- Exportación CSV y consolidado entre sedes (L03/L04). Hoy el listado es por sede.
- Archivo adjunto del comprobante, si se confirma.
- Clave de idempotencia en el alta: hoy el botón se deshabilita mientras se envía, pero un doble envío forzado crearía dos gastos (se anula uno).

## Verificación

- `npm run test:domain` (gastos):
  - validación del alta: monto en centavos, fecha futura o antigua, medio, textos;
  - motivo de anulación;
  - período y mes calendario;
  - totales con reverso y subtotal en efectivo;
  - permisos por rol;
  - administración de categorías globales y locales.
- `npm run test:database`, `tests/gastos.test.ts`, 6 escenarios en PostgreSQL:
  - categorías globales y locales: quién las crea, nombres repetidos con mayúsculas y acentos, edición por ID fuera de alcance y de otra organización;
  - alta: sede ajena, otro franquiciado, recepción, profesional, otra organización, categoría local de otra sede, ID mal formado, fecha futura, categoría inactiva;
  - lectura por ID y por sede dentro y fuera del alcance; totales del período;
  - anulación: escritura por ID fuera de alcance, motivo obligatorio, doble anulación, un reverso no se anula, el original intacto, el total excluye lo anulado;
  - anulaciones simultáneas: solo una gana;
  - la base rechaza `UPDATE`/`DELETE`, reversos incoherentes, gastos negativos, categorías de otra sede y nombres globales repetidos.
- No se probó en un navegador real.
