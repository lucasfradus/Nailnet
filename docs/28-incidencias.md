# Operación de incidencias · 2026-10-14

Implementa M04. Migración `202610150020_incidencias`. Reglas puras en `packages/domain/src/incidencias.ts`, repositorio en `packages/database/src/incidencias.ts`, pantallas en `apps/backoffice/src/app/(panel)/incidencias/` (acciones en `acciones.ts`).

**Estado:** bandeja, ficha, acciones y aviso funcionando con Postgres real. Los comprobantes fiscales no están: Facturante (M02) todavía no existe. La bandeja quedó preparada para sumarlos (ver «Comprobantes»).

## Qué es una incidencia

Una incidencia **no es una tabla propia**. Sale del estado de su fuente; lo único que se guarda es lo que hizo una persona (`AccionIncidencia`). Así no hay dos verdades que sincronizar:

- si la fuente se normaliza (el trabajo reintentado se completa, Mercado Pago informa el reembolso), la incidencia desaparece sola;
- si vuelve a fallar, reaparece como una ocurrencia nueva, sin revisar, con lo anterior en el historial.

| Fuente | Tipo | Cuándo |
|---|---|---|
| Cola (doc 21) | Trabajo fallido | `Job` en `FALLIDO`: agotó intentos o error permanente |
| | Trabajo atrasado | `PENDIENTE` con el próximo intento vencido hace más de 5 min (mismo umbral que `/ready`) |
| | Trabajo trabado | `EN_PROCESO` con el lease vencido hace más de 5 min |
| Pagos (doc 23) | Pago a devolver | `Pago` en `A_DEVOLVER`: horario ocupado, reserva cancelada, duplicado o monto/moneda/cuenta distintos |
| | Seña sin imputar | `APROBADO` de un turno `CANCELADA` o `EXPIRADA`. Incluye la reprogramación: el pago sigue contra la reserva original |
| | Pago en estado ambiguo | `EN_PROCESO` sin cambios hace 30 min (con `binary_mode` no debería pasar) |
| | Seña reembolsada con turno vigente | `REEMBOLSADO` sin motivo (era la seña de un turno), sin otro pago aprobado, y el turno sigue en pie |
| Emails (doc 24) | Email no enviado, rebotado, marcado como spam | `EnvioEmail` en `FALLIDO`, `REBOTADO` o `QUEJA` |

- `OMITIDO` no es una falla: el sistema decidió no mandarlo y dejó el motivo.
- Un `REEMBOLSADO` que conserva motivo viene de un `A_DEVOLVER`: es la devolución esperada, no una incidencia.
- **Sin duplicados:** un email `FALLIDO` cuyo trabajo también está `FALLIDO` (o ya rearmado y en la cola) se muestra una sola vez, como trabajo, que es lo que se puede reintentar. La ficha del trabajo enlaza la evidencia del email.
- **Nunca se muestra el payload** de un trabajo: solo tipo, intentos, error resumido y la sede.

## Estados y acciones

Estado de la ocurrencia actual: **sin revisar** → **en seguimiento** → **resuelta**. Se calcula con las acciones posteriores al último cambio de la fuente (`marcaFuente`).

| Acción | Sobre | Efecto |
|---|---|---|
| Marcar revisada | Cualquiera sin revisar | En seguimiento |
| Marcar resuelta | Cualquiera no resuelta | Resuelta. La fuente no cambia: un `FALLIDO` sigue `FALLIDO` |
| Reabrir | Resuelta | Sin revisar |
| Reintentar trabajo | Trabajo `FALLIDO` de un tipo habilitado | El **mismo** trabajo (id y clave) vuelve a `PENDIENTE` con intentos en cero |
| Registrar devolución gestionada | Pago a devolver o seña sin imputar | En seguimiento. **No** da la devolución por completa ni toca el pago |

- **Nota obligatoria** en todas (5 a 1000 caracteres): qué se revisó o qué se hizo. También la exige la base (`CHECK`).
- **Trazabilidad:** cada acción guarda quién, cuándo, la nota, el tipo de incidencia y el estado de la fuente en ese momento. También queda en `AuditLog` (`incidencia.revisada`, `incidencia.reintentada`…).
- **Nada se borra:** `AccionIncidencia` es solo inserción (trigger `solo_insercion`), las fuentes no se borran y la purga de la cola ya conservaba los fallidos.
- **Concurrencia:** la acción bloquea la fila de la fuente (`FOR UPDATE`). Dos reintentos simultáneos dejan pasar uno solo; el otro recibe «ya no está fallido» (probado).

### Reintento

Solo para tipos cuyo manejador es idempotente (lista en `reintentable`): `pagos.mercadopago`, `email.*`, `mantenimiento.limpieza`, `mercadopago.renovacion`.

- Un email con id de Resend no se reenvía, y Resend deduplica 24 h por la misma clave.
- Un pago se vuelve a consultar en la API y aplicarlo no duplica.
- Un tipo nuevo (por ejemplo, Facturante) no se reintenta desde el panel hasta revisarlo y sumarlo a la lista.
- Atrasados y trabados no se rearman a mano: la cola los retoma sola cuando vuelve el worker.

### Devoluciones

