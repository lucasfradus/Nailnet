# Clientes y consentimientos · 2026-10-01

Implementa C01. Migración `202610010003_clientes`. Pantallas: Clientes, ficha del cliente y Consentimientos (solo master).

## Ficha de cliente

- **Una identidad por organización** (D13): no hay fichas duplicadas por franquiciado. Otra organización puede tener un cliente con el mismo email; no se comparten entre organizaciones.
- **Contenido de la ficha:** nombre, apellido, email, teléfono, sexo opcional y documento opcional (DNI, CUIT, CUIL o pasaporte).
  - Email o teléfono es obligatorio, también por `CHECK` en la base.
  - Email y documento son únicos dentro de la organización.
- **Sin datos de salud ni fotos.** El campo de observaciones advierte no registrarlos.
- **Cliente sin cuenta:** no hay login de clientes. D2 (invitado con enlace) se resuelve con el portal.
- **Relación con cada sede:** `ClienteSede` guarda cuándo empezó y las **observaciones de esa sede**.

## Qué ve cada uno

La visibilidad del historial sigue sin confirmar (D13). Se aplica la propuesta vigente:

| Dato | Quién lo ve |
|---|---|
| Listado y búsqueda por nombre o parte del teléfono | Solo clientes vinculados a sedes del alcance del usuario |
| Identidad (nombre y contacto) | Cualquier sede vinculada; editarla se refleja en todas |
| Observaciones | Solo las de sedes del alcance; cada sede edita las suyas |
| Estado de consentimientos | Cualquier sede vinculada, porque son de la persona y hacen falta para atenderla |
| Clientes sin sede | Solo el master |

**Vincular un cliente existente.** La búsqueda en toda la organización es **solo por email o teléfono completos**.

- Quien busca ya conoce el dato, y así nadie puede hojear por nombre los clientes de otro franquiciado.
- Una vez vinculado a la sede propia, el cliente aparece en el listado normal.

**Roles:**
- **Profesional:** no accede al módulo. Los «datos mínimos para atender» llegan con la agenda.
- **Recepción, admin de sede, franquiciado y master:** leen y editan dentro de su alcance.

**Auditoría:** registra altas, vínculos, ediciones y consentimientos **sin datos personales** (solo IDs y sede).

## Consentimientos

- **Textos:** versionados por clave (p. ej. `depilacion-laser`), de tipo práctica, términos o comunicaciones.
- **Publicación:** solo el master publica, en línea con la propuesta de consentimientos globales de D12. Cambiar el texto es publicar una versión nueva.
- **Inmutabilidad:** los textos publicados y los registros de aceptación no se pueden modificar ni borrar; lo aseguran triggers.
- **Registro en recepción:** se registra aceptación o revocación con sede, usuario, canal y evidencia («presencial»).
  - Solo se puede aceptar la **versión vigente**.
  - Una versión nueva deja a quienes aceptaron la anterior como «aceptó una versión anterior».
  - Revocar es un registro más; el estado lo define el último registro, con desempate por orden de inserción.
- **Portal:** la aceptación en línea (canal `PORTAL`, con evidencia técnica) llega con P01.
- **Asociación con servicios:** vincular el consentimiento a los servicios que lo exigen (`ServicioConsentimiento`) llega con el catálogo (C02).
- **Revisión legal:** los textos de práctica deben revisarlos el responsable legal del negocio. NailNet solo guarda y versiona.

## Pendiente

- Confirmar la visibilidad del historial (D13) cuando existan visitas y pagos.
- Derechos del titular de datos (Ley 25.326: acceso, rectificación y supresión) y política de retención. Hace falta definir el procedimiento antes de producción; hoy no hay borrado ni anonimización.
- Fusión de fichas duplicadas (misma persona cargada con emails distintos).
- Paginación más allá de los primeros 50 resultados.

## Verificación

- `npm run test:domain`: validación y normalización de la ficha, estado de consentimiento con versiones y revocación, formato de clave.
- `npm run test:database`: 7 escenarios en PostgreSQL:
  - alcance de alta y conflicto de email;
  - aislamiento entre franquiciados y entre organizaciones;
  - vínculo por contacto exacto sin duplicar identidad;
  - observaciones locales sin fuga a otras sedes ni a la auditoría;
  - edición compartida con conflictos de email y documento;
  - publicación exclusiva del master con versiones inmutables;
  - aceptación de la versión vigente, reaceptación tras versión nueva, revocación y registro inmutable.
- Prueba E2E manual con `next dev`:
  - recepción crea un cliente y lo encuentra por parte del teléfono;
  - el master publica un consentimiento;
  - recepción registra la aceptación;
  - la búsqueda organizacional rechaza nombres.
  - No se probó en un navegador real.
