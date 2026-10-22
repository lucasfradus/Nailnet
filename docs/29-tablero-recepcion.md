# Tablero de recepción · propuesta · 2026-10-21

Propuesta (D20). Sale de la visita del usuario a un local de Sicurella el 2026-10-20 y extiende el flujo de recepción de 27-ventas-caja.md (D19). **Etapa 1 implementada el 2026-10-21 y etapa 2 el 2026-10-22** (ver «Etapa 1: implementación» y «Etapa 2: servicios a la vez» abajo); las etapas 3 y 4 siguen pendientes.

## Qué se vio en el local

- **Casi todas las ventas son sin turno.** Las reservas son pocas.
- La clienta llega y recepción le pregunta qué quiere. Después la deriva a una profesional que esté libre y sepa hacer ese servicio.
- La profesional trabaja y entrega una comanda en papel. Recepción la carga y cobra.
- **Las profesionales no usan celular ni tablet en el salón.** Todo lo carga recepción, donde siempre hay dos o tres personas.
- **Tamaño:** entre 10 y 20 profesionales por local; el más grande tenía unas 40. Puede haber turno mañana y turno tarde.
- **Tipos de puesto:** manicuría, pedicuría, depilación, masajes, masajes dobles y estética en general.
- **Recepción decide cuándo terminó un trabajo:** cuando le llega el papel, o cuando ve a la profesional libre en el salón.

La pantalla principal de recepción tiene que responder «quién está libre ahora y para qué». La agenda por horario sirve para las reservas, que son la minoría.

## Modelo

### La profesional es el centro, no el puesto

No se agrega una entidad «puesto». Lo que recepción abre cada día es **la presencia de la profesional**: «llegó» y «se fue». Esas marcas definen quién aparece en el tablero.

Los lugares físicos que escasean (cabinas de depilación, masajes, sala de masajes dobles, estética) son **recursos**, que ya están modelados (`TipoRecurso`, `Recurso`, `ServicioRequisitoRecurso`; doc 14). El motor ya valida que haya recurso libre durante todo el intervalo. Si manicuría y pedicuría no tienen lugares limitados, se cargan sin requisito, como hoy (doc 08).

### Estado de cada profesional en el tablero

| Estado | Qué se ve |
|---|---|
| No llegó / se fue | Fuera del tablero, o en gris al final |
| Libre | Habilidades. Si tiene un turno reservado próximo: «turno a las 15:30» |
| Atendiendo | Clienta, servicios, desde qué hora y fin estimado. Si se pasa del estimado: «demorada» |

### Ciclo de una atención

Se usan los estados de `Reserva` que ya existen:

1. **En curso** (`CONFIRMADA`, iniciada): «Atender ahora» desde el tablero.
2. **Terminada, por cobrar** (`ATENDIDA` sin venta): recepción toca «Terminó». **La profesional queda libre en ese momento**, aunque la clienta todavía no pagó.
3. **Cobrada:** la comanda y el cobro, igual que hoy.

Separar «terminó» de «cobró» evita que una profesional quede bloqueada mientras la clienta espera en caja (hay una sola por sede). Las atenciones terminadas sin cobrar se listan en el tablero, así no se pierde ninguna comanda.

## Flujo

1. **A la mañana** (y en el cambio de turno), recepción marca qué profesionales llegaron.
2. **Llega una clienta sin turno.** Recepción elige el o los servicios.
   - El tablero resalta las profesionales libres que tienen la habilidad, que tienen recurso libre y a las que les entra el servicio antes de su próximo turno.
   - Si no hay nadie libre, la clienta pasa a la **lista de espera**.
3. **Despacho:** se elige profesional y clienta (búsqueda rápida o alta con nombre y teléfono, como hoy). Por dentro es «Atender ahora».
4. **Terminó:** la profesional queda libre y la atención pasa a «por cobrar».
5. **Cobrar:** la pantalla de cobro con comanda que ya existe.

Si llega una clienta con turno, se marca la llegada y aparece como «atendiendo».

## Qué se reutiliza

