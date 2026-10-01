# Administración de sedes y usuarios · 2026-10-01

Implementa A02 y completa A01 para sedes y usuarios. Migración `202610010001_administracion`.

## Qué se puede hacer

| Pantalla | Quién | Operaciones |
|---|---|---|
| Sedes | Todos los roles con `sede:leer` | Ver sedes del alcance |
| | Admin de sede, franquiciado, master | Editar nombre y zona horaria (solo sedes del alcance) |
| | Franquiciado (propias), master | Crear, desactivar y reactivar sedes |
| | Master | Crear franquiciados |
| Usuarios | Admin de sede (solo lectura), franquiciado, master | Ver usuarios del alcance |
| | Franquiciado, master | Alta con rol inicial, agregar y quitar roles, desactivar y reactivar, enlace de activación |

**Selector.** Muestra organización (si hay más de una) y sede. «Todas mis sedes» es la vista consolidada del franquiciado.

- La elección vive en cookies `HttpOnly` y se valida contra el alcance en cada request.
- Elegir una sede ajena se rechaza.
- Una cookie manipulada o desactualizada vuelve a «todas mis sedes», nunca a más.
- Cada operación vuelve a autorizar en el repositorio.

## Reglas de delegación

Implementadas como funciones puras en `packages/domain/src/access.ts` y probadas aparte:

- **Master:** concede cualquier rol de su organización.
- **Franquiciado:** concede administración de sede y recepción, solo en sus sedes. No crea franquiciados ni masters.
- **Admin de sede y recepción:** no conceden roles.
- **Profesional:** hoy solo lo concede el master. El rol tiene alcance propio, sin sede; si un franquiciado pudiera concederlo, también podría revocar profesionales de otro franquiciado. Se revisa con `ProfesionalSede` (C03).
- **Revocar** sigue la misma regla que conceder.
- **Desactivar o invitar** exige cubrir todas las asignaciones del usuario. A un usuario sin roles solo lo administra el master.
- Nadie cambia su propio estado.
- La organización siempre conserva un master activo.

**Visibilidad.** Un admin de sede ve a quienes tienen rol en su sede, pero no en qué otras sedes trabajan. Un franquiciado no ve usuarios que solo tienen rol en sedes de otro franquiciado.

**Alta de usuario.** Es atómica, con el rol inicial: nadie crea usuarios que después no pueda ver.

- Si el email ya existe en otra organización, se lo incorpora con su cuenta actual. No se cambian su nombre ni su contraseña.
- La desactivación es por organización (membresía). No afecta el acceso a otras organizaciones.

**Invitación.** Para usuarios sin contraseña se genera un enlace de activación de 72 h, que se muestra una sola vez a quien lo generó.

- No se ofrece para cuentas con contraseña: un administrador no puede tomar una cuenta en uso. Para esos casos está la recuperación del propio usuario.
- Mientras no exista envío de emails (P03), este enlace es también el camino de alta en producción.

## Consistencia y auditoría

- Las operaciones que cambian permisos o estructura se serializan por organización (`pg_advisory_xact_lock`) y releen al actor bajo el mismo lock. Una revocación concurrente no deja pasar una operación con permisos viejos (probado).
- `AuditLog` registra actor, acción, entidad y datos mínimos de cada alta, cambio de rol, cambio de estado, edición de sede e invitación. Nunca guarda tokens ni contraseñas.
- Un trigger impide `UPDATE` y `DELETE` sobre `AuditLog`.
- **IDs mal formados** que llegan desde formularios se rechazan como acceso denegado antes de consultar la base. Antes producían un error 500 (lo detectó la prueba E2E).
- El panel tiene una pantalla de error sin detalles internos.

## Pendiente

- Configuración y secretos por sede (A03).
- Asociar profesionales a sedes (C03) y revisar quién concede el rol.
- Editar nombre o email de un usuario. Hoy se corrige desde la base.
- Consulta de la auditoría desde la UI.
- Paginación: los listados son completos, suficiente para el tamaño de piloto esperado.

## Verificación

- `npm run test:domain`: delegación, administración de usuarios, visibilidad y creación de sedes.
- `npm run test:database`: 12 escenarios de administración en PostgreSQL. Incluyen alcance en lectura y escritura, sedes inactivas, franquiciados, alta con email existente, ocultamiento de asignaciones, último master, desactivación con efecto inmediato, invitación de un uso, auditoría inmutable, IDs mal formados y revocación concurrente.
- Prueba E2E manual (fuera de CI) con PostgreSQL embebido y `next dev`, enviando formularios por HTTP:
  - recepción ve sus dos sedes y no ve usuarios;
  - el selector filtra y rechaza una sede ajena;
  - una cookie de sede manipulada no amplía resultados;
  - el franquiciado crea una sede y un usuario;
  - un rol manipulado a master se rechaza;
  - invitación → activación → ingreso con el rol nuevo;
  - el admin de sede ve su equipo sin acciones.
- No se probó en un navegador real.
- `@prisma/adapter-pg` emite un aviso de deprecación de `pg` («client.query() when the client is already executing a query») al ejecutar creaciones anidadas en transacciones. Viene del adaptador, no del código de NailNet. Revisarlo al actualizar Prisma.
