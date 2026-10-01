# NailNet — definición inicial

Documentación preparada el 9 de septiembre de 2026 a partir del pedido y de la revisión de los proyectos locales. NailNet es un nombre provisional, pendiente de confirmación.

- [Revisión de Clicnet y del portal](docs/01-revision.md).
- [Arquitectura y modelo de dominio propuesto](docs/02-arquitectura.md).
- [Backlog por fases y criterios de aceptación](docs/03-backlog.md).
- [Decisiones pendientes](docs/04-decisiones.md).
- [Análisis de la competencia (Sicurella)](docs/08-competencia-sicurella.md).
- [Autenticación del backoffice](docs/09-autenticacion.md).
- [Administración de sedes y usuarios](docs/10-administracion.md).
- [Configuración y secretos por sede](docs/11-configuracion-secretos.md).
- [Clientes y consentimientos](docs/12-clientes-consentimientos.md).
- [Catálogo y precios por sede](docs/13-catalogo.md).
- [Profesionales, calendario y recursos](docs/14-profesionales-calendario.md).
- [Motor de disponibilidad](docs/15-disponibilidad.md).
- [Retención de turnos y exclusión concurrente](docs/16-exclusion-concurrente.md).
- [Agenda y reserva manual](docs/17-agenda-reserva-manual.md).

Estado al 10 de septiembre: monorepo con backoffice Next.js, portal React/Vite, worker y primera migración Prisma/PostgreSQL de organización, sedes, identidad y configuración fiscal. Incluye repositorios con permisos por sede y pruebas de integración. Desde el 30 de septiembre el backoffice tiene login, logout y recuperación de contraseña con sesiones revocables en PostgreSQL; también administra sedes, franquiciados y usuarios con roles por alcance y selector de sede. Incluye clientes compartidos con observaciones por sede y consentimientos versionados. También catálogo global con precio y seña configurables por sede. Además profesionales multi-sede con jornadas, ausencias, horario de sede, feriados y recursos. El motor de disponibilidad calcula turnos (con varios servicios encadenados); la retención de turnos con exclusión concurrente está implementada y probada; recepción ya toma turnos y los ve en la agenda; todavía no hay cobros. Repositorio: [lucasfradus/Nailnet](https://github.com/lucasfradus/Nailnet). Las políticas comerciales restantes siguen pendientes.

## Desarrollo local

Con Docker Desktop iniciado, ejecutar `docker compose up -d --build --wait`. Levanta PostgreSQL, aplica migraciones y seed de demo, y arranca backoffice en http://localhost:3000, portal en http://localhost:5173 y worker en http://localhost:3001/health. No requiere instalar Node en el host ni crear un .env. `docker compose down` detiene el entorno conservando los datos. Ver [guía Docker](docs/07-docker-local.md).

### Alternativa con Node en el host

Requiere Node.js 24 y npm 11. Ejecutar `npm ci` y `npm run db:generate` en la raíz. En terminales independientes:

- `npm run dev:backoffice`: administración en http://localhost:3000.
- `npm run dev:booking`: portal en http://localhost:5173.
- `npm run dev:worker`: proceso base, liveness en http://localhost:3001/health.

`npm run check` ejecuta lint, chequeo de tipos y los tres builds. Se puede compilar cada aplicación con `npm run build -w @nailnet/backoffice` (o `@nailnet/booking`, `@nailnet/worker`). Backoffice y worker tienen `npm run start -w <paquete>` después del build; el portal genera `apps/booking/dist`.

El endpoint `/api/health` del backoffice y `/health` del worker solo verifican que el proceso responde, no disponibilidad de base de datos o proveedores. El worker expira retenciones de turnos vencidas cada 30 s (`WORKER_INTERVALO_SEGUNDOS`) si tiene `DATABASE_URL`; sin base solo responde liveness. `PORT` permite cambiar su puerto local, predeterminado 3001. Esta base funciona sin credenciales ni archivos `.env`.

La CI está definida en `.github/workflows/ci.yml` e incluye las pruebas de permisos y PostgreSQL. `npm run test:domain` prueba reglas puras; `npm run test:database` crea un PostgreSQL temporal aislado, migra, verifica el seed y ejecuta integración sin Docker. Ver [base de datos y permisos](docs/06-fundacion.md) para desarrollar con una base persistente.
