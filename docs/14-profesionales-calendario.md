# Profesionales, calendario y recursos · 2026-10-01

Implementa C03. Migración `202610010005_profesionales`. Pantallas: Profesionales, ficha del profesional y, en la ficha de sede, horario, fechas especiales y recursos.

## Profesionales

- **Una ficha por organización**, vinculada a una o varias sedes (`ProfesionalSede`). Desvincular no borra historial.
- **Usuario opcional:** el vínculo con un usuario (`usuarioId`) queda en el esquema para la «agenda propia» del rol profesional. Todavía no se asigna desde la UI.
- **Quién administra:** admin de sede, franquiciado o master (permiso `profesional:administrar`), desde cualquier sede del profesional dentro de su alcance. Recepción consulta.
- **Vincular a otra sede:** exige administrar al profesional y también la sede destino.
- **Sedes de otros alcances:** no se nombran; solo se informa que existen.
- **Habilidades y servicios habilitados:** son atributos del profesional en toda la organización. Para un servicio necesita la habilitación expresa **y** todas las habilidades que el servicio requiere. La pantalla avisa cuántas le faltan.

## Jornadas y ausencias

- **Jornada semanal por sede** con varios rangos por día; los cortes entre rangos son pausas.
  - Formato `09:00-13:00, 14:00-20:00`, en múltiplos de 5 minutos.
  - Intervalos semiabiertos: 13:00 de una sede y 13:00 de otra son contiguos y válidos.
- **Sin estar en dos sedes a la vez:** guardar una jornada que se superpone con la de otra sede se rechaza.
  - Los guardados concurrentes del mismo profesional se serializan con un lock, así solo uno puede ganar (probado).
  - Cuando la otra sede está fuera del alcance de quien edita, el mensaje dice «otra sede» sin nombrarla.
- **Ausencias** (`BloqueoAgenda`): son instantes UTC y valen para todas las sedes del profesional. Se cargan y muestran en la zona horaria de su primera sede visible, máximo un año.
- **Vigencia por fecha:** el esquema admite vigencia desde y hasta en jornadas y horarios de sede. La UI edita por ahora la plantilla sin vigencia; versionar horarios por temporada queda para cuando se pida.
- **Turnos ya tomados (resuelto en R03):** cambiar una jornada o agregar una ausencia que deje afuera turnos vigentes se rechaza; ver doc 17. El motor (C04) y R01 deberán rechazar cambios que pisen turnos vigentes, con el mismo lock por profesional.

## Calendario de la sede

- **Horario semanal de atención** con pausas (admin de sede, franquiciado o master).
- **Fechas especiales:** cerrado o con horario especial.
  - Sin sede, aplican a toda la organización: son feriados y solo los carga el master.
  - Si la sede tiene filas propias para una fecha, reemplazan a las de la organización. Por ejemplo, abrir medio día un feriado.
- **Disponibilidad:** el motor tomará la intersección entre horario de la sede, fechas especiales, jornada del profesional y ausencias.

## Recursos

- **Unidades físicas por sede** de un tipo del catálogo (Cabina 1, Láser A). Se pueden poner fuera de servicio.
- **Bloqueos por mantenimiento:** el esquema los admite (`BloqueoRecurso`); la UI llegará con la agenda.
- **Asignación a turnos:** el servicio declara cuántas unidades de cada tipo ocupa (C02). El motor asigna unidades distintas para todo el intervalo (C04).

## Zonas horarias

`packages/domain/src/agenda.ts` convierte hora local ↔ UTC con la zona IANA de la sede usando `Intl`, sin dependencias. Corrige el desfasaje real de cada fecha y está probado con el cambio de horario de Santiago de Chile. Argentina no tiene horario de verano hoy, pero una sede en otra zona o un cambio de política no rompen el cálculo.

## Pendiente

- Validar cambios de jornada y ausencias contra reservas vigentes (C04/R01).
- Asignar el usuario del profesional y su vista de agenda propia; revisar entonces quién concede el rol `PROFESIONAL` (hoy solo el master).
- Grilla de inicio de turnos (D17).
- Copiar la jornada de un día a otros y plantillas de horario.

## Verificación

- `npm run test:domain`: formato de rangos, pausas, superposición, contigüidad, vigencias, fechas inválidas y conversión local ↔ UTC con cambio de horario.
- `npm run test:database`: 9 escenarios en PostgreSQL:
  - alta y listado por alcance;
  - vínculo multi-sede sin revelar sedes ajenas;
  - jornadas sin superposición entre sedes y carrera concurrente;
  - habilidades sin cruzar organizaciones y sin cambios parciales;
  - ausencias globales y su `CHECK`;
  - horario de sede, feriado de organización con excepción de sede y `CHECK` de forma;
  - recursos por sede con nombres únicos;
  - desactivación.
- Prueba E2E manual con `next dev`:
  - el admin crea un profesional y carga una jornada con pausa (se rechazan rangos superpuestos);
  - carga una ausencia en hora local y la ve igual;
  - guarda el horario de la sede y una fecha especial;
  - recepción consulta sin editar.
  - No se probó en un navegador real.
