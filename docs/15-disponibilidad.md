# Motor de disponibilidad · 2026-10-01

Implementa C04. Migración `202610010006_reservas`: esquema de reservas multi-ítem y parámetro de intervalo de grilla. Pantalla: Agenda (consulta de turnos para recepción).

## Diseño

El motor es una función pura (`packages/domain/src/disponibilidad.ts`): no lee la base ni el reloj. `packages/database/src/disponibilidad.ts` arma la consulta desde PostgreSQL. La misma carga se reutilizará dentro de la transacción con locks para revalidar una retención (C05), así que mostrar turnos y confirmarlos usan exactamente las mismas reglas.

Para cada inicio posible en la fecha, el motor intersecta:

1. **Apertura de la sede.** Prioridad: fecha especial de la sede > feriado de la organización > horario semanal vigente. Un «cerrado» cierra el día. El servicio (sin tiempos de preparación) debe caer dentro de la apertura.
2. **Profesionales aptos:**
   - activos y vinculados a la sede;
   - con habilitación expresa del servicio y **todas** sus habilidades.
3. **Disponibilidad del profesional:**
   - su intervalo de ocupación (servicio más preparación antes y después) debe caer dentro de su jornada en esa sede;
   - no puede chocar con ocupaciones ni ausencias en **cualquier sede**.
4. **Recursos:** unidades distintas de cada tipo requerido, libres durante todo el intervalo de ocupación. Orden estable por ID.
5. **Ventana de inicios:**
   - recepción: desde ahora;
   - online: desde ahora + anticipación mínima, y hasta el horizonte (D18).

**Ocupaciones vigentes:** reservas `CONFIRMADA`, `ATENDIDA` o `AUSENTE`, y pendientes (`PENDIENTE_PAGO`, `PAGO_EN_REVISION`) con `expiraEn` futuro. Una retención vencida deja de ocupar aunque el worker todavía no la haya marcado como expirada: el motor no depende del cron.

**Varios servicios (D15):** cada ítem empieza cuando termina el servicio anterior y puede asignarse a otro profesional. La búsqueda prueba profesionales en orden de preferencia y vuelve atrás si un ítem posterior no tiene lugar. Las ocupaciones tentativas de los ítems previos cuentan, así que un mismo profesional o recurso no se asigna dos veces solapado.

**«Cualquiera» (D16):** se elige el profesional con menor carga del día (minutos ya ocupados en esa fecha local, en cualquier sede) y se desempata por ID, de forma determinista. Se puede elegir profesional por ítem.

**Zonas horarias:** los inicios se generan en hora local de la sede y se convierten a UTC con el desfasaje real de la fecha (doc 14).

## Intervalo entre inicios (D17): configurable, sin valor por defecto

Se agregó `pasoGrillaMinutos` a la configuración heredable organización → sede (5–120, múltiplo de 5). Los inicios caen en múltiplos del intervalo desde la medianoche local.

- **Sin valor:** el motor no genera turnos y responde `ConfiguracionIncompleta` con lo que falta. La pantalla lo indica con un enlace a la configuración de la sede.
- **Canal online:** además exige horizonte y anticipación definidos (D18).

Esto respeta que D17 está abierta: cuando se decida, se carga el valor o se reemplaza la regla. La competencia usa 60 minutos fijos sin importar la duración. Alternativas como «derivado de la duración» o «paso fino con compactación» pueden implementarse sin cambiar el esquema de reservas.

## Esquema de reservas (D15)

- **`Reserva`:** sede, cliente opcional, canal (`ONLINE` o `RECEPCION`), estado y `expiraEn` (obligatorio por `CHECK` mientras está pendiente).
- **`ReservaItem`:** posición, servicio, profesional, intervalo del servicio y de ocupación, y copia de las condiciones al reservar (duración, preparación, precio y seña).
  - Un `CHECK` asegura que la ocupación contenga al servicio y que la seña no supere el precio.
- **`ReservaItemRecurso`:** unidad física ocupada por el ítem y su intervalo.

Todavía no hay API que escriba reservas: la retención con locks y la prueba de exclusión concurrente son C05. La reserva manual completa, R01.

## Pendiente

- C05: retener turnos dentro de una transacción con `SELECT … FOR UPDATE` sobre profesionales y recursos en orden estable. Revalida con esta misma carga y prueba concurrencia real.
- Validar contra turnos vigentes los cambios de jornada, ausencias y horario de sede (doc 14).
- Rendimiento: la consulta trae los datos de un día por pedido. Para el portal (varios días) conviene agrupar consultas o cachear el calendario.
- Requisito de «unidad específica» de recurso (hoy solo cantidad por tipo).

## Verificación

- `npm run test:domain` (8 escenarios del motor):
  - prioridad de apertura y vigencias;
  - grilla configurable y apertura;
  - pausas y ocupaciones;
  - tiempos de preparación dentro de la jornada;
  - «cualquiera» por carga e ID;
  - recursos por cantidad y tipo;
  - cadena de servicios con profesionales distintos y vuelta atrás;
  - anticipación y horizonte.
- `npm run test:database` (7 escenarios contra PostgreSQL):
  - configuración incompleta (D17 y D18);
  - skills, jornada y recurso;
  - turno en otra sede que bloquea;
  - retención vencida que no bloquea, bloqueo de agenda y cancelación que libera;
  - recurso ocupado por otro profesional;
  - cadena manos + pies con profesional elegido por ítem;
  - feriado de la organización;
  - anticipación y horizonte online;
  - alcance y servicio no habilitado.
- Prueba E2E manual con `next dev`:
  - toda la configuración se armó desde la UI;
  - la agenda primero avisa que falta el intervalo;
  - con 30 minutos muestra 09:00–12:00 dentro de la jornada de la profesional.
  - No se probó en un navegador real.
