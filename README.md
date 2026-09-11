# NailNet — definición inicial

Documentación preparada el 9 de septiembre de 2026 a partir del pedido y de la revisión de los proyectos locales. NailNet es un nombre provisional, pendiente de confirmación.

- [Revisión de Clicnet y del portal](docs/01-revision.md).
- [Arquitectura y modelo de dominio propuesto](docs/02-arquitectura.md).
- [Backlog por fases y criterios de aceptación](docs/03-backlog.md).
- [Decisiones pendientes](docs/04-decisiones.md).

Estado al 10 de septiembre: monorepo con backoffice Next.js, portal React/Vite, worker y primera migración Prisma/PostgreSQL de organización, sedes, identidad y configuración fiscal. Incluye repositorios con permisos por sede y pruebas de integración. Las pantallas siguen siendo iniciales: todavía no hay login ni operaciones de negocio accesibles desde la UI. Repositorio: [lucasfradus/Nailnet](https://github.com/lucasfradus/Nailnet). Las políticas comerciales restantes siguen pendientes.

## Desarrollo local

Con Docker Desktop iniciado, ejecutar `docker compose up -d --build --wait`. Levanta PostgreSQL, aplica migraciones y seed de demo, y arranca backoffice en http://localhost:3000, portal en http://localhost:5173 y worker en http://localhost:3001/health. No requiere instalar Node en el host ni crear un .env. `docker compose down` detiene el entorno conservando los datos. Ver [guía Docker](docs/07-docker-local.md).

### Alternativa con Node en el host

Requiere Node.js 24 y npm 11. Ejecutar `npm ci` y `npm run db:generate` en la raíz. En terminales independientes:

- `npm run dev:backoffice`: administración en http://localhost:3000.
- `npm run dev:booking`: portal en http://localhost:5173.
- `npm run dev:worker`: proceso base, liveness en http://localhost:3001/health.

`npm run check` ejecuta lint, chequeo de tipos y los tres builds. Se puede compilar cada aplicación con `npm run build -w @nailnet/backoffice` (o `@nailnet/booking`, `@nailnet/worker`). Backoffice y worker tienen `npm run start -w <paquete>` después del build; el portal genera `apps/booking/dist`.

El endpoint `/api/health` del backoffice y `/health` del worker solo verifican que el proceso responde, no disponibilidad de base de datos o proveedores. El worker aún no consume trabajos. `PORT` permite cambiar su puerto local, predeterminado 3001. Esta base funciona sin credenciales ni archivos `.env`.

La CI está definida en `.github/workflows/ci.yml` e incluye las pruebas de permisos y PostgreSQL. `npm run test:domain` prueba reglas puras; `npm run test:database` crea un PostgreSQL temporal aislado, migra, verifica el seed y ejecuta integración sin Docker. Ver [base de datos y permisos](docs/06-fundacion.md) para desarrollar con una base persistente.
