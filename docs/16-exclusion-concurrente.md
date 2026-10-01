# Retención de turnos y exclusión concurrente · 2026-10-01

Implementa C05, la puerta de salida de la fase 3. Migración `202610010007_retencion`. Sin pantalla nueva: tomar turnos desde recepción llega con R01, desde el portal con P01.

## Qué hace `retenerTurno`

Retiene un turno (uno o varios servicios encadenados) como `PENDIENTE_PAGO` hasta `expiraEn`, todo o nada. Guarda cada ítem con profesional, intervalo, recursos asignados y una copia (snapshot) de duración, preparación, precio y seña. Un cambio posterior del catálogo no altera el turno.

**Protocolo** (doc 02 · disponibilidad y exclusión concurrente):

1. **Primera pasada sin locks:** solo calcula qué filas hay que bloquear (profesionales candidatos y recursos de los tipos requeridos en la sede).
2. **Bloqueo:** `SELECT … FOR UPDATE` sobre esas filas en **orden estable por ID**: primero profesionales, después recursos. Los guardados de jornada y las ausencias usan el mismo lock de fila del profesional; antes era un lock advisory y ahora es uno solo para todo.
3. **Revalidación bajo lock:** con el **mismo** cargador y motor que la consulta de disponibilidad. Los candidatos y recursos se limitan a las filas bloqueadas, así no se cuela un profesional o recurso que apareció entre la primera pasada y el lock.
4. **Limpieza:** las retenciones vencidas de esos profesionales pasan a `EXPIRADA`. El motor ya las ignoraba; esto mantiene el estado coherente sin depender del worker.
5. **Escritura:** reserva, ítems y recursos en la misma transacción. Si el horario ya no entra, se lanza `TurnoNoDisponible` (equivale a HTTP 409) y no queda nada parcial.
6. **Deadlock:** reintento acotado (3 intentos). El orden estable debería evitarlo.

No basta con bloquear reservas existentes: en el horario disputado puede no haber ninguna fila. Por eso se bloquean las filas de profesionales y recursos, que siempre existen.

**Permisos:** con usuario, se requiere `reserva:gestionar` sobre la sede (recepción, admin de sede, franquiciado o master). Sin usuario (portal), solo canal `ONLINE`. La protección del portal contra abuso (idempotencia, límites, captcha) es R05.

## Retención (D4): configurable, sin valor por defecto

Se agregó `retencionMinutos` (5–60) a la configuración heredable. Sin valor no se retienen turnos (`ConfiguracionIncompleta`). La propuesta de 15 minutos sigue pendiente de aprobación.

D6 (si recepción exige seña por Mercado Pago o confirma directo) sigue abierta. Por eso esta etapa solo implementa la retención pendiente común a ambos canales; los estados firmes llegan con R01 y R04.

## Prueba de exclusión (en CI, PostgreSQL real)

`packages/database/tests/reservas.test.ts`, con conexiones simultáneas reales del pool:

| Escenario | Resultado esperado y obtenido |
|---|---|
| 10 intentos simultáneos, misma profesional y horario | 1 gana, 9 `TurnoNoDisponible` |
| Turno contiguo (termina 09:50, otro empieza 09:50) | Válido; uno que se pisa, rechazado |
| «Cualquiera» con 3 profesionales y 5 intentos simultáneos | Ganan 3, cada una con profesional distinto |
| Un único equipo láser disputado por dos profesionales | 1 gana |
| Misma profesional, turnos contiguos en dos sedes, en paralelo | Ambos válidos; el turno de una sede la bloquea en la otra |
| Cadena de dos servicios cuyo segundo ítem choca | Rechazada sin reserva parcial; una cadena válida crea 2 ítems |
| Retención vencida | Deja de ocupar; al volver a reservar pasa a `EXPIRADA` |
| Cambio de jornada en paralelo con una retención | Serializados por el mismo lock |

El test corrió 3 veces seguidas sin fallos intermitentes.

## Limitaciones conocidas

- **Turnos vigentes:** cambiar una jornada o cargar una ausencia todavía no valida contra turnos existentes. Quedan serializados, pero una jornada nueva puede dejar afuera un turno ya retenido. Se resuelve con R01/R03 (reprogramación y rechazo de cambios en conflicto).
- **Segunda defensa:** una restricción de exclusión de rangos en PostgreSQL (`btree_gist`) no se agregó. El «estar activa» de una reserva depende del tiempo (`expiraEn`), y eso no se puede expresar en una restricción. Se puede evaluar una tabla de ocupaciones activas mantenida por la aplicación.
- **Rendimiento:** la retención hace dos cargas del día (sin lock y con lock). Es suficiente para el volumen del piloto.

## Verificación

- `npm run test:database`: 81 tests, incluidos los 9 escenarios de este documento.
- `npm run test:domain`, `npm run check` y el smoke HTTP también pasan.
