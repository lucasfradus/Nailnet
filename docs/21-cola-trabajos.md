# Cola durable de trabajos (outbox) · 2026-10-05

Implementa la parte de cola de F04. Migración `202610050012_jobs`. Lógica en `packages/database/src/jobs.ts`; el worker solo la conecta (`apps/worker`). Es la base para los emails (P03), el webhook de Mercado Pago (R04) y Facturante (M02). El staging de F04 sigue pendiente.

## Modelo

Tabla `Job`:

- **Identificación:** `tipo` («area.accion», p. ej. `email.reserva_confirmada`) y `clave` única, que deduplica.
- **Contenido:** `payload` JSON acotado a 16 KB. Guarda referencias (ids), no documentos ni secretos.
- **Control:** `estado`, `intentos`, `maxIntentos` (8 por defecto), `proximoIntento`, el lease (`leaseHasta`, `leaseDe`), `ultimoError` (resumen de hasta 1000 caracteres, sin stack ni payload) y `resultado`.

Estados: `PENDIENTE` → `EN_PROCESO` → `COMPLETADO`. Si se agotan los intentos o el error es permanente, pasa a `FALLIDO`, que queda para revisión (M04). `CANCELADO` queda reservado para anulaciones.

`CHECK` en la base:

- formato del tipo;
- longitud de la clave y del error;
- rango de intentos;
- un trabajo `EN_PROCESO` siempre tiene dueño y vencimiento de lease.

## Garantías

- **Outbox:** `encolarJob(tx, …)` se llama dentro de la transacción del cambio que origina el trabajo. Si se revierte, no queda trabajo; si confirma, el trabajo existe aunque el proceso se caiga enseguida.
- **Sin duplicados:** la misma clave encolada dos veces es un solo trabajo (`creado: false` la segunda vez, en cualquier estado).
- **Reparto:** `tomarJobs` usa `FOR UPDATE SKIP LOCKED`. Varios workers en paralelo nunca toman el mismo trabajo.
- **Reinicio:** cada toma fija un lease (5 min por defecto). Si el worker muere, al vencer el lease otro lo retoma con un intento más. El worker anterior ya no puede cerrarlo: completar y fallar exigen ser el dueño de esa toma (`leaseDe` e `intentos`).
- **Al menos una vez, no exactamente una:** un trabajo puede ejecutarse dos veces si el lease vence a mitad de camino, así que **cada manejador debe ser idempotente**. Para proveedores externos se usa además su idempotencia o una consulta por referencia antes de repetir (doc 02).
- **Reintentos:** espera creciente de 30 s, 1 min, 2 min… hasta 1 h, con ±20 % de azar para que no se agolpen.
  - `ErrorPermanente` va directo a `FALLIDO`.
  - Un trabajo que agotó los intentos sin cerrar nunca (por ejemplo, porque tumba al proceso cada vez) se marca `FALLIDO` sin volver a ejecutarse.
- **Tiempo límite:** un manejador que tarda más del 80 % del lease se da por fallido (se reintenta) y recibe un `AbortSignal`. Si responde al abort terminando sin error, igual cuenta como fallido: un caso que la prueba detectó y quedó corregido.
- **Tipos desconocidos:** cada worker toma solo los tipos que sabe manejar. Uno desconocido queda pendiente sin gastar intentos (útil en despliegues graduales).

## Worker

- **Tareas periódicas:** cada `WORKER_INTERVALO_SEGUNDOS` (30 por defecto) vence retenciones (R02) y encola la limpieza.
- **Trabajos:** cada `WORKER_JOBS_SEGUNDOS` (5 por defecto, mínimo 1) toma hasta 10.
- Los dos ciclos no se solapan consigo mismos.
- **Identidad:** cada arranque tiene un `workerId` propio (host:pid:azar) para los leases.
- **Apagado:** con SIGTERM deja de tomar trabajos, espera los que están corriendo y sale con 0. Lo que no termine lo retoma otra instancia al vencer el lease.
- **`GET /health`:** chequeo de vida, sin cambios.
- **`GET /ready`:** consulta la base y el estado de la cola.
  - Responde `{ status, cola: { pendientes, atrasados, leasesVencidos, fallidos } }`.
  - `status` es `degradado` si hay trabajos atrasados o leases vencidos hace más de 5 minutos (worker trabado o caído).
  - Los fallidos se informan pero no degradan: esperan revisión.
  - Sin base responde 503.

### Trabajos registrados

| Tipo | Origen | Qué hace |
|---|---|---|
| `mantenimiento.limpieza` | Tarea periódica, clave por hora: varias instancias encolan uno solo | Borra claves de idempotencia vencidas, eventos anti-abuso de más de 1 día, tokens de invitado vencidos o revocados hace más de 30 días y trabajos completados de más de 30 días. Los fallidos se conservan. Cierra la limpieza pendiente del doc 18 |

## Variables

| Variable | Default | Uso |
|---|---|---|
| `DATABASE_URL` | — | Sin ella el worker solo responde `/health` |
| `WORKER_INTERVALO_SEGUNDOS` | 30 (mín. 5) | Tareas periódicas |
| `WORKER_JOBS_SEGUNDOS` | 5 (mín. 1) | Ciclo de trabajos |
| `PORT` / `HOST` | 3001 / 127.0.0.1 | Servidor de `/health` y `/ready` |

## Build

`publico.ts` dejó de importar `imagenes.ts`: la ruta pública de una imagen ahora está en `@nailnet/contracts/publico` (`rutaImagen`). Antes, al importar la limpieza, el worker arrastraba `sharp` a su bundle y el build de producción no arrancaba (`createRequire` declarado dos veces).

## Verificación

- **`npm run test:database`:** 121 tests, 5 corridas seguidas sin fallas. `jobs.test.ts` cubre:
  - deduplicación y validaciones;
  - outbox con rollback;
  - 3 workers en paralelo sin repetidos;
  - próximo intento y tipos desconocidos;
  - lease vencido retomado y dueño anterior rechazado;
  - espera creciente, fallo permanente y agotado;
  - manejador colgado abortado;
  - trabajo que tumba al proceso;
  - estado de la cola, purga y limpieza pública.
- **Docker:** la limpieza horaria se encoló y completó. Un trabajo dejado `EN_PROCESO` por un worker «caído», con el lease vencido, fue retomado (intento 2) y completado.
- **Build de producción dentro del contenedor:** arranca, `/ready` responde `ok` y con SIGTERM sale con 0. En desarrollo `tsx watch` corta al proceso hijo sin dejarlo manejar la señal, así que esto solo se puede comprobar con el build.
- `npm run check` y `node scripts/smoke.mjs`.