- `atenderAhora` / `tomarTurno`: los locks de agenda y el motor de disponibilidad (habilidades, jornada, otros turnos y recursos).
- La comanda editable, la venta, la caja y los permisos de recepción (doc 27).
- La exclusión concurrente (doc 16). Si dos recepcionistas despachan a la misma profesional al mismo tiempo, entra la primera y la segunda recibe «ya no está libre».

## Qué cambia

| Cambio | Detalle |
|---|---|
| **Presencia del día** | Tabla nueva: sede, profesional, entrada y salida. Puede haber varias por día. Solo la escribe recepción |
| **Fin real** | «Terminó» guarda la hora real y recorta la ocupación de la agenda al minuto actual, para que el portal vuelva a ofrecer ese horario. Hoy la ocupación dura lo que dice el catálogo (pendiente en doc 27) |
| **Demoras** | Si el trabajo se pasa del estimado, la agenda no se extiende sola: el tablero lo marca y recepción decide. Un turno reservado detrás no se mueve |
| **Servicios en paralelo** | Una clienta con dos profesionales a la vez (manos y pies). Hoy «Atender ahora» solo encadena los servicios uno detrás del otro (D15). Tiene que admitir ítems simultáneos de la misma reserva, con distinta profesional. Es una sola venta |
| **Lista de espera** | Tabla nueva por sede: clienta (opcional), servicios pedidos, preferencia de profesional y hora de llegada. Al despachar sale de la lista. No es la «lista de espera» de reservas que el backlog deja fuera del MVP: es la cola física del local |
| **Pantalla Tablero** | Grilla compacta para 10 a 40 profesionales, agrupada por especialidad y con filtro por servicio. Contadores: libres, atendiendo, por cobrar y en espera. Se refresca sola cada pocos segundos, porque trabajan dos o tres recepcionistas a la vez |

## Etapa 1: implementación · 2026-10-21

Migración `202610210010_tablero_recepcion`. Repositorio en `packages/database/src/tablero.ts` (presencia y tablero) y `packages/database/src/reservas.ts` («Llegó» y «Terminó»). Pantalla **Recepción** (`/recepcion`), primera del menú. Pruebas en `packages/database/tests/tablero.test.ts`.

**Modelo**

- `PresenciaProfesional`: sede, profesional, entrada y salida, con quién marcó cada una.
  - Un índice único parcial deja **una sola presencia abierta por profesional**, en cualquier sede: dos recepcionistas que marcan la entrada a la vez no la duplican (probado con dos conexiones).
  - No se puede marcar la salida con una clienta en atención.
- `Reserva.iniciadaEn` y `Reserva.terminadaEn`.
  - «Atender ahora» completa `iniciadaEn` con el inicio del turno. Las atenciones sin turno previo anteriores se rellenan en la migración.
  - Para una clienta con turno, «Llegó» completa `iniciadaEn` (desde una hora antes, como «Atendido») y queda en la auditoría. No cambia la agenda.
  - En atención = turno `CONFIRMADA` con `iniciadaEn`. Sigue así aunque se pase del estimado («Demorada») hasta que recepción marque «Terminó».

**«Terminó»** (`terminarAtencion`)

- Pasa el turno a `ATENDIDA` (mismo evento y misma verificación de consentimientos que «Atendido») y guarda `terminadaEn`.
- Recorta la agenda a ese momento: el servicio en curso termina ahora (`fin` y `ocupaHasta`, también de sus recursos), así la profesional y el recurso quedan libres y el portal vuelve a ofrecer el horario.
- Un servicio encadenado que todavía no empezó **se quita del turno** y queda anotado en el evento (`quitados`). Si igual se hizo, recepción lo agrega en la comanda.
- Exige que el turno haya empezado en la agenda. **«Atendido» en la agenda no cambió:** se puede marcar al llegar la clienta, así que recortar ahí liberaría un horario en uso.

**Pantalla**