No hay reembolsos desde el sistema (M01) y la política sigue pendiente (D5). «Devolución gestionada» deja constancia de que alguien la pidió o la hizo afuera (por ejemplo, desde el panel de Mercado Pago, con el número de operación). La incidencia se cierra:

- sola, cuando Mercado Pago notifica el reembolso y el pago pasa a `REEMBOLSADO`;
- o cuando una persona la marca resuelta con nota (por ejemplo, devolución por transferencia, o la seña se pasó al turno nuevo).

## Alcance

Permiso nuevo `incidencia:gestionar`, con el mismo mecanismo de alcance que el resto (`access.ts`, `cubreSede`). Está en una tabla aparte de la principal para no pisar cambios de otros módulos.

| Rol | Ve y opera |
|---|---|
| Master | Todo lo de la organización, incluidos trabajos sin sede y trabajos del sistema |
| Franquiciado | Incidencias de sus sedes |
| Administración de sede | Incidencias de su sede |
| Recepción, profesional | Nada (ni bandeja, ni ficha, ni aviso) |

- **La sede de una incidencia:**
  - pago: su sede;
  - email: la de su reserva;
  - trabajo: la del payload (`sedeId`, pagos) o la de su reserva (emails), siempre que sean de la organización.
- **Sin sede o sin organización** (limpieza, renovación de tokens, recuperación de contraseña, un payload que apunta a otra organización): solo el master.
- Un trabajo **sin organización** lo ve el master de cualquier organización. Hoy hay una sola (Sicurella). Con más organizaciones conviene restringirlo a un rol de plataforma (pendiente).
- Las acciones de un trabajo sin organización quedan auditadas en la organización del master que actuó.
- **Por ID:** leer o actuar sobre una incidencia fuera del alcance (otra sede, otra organización, fuente equivocada, id mal formado) es «acceso denegado», igual que si no existiera. Un filtro de sede ajena se rechaza; no amplía.

**Por qué recepción no:** la bandeja es revisión de dinero (devoluciones) y de la cola, no operación del día. El código ya separa así otros permisos (credenciales, compras y ajustes de stock). A confirmar con Sicurella.

## Pantallas

- **Bandeja** (`/incidencias`): todas las sedes del alcance, de la más urgente a la más reciente. Filtros:
  - tipo: cola, pagos, emails;
  - sede, o «sin sede» para el master;
  - estado: pendientes (por defecto), sin revisar, resueltas, todas.
- **Ficha** (`/incidencias/{trabajo|pago|email}/{id}`): datos de la fuente, qué hacer según el tipo, acciones con nota e historial. Si la fuente ya se normalizó, queda el historial sin acciones.
- **Aviso:** el lateral muestra el número de incidencias sin revisar junto a «Incidencias», y el inicio muestra un aviso con enlace. Las que están en seguimiento no cuentan.

## Comprobantes (M02)

Facturante todavía no existe, así que no hay comprobantes fallidos ni ambiguos que mostrar. Para sumarlos:

1. Agregar `COMPROBANTE` a `FuenteIncidencia` (migración `ALTER TYPE … ADD VALUE`) y a `FUENTES`.
2. Escribir su clasificador en el dominio: emisión fallida, consulta ambigua tras un timeout, nota de crédito pendiente.
3. Escribir su cargador en el repositorio, con la sede del comprobante.
4. Sumar el tipo del trabajo de emisión a `reintentable` **solo** si el reintento consulta antes de reemitir (doc 02: «timeout ambiguo no reemite a ciegas»).

## Pendiente

- **Comprobantes** con M02 (arriba).
- **Reembolso desde el sistema** (M01) y política de devoluciones (D5): hoy la devolución se hace en Mercado Pago y se registra acá.
- **Alertas fuera del panel** (email o canal al master) para trabajos atrasados y pagos a devolver: hoy el aviso se ve al entrar al backoffice.
- **Paginación:** se leen hasta 200 registros por fuente (los más recientes) y la pantalla avisa si se cortó. Alcanza para el piloto.
- **Trabajos sin organización** con varias organizaciones (ver «Alcance»).
- **Rebotes:** marcar al cliente para no volver a escribirle (doc 24) sigue pendiente; la incidencia solo avisa.
- **Conciliación periódica** de pagos aprobados que nunca llegaron (doc 23, M01): un pago que no se registró no puede aparecer acá.

## Verificación

- `npm run test:domain` (8 casos nuevos):
  - clasificación de trabajos, pagos y emails;
  - estado derivado por ocurrencia;
  - acciones permitidas y tipos reintentables;
  - nota obligatoria;
  - alcance por rol, sede y organización;
  - referencias del payload.
- `npm run test:database`, `incidencias.test.ts` sobre Postgres real (165 tests en total, todos verdes):
  - alcance de la bandeja para los cinco roles y otra organización;
  - clasificación, sede y datos de cada fuente; contador;
  - filtros y rechazo de sedes ajenas;
  - acceso cruzado por ID en lectura y escritura (15 casos), sin dejar rastro;
  - revisar, gestionar la devolución, resolver y reabrir, con historial y auditoría, sin tocar el pago;
  - cierre automático al reembolsarse;
  - reintento: mismo trabajo, dos personas a la vez, reaparición si vuelve a fallar, tipos no habilitados;
  - inmutabilidad y `CHECK` de la tabla.
- `npm run check` y `node scripts/smoke.mjs`. No se probó en un navegador real.
