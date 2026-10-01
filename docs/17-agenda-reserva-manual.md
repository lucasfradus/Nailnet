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
