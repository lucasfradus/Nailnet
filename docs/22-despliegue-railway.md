# Despliegue en Railway · 2026-10-06

Completa F04 (staging). La infraestructura está descrita en `.railway/railway.ts` (Infrastructure as Code de Railway). El formato anterior, `railway.json`, quedó deprecado, los servicios nuevos ya no pueden usarlo y deja de leerse el 2026-12-01.

## Servicios

| Servicio | Build | Start | Healthcheck | Dominio público |
|---|---|---|---|---|
| `backoffice` | `npm run db:generate && npm run build -w @nailnet/backoffice` | `npm run start -w @nailnet/backoffice` | `/api/health` | Sí (administración y API pública) |
| `booking` | `npm run build -w @nailnet/booking` | `npm run start -w @nailnet/booking` (`servidor.mjs`) | `/` | Sí (portal) |
| `worker` | `npm run db:generate && npm run build -w @nailnet/worker` | `npm run start -w @nailnet/worker` | `/health` | No |
| `Postgres` | Plantilla de Railway (PostgreSQL 18, igual que en local) | — | — | No |

- **Fuente:** las tres apps se construyen desde `lucasfradus/Nailnet`, rama `main`, con Railpack. Node sale de `.nvmrc`.
- **Watch paths:**
  - Cada app se redespliega solo si cambian sus archivos, los paquetes que usa o las dependencias.
  - Un cambio en el portal no redespliega el worker.
  - Un cambio en `packages/` redespliega backoffice y worker; el portal solo depende de `packages/contracts`.
- **Migraciones:** son el pre-deploy del backoffice. Si fallan, el deploy no sale y la versión anterior sigue atendiendo.
  - En `staging` también se carga la demo (idempotente).
  - Solo el backoffice migra. El worker puede arrancar unos segundos antes que la migración; si le falta una tabla, el error queda en el log y reintenta en la vuelta siguiente.
- **Portal:** `apps/booking/servidor.mjs` sirve `dist/` sin dependencias. Hace fallback a `index.html` (SPA), cachea un año `assets/` (archivos con hash), no cachea `index.html`, aplica cabeceras de seguridad y bloquea rutas fuera de `dist/`.
- **Puertos:** las apps escuchan en `PORT`, que Railway inyecta. El backoffice ya no fija el 3000 en `start`. El worker recibe `HOST=0.0.0.0` para que el healthcheck lo alcance; en local sigue en 127.0.0.1.

## Ambientes

El comportamiento depende del **nombre** del ambiente de Railway:

| Ambiente | `NAILNET_AMBIENTE` | Pre-deploy | `VITE_ORGANIZACION` |
|---|---|---|---|
| `staging` | `staging` | Migraciones + seed demo (`ALLOW_DEMO_SEED=true`) | `demo` |
| cualquier otro, incluido `production` | `produccion` | Solo migraciones | Se carga a mano (slug real) |

Railway crea por defecto un ambiente llamado `production`. Si el primer ambiente va a ser de pruebas, conviene crear uno llamado `staging`. Si no, queda tratado como producción real: sin datos demo, que es lo seguro.

El seed demo exige `ALLOW_DEMO_SEED=true`. Si `NODE_ENV=production` (como en un build real), exige además `NAILNET_AMBIENTE=staging`. Con `NAILNET_AMBIENTE=produccion` no corre nunca. Las cinco combinaciones se probaron.

## Variables

Las que no figuran las pone Railway (`PORT`, `RAILWAY_PUBLIC_DOMAIN`, etc.).

### backoffice

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | Referencia a `Postgres.DATABASE_URL` | Red privada |
| `NAILNET_AMBIENTE` | `staging` / `produccion` | Lo fija el IaC según el ambiente |
| `NAILNET_CLAVES_CIFRADO` | `v1:<clave>` | **Secreto: cargarlo a mano en Railway, nunca en el repo.** Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Una clave distinta por ambiente. Si se pierde, no se pueden leer las credenciales de proveedores guardadas (doc 11) |
| `NAILNET_CLAVE_ACTIVA` | `v1` | Cargar a mano junto con la anterior |
| `PORTAL_ORIGIN` | `${{booking.RAILWAY_PUBLIC_DOMAIN}}` | Único origen con CORS. Acepta el dominio sin `https://` |
| `TRUST_PROXY` | `true` | Detrás del edge de Railway |
| `CLIENTE_IP_HEADER` | `x-real-ip` | Ver «IP del cliente» |
| `ALLOW_DEMO_SEED` | `true` | Solo en `staging` |
| `BACKOFFICE_URL` | (opcional) | Para enlaces de invitación. Si falta, se usa el dominio público del propio servicio |

### booking