- Contadores: libres, atendiendo, por cobrar y turnos por llegar.
- Filtro por servicio: muestra solo las profesionales que lo hacen (habilitación y habilidades, mismo criterio que el motor). Avisa si no llega a terminarlo antes de su próximo turno.
- Tarjeta por profesional en el local: libre (hasta qué hora) con «Atender» y «Salida»; atendiendo o demorada con clienta, servicios, horario y «Terminó».
- «Atender» abre «Atender ahora» con la profesional y el servicio elegidos, y al confirmar vuelve al tablero.
- Por cobrar (atendidas sin venta vigente de los últimos siete días, la más vieja primero) con «Cobrar»; turnos por llegar (dos horas antes y después) con «Llegó»; y quienes no llegaron, con «Entrada».
- Se actualiza sola cada 20 segundos, salvo con la pestaña oculta o con el foco en un campo.

**Fuera de la etapa 1**

- «Atender ahora» no exige presencia: el tablero solo ofrece a las presentes, pero desde la agenda se puede despachar a cualquiera.
- La presencia no cambia lo que ofrece el portal.
- La agrupación por especialidad, los servicios en paralelo, la lista de espera y los reportes quedan para las etapas siguientes.
- Probado en un navegador real (Chrome) contra una base local con la demo: entrada, despacho con cliente nuevo, atención, «Terminó» y por cobrar.

## Etapa 2: servicios a la vez · 2026-10-22

Migración `202610220010_servicios_a_la_vez`. Pruebas en `packages/domain/tests/disponibilidad.test.ts` y `packages/database/tests/tablero.test.ts`.

- **Motor:** un ítem del pedido puede ir marcado `conAnterior`, y entonces empieza junto con el anterior en vez de a continuación.
  - Lo que sigue sin la marca empieza cuando terminó todo lo anterior.
  - El fin del turno es el del servicio más largo.
  - Los simultáneos nunca comparten profesional ni unidad de recurso: el motor ya trata como ocupado lo tentativo. Con «cualquiera», elige dos profesionales distintas.
- **Solo recepción.** El portal rechaza `conAnterior` («Los servicios a la vez se toman en recepción»).
- **Reprogramar** conserva los simultáneos: se deducen de que dos ítems seguidos tienen el mismo inicio.
- **«Atender ahora»:** cada servicio adicional tiene la casilla «A la vez con el anterior (otra profesional)».
- **«Terminó» por profesional:**
  - `ReservaItem.terminadoEn` guarda cuándo terminó cada servicio. La tarjeta de cada profesional termina solo sus servicios (recorta o quita, como en la etapa 1) y queda en la auditoría.
  - El turno pasa a atendido, por cobrar, cuando no queda ningún servicio pendiente.
  - Mientras tanto, la otra profesional sigue «atendiendo» y la que terminó queda libre, junto con su recurso.
  - Sin profesional (`terminarAtencion` sin opción) termina todo, como antes.
- **Cabinas:** no requieren código. Se cargan como tipo de recurso y unidades (Catálogo → Recursos y la ficha de la sede), y el servicio las pide como requisito. El motor ya las valida y «Terminó» las libera.
- **Masajes dobles** (pregunta abierta). Si son dos clientas en una sala, la sala se carga como dos unidades de un tipo «sala doble», y cada clienta es su propio turno. Si es una clienta con dos profesionales, son dos servicios a la vez.

## Preguntas para Sicurella

- **Masajes dobles:** ¿son dos clientas en la misma sala (dos profesionales), o una clienta con dos profesionales?
- **Manicuría y pedicuría:** ¿hay lugares limitados (sillones de pedicuría), o cada profesional tiene el suyo?
- **Faltas:** si una profesional no vino, ¿se bloquea su agenda del día en el portal? Propuesta: marcarla «no vino» ofrece reasignar o cancelar sus turnos.
- **Fuera de horario:** ¿recepción puede despachar a una profesional fuera de su jornada (horas extra)? Hoy se rechaza.
- **Preferencia de profesional:** ¿la clienta habitual pide a alguien en particular y espera por ella?

## Etapas propuestas

1. **Tablero básico:** presencia, estados, filtro por servicio, despacho con «Atender ahora», «Terminó» con fin real y la lista de por cobrar.
2. **Servicios en paralelo y recursos:** clienta con varias profesionales a la vez y cabinas cargadas como recursos.
3. **Lista de espera.**
4. **Reportes** (L03): tiempo real por atención, ocupación por profesional, espera promedio y atenciones con o sin turno.
