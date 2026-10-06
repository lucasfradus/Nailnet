# Agenda y reserva manual · 2026-10-01

Implementa R01 con las decisiones del 2026-10-01: D3, D4 y D6 confirmadas; D5 sigue abierta. Migración `202610010008_agenda`. Pantallas: Agenda (día/semana) y Nuevo turno.

## Decisiones aplicadas

| Decisión | Aplicación |
|---|---|
| D3 · Seña | Porcentaje por servicio, definido por el master (catálogo). La sede puede usar otro valor. Sin porcentaje general: un servicio sin seña definida no se ofrece online |
| D4 · Retención | 15 minutos por defecto, sin extensión. Se puede ajustar por organización o sede. La pantalla de sede lo muestra como «valor por defecto» |
| D6 · Recepción | Configurable por sede (o para toda la organización). Por defecto confirma directo sin seña. La sede puede exigir seña por Mercado Pago |
| D5 · Cancelación | Pendiente. R03 implementará cancelar y reprogramar sin reembolso automático |

## Estado inicial del turno

`tomarTurno` reemplaza a `retenerTurno`, que se conserva como alias. Usa el mismo protocolo de exclusión (doc 16) y decide el estado según canal y política:

| Canal | Seña del turno | Política de la sede | Estado inicial |
|---|---|---|---|
| Online | Mayor a 0 | — | `PENDIENTE_PAGO`, vence en la retención (15 min) |
| Online | 0 (servicios sin seña) | — | `CONFIRMADA` |
| Recepción | Cualquiera | No exige (por defecto) | `CONFIRMADA` |
| Recepción | Mayor a 0 | Exige seña | `PENDIENTE_PAGO`, vence en la retención |

- **Cliente:** recepción exige cliente. Si no estaba vinculado a la sede, queda vinculado.
- **Snapshots:** la seña calculada se guarda aunque no se cobre, para que R04/M03 puedan aplicarla.
- **Historial:** cada reserva registra eventos inmutables (`ReservaEvento`: creada, confirmada, vencida, etc.), con estado anterior, estado nuevo y actor. Al tomar turnos, las retenciones vencidas de esos profesionales pasan a `EXPIRADA` con su evento.

## Pantallas

- **Agenda:** vista de día o semana, navegación anterior/siguiente/hoy y filtro por profesional. Opcionalmente muestra cancelados y vencidos.
  - Cada turno muestra horario, servicio, cliente (con enlace a la ficha), teléfono, profesional, recursos, canal, estado y vencimiento si está pendiente.
  - Permiso `reserva:gestionar`: recepción, admin de sede, franquiciado y master.
- **Nuevo turno**, en tres pasos:
  1. Buscar y elegir cliente.
  2. Elegir hasta 3 servicios encadenados con profesional opcional y la fecha.
  3. Reservar uno de los horarios del motor.
  - Al reservar se revalida todo bajo lock. Si alguien tomó el horario en el medio, se muestra «Ese horario ya no está disponible».
- **Ficha de sede:** se agregó la política de seña en recepción (sede u organización) con su origen.

## Pendiente

- R02: worker que expira retenciones y libera horarios sin esperar una nueva reserva (hoy el motor ya ignora las vencidas).
- R03: cancelar, reprogramar, atendido y ausente, con validación de cambios de jornada contra turnos.
- R04: enlace de pago de seña por Mercado Pago para los pendientes y confirmación por webhook. Requiere credenciales sandbox (F05).
- Consentimientos: el turno no se bloquea si falta un consentimiento exigido por el servicio. Corresponde avisarlo al atender (R03).
- Agenda propia del profesional: requiere vincular el usuario con la ficha del profesional.

## Verificación

- `npm run test:database`: 87 tests. Los nuevos de R01 cubren:
  - D6 por defecto, con evento inmutable y conflicto;
  - sede que exige seña, con 15 minutos y servicio sin seña confirmado;
  - permisos de la política;
  - online con y sin seña;
  - validaciones de cliente, permiso y organización;
  - agenda con orden, filtro por profesional, vencidas ocultas, cerrados, alcance y rango.
- Los tests de C05 se adaptaron: recepción exige cliente y la sede de prueba exige seña para seguir probando retenciones.
- Prueba E2E manual con `next dev`, configurando todo desde la UI:
  - recepción busca la clienta;
  - reserva 09:00;
  - la ve confirmada en la agenda;
  - 09:00 y 09:30 dejan de ofrecerse y 10:00, contiguo, sigue disponible.
  - No se probó en un navegador real.

## Worker: vencimiento de retenciones (R02) · 2026-10-01