| Variable | Valor | Notas |
|---|---|---|
| `VITE_API_URL` | `${{backoffice.RAILWAY_PUBLIC_DOMAIN}}` | Se incrusta en el build: si cambia el dominio del backoffice, redesplegar el portal |
| `VITE_ORGANIZACION` | `demo` en staging | Slug público de la organización |

Las variables `VITE_` terminan en el bundle público: nunca poner secretos.

### worker

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Referencia a `Postgres.DATABASE_URL` |
| `HOST` | `0.0.0.0` |
| `WORKER_INTERVALO_SEGUNDOS`, `WORKER_JOBS_SEGUNDOS` | Opcionales (30 y 5) |

## IP del cliente

Los límites de intentos (login, recuperación, reservas del portal) dependen de la IP del cliente.

- **El problema:** con `TRUST_PROXY=true`, el código tomaba el primer valor de `X-Forwarded-For`. Railway lo conserva tal como lo manda el cliente, así que cualquiera podía inventar una IP distinta en cada intento y esquivar los límites.
- **El arreglo:** Railway informa la IP real en `X-Real-IP`, y `CLIENTE_IP_HEADER` elige qué cabecera leer.
- **Validación:** un valor que no tiene forma de IP se descarta.
- La lógica está en `@nailnet/domain/red`, con pruebas.

## Primer despliegue

1. **Crear el proyecto** en Railway (o usar el que ya está), con un ambiente `staging`. Agregar Postgres y los tres servicios desde el repo de GitHub.
2. **Generar el dominio público** de `backoffice` y de `booking` (Settings → Networking). Los dominios generados no se manejan desde el IaC.
3. **Cargar los secretos** del backoffice: `NAILNET_CLAVES_CIFRADO` y `NAILNET_CLAVE_ACTIVA`.
4. **Aplicar la configuración.** Opciones:
   - **Con el CLI:**
     - Requiere Railway CLI ≥ 5.42.1; en esta máquina hay 5.26.2, así que hay que actualizarlo.
     - Correr `railway link` y elegir el proyecto y el ambiente `staging`.
     - Correr `railway config plan` y revisar el plan.
     - **El IaC borra lo que no está en el archivo**: si el proyecto tiene servicios con otro nombre, el plan los muestra como borrados. Renombrarlos o ajustar el archivo antes de aplicar.
     - Correr `railway config apply`.
   - **Desde el dashboard:** copiar build, start, pre-deploy, healthcheck, watch paths y variables de las tablas de arriba.
5. **Primer usuario.** En producción no hay recuperación por email hasta P03, y el seed no crea contraseñas.
   - En `staging`, asignar una contraseña a un usuario demo desde la consola del servicio backoffice (`railway ssh`): `NAILNET_PASSWORD='<frase de 12+>' npm run usuario:password -w @nailnet/database -- master-00000000-0000-4000-8000-000000000001@example.invalid`.
   - Para producción falta un comando para crear la organización y el primer usuario real (pendiente).
6. **Verificar:**
   - `https://<backoffice>/api/health` y `/login`;
   - el portal: elegir sede, servicio y horario;
   - los logs del worker: «Worker …: tareas cada 30 s» y la limpieza horaria;
   - en el canvas, el worker sano.

## Pendiente y riesgos

- **Dependencias de desarrollo:** el pre-deploy usa `prisma` (migraciones) y, en staging, `tsx` (seed). Railpack no las borra por defecto. Si se activa la poda (`RAILPACK_PRUNE_DEPS`), las migraciones fallan.
- **Producción real:** dominio propio (`reservas.sicurella.com.ar`, por ejemplo), bootstrap de la organización y el primer usuario, backups ensayados (Q03) y alertas sobre `/ready` del worker.
- **Emails (P03):** sin proveedor, la recuperación de contraseña en producción la gestiona un administrador.
- **Aplicar desde CI:** el action `railwayapp/config` puede planificar en cada PR y aplicar al mergear. Requiere un token de proyecto (`RAILWAY_TOKEN`) y queda para cuando el IaC esté probado contra el proyecto real.

## Verificación hecha

- **IaC:** `.railway/railway.ts` se evaluó con el SDK (`railway@3.13.0`) para `staging` y `production`: tres servicios y Postgres 18, con las diferencias esperadas de pre-deploy y variables. No se aplicó a ningún proyecto.
- **Portal (`servidor.mjs`) con el build real:**
  - `/` y rutas de la SPA → `index.html` con `no-cache`;
  - `assets/` → caché inmutable;
  - archivo inexistente → 404;
  - `..%2f` y `%2e%2e` → 404 (no sale de `dist/`);
  - URL mal codificada → 400;
  - `POST` → 405;
  - cabeceras de seguridad presentes.
- **Pruebas:**
  - `npm run test:domain`: 40 tests, con los nuevos de IP del cliente y origen.
  - `npm run test:database`: 121.
- `npm run check` y smoke.
