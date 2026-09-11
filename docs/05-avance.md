# Avance · 10 de septiembre de 2026

Este documento conserva el primer scaffold. El avance posterior de persistencia y permisos está en [06-fundacion.md](06-fundacion.md); reemplaza los pendientes de base de datos indicados abajo.

## Alcance realizado

Inicio de F01, usando NailNet como nombre provisional. Workspaces npm, configuración TypeScript estricta, lint, contrato público de liveness, builds independientes y workflow de CI. Backoffice y portal tienen pantallas de inicio que indican que todavía no hay operación. El worker arranca un servidor local de liveness y admite apagado por señales; no representa una implementación de outbox.

El portal tiene una regla de lint que prohíbe importar los futuros paquetes de dominio, persistencia e integraciones. Esta regla es una primera barrera, no sustituye una revisión del bundle cuando existan esos paquetes. Nunca poner secretos en variables VITE_.

Directorios database, domain e integrations reservados, sin implementaciones ficticias. No se copió código ni información de clientes desde Clicnet.

## Verificación local

Lint y TypeScript aprobados; builds de Next.js, Vite y worker completados. Smoke HTTP con los builds: página inicial del backoffice 200, liveness de backoffice y worker con contrato esperado y ruta inexistente del worker 404. Repetible con `node scripts/smoke.mjs` después del build, usando los puertos libres 3300/3301. También está incluido en CI. No se verificó visualmente en navegador ni se hicieron pruebas de negocio, ya que todavía no hay operaciones implementadas.

Dependencias directas fijadas a versiones exactas y lockfile generado; npm reportó cero vulnerabilidades durante la instalación. CI todavía no ejecutada en GitHub.

## Próximo incremento

F01 es parcial: faltan Prisma/PostgreSQL y la comprobación del aislamiento de secretos cuando existan integraciones. F02–F05 todavía no se completaron. Sin login, endpoints de negocio, jobs durables, pagos ni despliegues.

El 2026-09-10 el usuario confirmó clientes compartidos entre franquiciados (D13): identidad única dentro de la organización. La visibilidad del historial sigue pendiente; se conserva la propuesta de limitarlo a sedes autorizadas. D8 también quedó confirmado: cuentas propias por sede y CUIT compartible con puntos de venta diferentes. El usuario creó el repositorio lucasfradus/Nailnet. Para el siguiente incremento quedan D12 (configuración global/local) y la revisión del modelo de organización y acceso. Las demás decisiones comerciales siguen abiertas en 04-decisiones.md. Ninguna propuesta se convirtió en política aprobada por haber iniciado el scaffold.

La versión de Node disponible es 24.14.1, compatible con los requisitos documentados de [Next.js](https://nextjs.org/docs/app/getting-started/installation) y [Vite](https://vite.dev/guide/). Las dependencias instaladas quedan registradas en package-lock.json.
