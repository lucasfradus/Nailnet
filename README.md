# NailNet — definición inicial

Documentación preparada el 9 de septiembre de 2026 a partir del pedido y de la revisión de los proyectos locales. NailNet es un nombre provisional, pendiente de confirmación.

- [Revisión de Clicnet y del portal](docs/01-revision.md).
- [Arquitectura y modelo de dominio propuesto](docs/02-arquitectura.md).
- [Backlog por fases y criterios de aceptación](docs/03-backlog.md).
- [Decisiones pendientes](docs/04-decisiones.md).

Estado al 10 de septiembre: fundación técnica iniciada. Hay un monorepo npm con backoffice Next.js, portal React/Vite, worker Node/TypeScript y contratos públicos compartidos. Las pantallas son iniciales y no tienen operaciones de negocio. No hay esquema Prisma, autenticación ni infraestructura. Repositorio: [lucasfradus/Nailnet](https://github.com/lucasfradus/Nailnet). El modelo sigue pendiente de las decisiones de negocio restantes.

## Desarrollo local

Requiere Node.js 24 y npm 11. Ejecutar `npm ci` en la raíz. En terminales independientes:

- `npm run dev:backoffice`: administración en http://localhost:3000.
- `npm run dev:booking`: portal en http://localhost:5173.
- `npm run dev:worker`: proceso base, liveness en http://localhost:3001/health.

`npm run check` ejecuta lint, chequeo de tipos y los tres builds. Se puede compilar cada aplicación con `npm run build -w @nailnet/backoffice` (o `@nailnet/booking`, `@nailnet/worker`). Backoffice y worker tienen `npm run start -w <paquete>` después del build; el portal genera `apps/booking/dist`.

El endpoint `/api/health` del backoffice y `/health` del worker solo verifican que el proceso responde, no disponibilidad de base de datos o proveedores. El worker aún no consume trabajos. `PORT` permite cambiar su puerto local, predeterminado 3001. Esta base funciona sin credenciales ni archivos `.env`.

La CI está definida en `.github/workflows/ci.yml`; empezará a ejecutarse cuando el proyecto tenga repositorio remoto en GitHub. Ver [avance y próximos pasos](docs/05-avance.md).