- `expirarRetenciones` pasa a `EXPIRADA` las reservas pendientes vencidas, con su evento, aunque nadie vuelva a reservar. El motor ya las ignoraba; esto deja el estado y el historial al día.
- **Transición condicional** (sigue pendiente y vencida):
  - varias instancias del worker, un reinicio a mitad de camino o la limpieza que hace `tomarTurno` nunca generan dos cambios ni dos eventos (probado con tres corridas simultáneas);
  - la aprobación de pago de R04 usará la transición condicional inversa (pendiente y no vencida → confirmada) sobre la misma fila, así que vencimiento y aprobación no pueden ganar ambos. Un pago que llegue tarde abrirá una incidencia (doc 02).
- **El worker** (`apps/worker`) corre la tarea al iniciar y luego cada `WORKER_INTERVALO_SEGUNDOS` (30 por defecto, mínimo 5), sin solapar vueltas.
  - Un error se registra y se reintenta en la vuelta siguiente.
  - Al apagarse espera la vuelta en curso.
  - Sin `DATABASE_URL` queda solo con el chequeo de vida, como antes, así que el smoke no necesita base.
- **Build:** el cliente de Prisma generado usa sintaxis que Node no ejecuta quitando tipos.
  - En desarrollo el worker corre con `tsx watch`.
  - El build valida tipos y empaqueta con `esbuild` en `dist/index.js` (≈250 KB), con los paquetes del monorepo incluidos y Prisma, `pg` y `dotenv` como dependencias externas.
- **Verificado contra PostgreSQL embebido:** el bundle arrancó, expiró una retención vencida con un evento y respondió el chequeo de vida.
- **F04:** la cola durable de trabajos y el outbox están en el doc 21.

## Operación del turno (R03) · 2026-10-01

Migración `202610010009_reprogramacion`. Todas las operaciones toman primero el lock de los profesionales del turno (el mismo protocolo de doc 16), releen el estado y hacen una transición condicional. Cada cambio deja un evento inmutable.

| Operación | Desde | Reglas |
|---|---|---|
| Cancelar | Confirmado o pendiente vigente | Motivo obligatorio. Libera el horario en el acto. D5 pendiente: sin reembolso automático; el evento lo deja anotado y la devolución, si hubo seña, es manual (M01) |
| Atendido | Confirmado | Desde una hora antes del inicio. Exige los consentimientos de práctica que piden los servicios, vigentes (última versión aceptada y no revocada); si falta, indica cuál registrar en la ficha del cliente |
| Ausente | Confirmado | Solo después del inicio |
| Reprogramar | Confirmado | Atómico: libera el original y toma el nuevo horario en la misma transacción con los locks de ambos (incluidos recursos). El nuevo puede solaparse con el viejo. Si no entra, no cambia nada. Conserva servicios, cliente, canal, notas y **precio y seña pactados**. La nueva reserva enlaza a la original (`reemplazaId`); la original queda cancelada con evento `REPROGRAMADA`. Usa reglas de recepción (sin anticipación ni horizonte online). Dos reprogramaciones simultáneas: gana una |

**Cambios de calendario contra turnos (pendiente de C03, resuelto).** Cambiar la jornada de un profesional, cargarle una ausencia, cambiar el horario de la sede o crear una fecha especial o un feriado se rechaza si deja afuera turnos vigentes futuros. El mensaje indica cuántos son y cuál es el primero, para reprogramarlos o cancelarlos antes. La verificación corre bajo los locks de los profesionales involucrados.

Durante esta etapa los tests detectaron un bug propio: el filtro de la validación pisaba el filtro de sede con otro filtro de reserva y contaba turnos de otras sedes. Se corrigió con un `AND` explícito.

**Pantallas:**
- **Agenda:** cada turno muestra Atendido, Ausente, Reprogramar y Cancelar (con motivo), según su estado.
- **Reprogramar** abre Nuevo turno con los servicios y el cliente del original. Los botones dicen «Mover a HH:MM».

**Verificación:**
- `npm run test:database`: 96 tests. Los de R03 cubren:
  - cancelación con motivo, liberación del horario y evento;
  - atención con ventana horaria y consentimiento;
  - ausente;
  - reprogramación con solapamiento propio, precio congelado, enlace y eventos, fallo sin cambios y estado inválido;
  - doble reprogramación concurrente;
  - cambios de calendario rechazados y aceptados;
  - alcance.
- Prueba E2E con `next dev`: reservar 09:00, reprogramar a 11:00 desde la agenda (09:00 queda libre) y cancelar con motivo (visible solo con «incluir cancelados»). No se probó en un navegador real.
