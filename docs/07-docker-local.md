# Entorno local con Docker

Requiere Docker Desktop con el motor Linux funcionando. Desde la raíz del proyecto:

```sh
docker compose up -d --build --wait
```

Este comando construye una imagen de desarrollo con Node 24, instala dependencias dentro de Linux y genera Prisma. PostgreSQL 18 usa un volumen persistente. El servicio setup espera a la base, aplica migraciones y carga la demo una sola vez; es normal que termine con estado Exited (0). Backoffice y worker esperan a que termine correctamente. Cada aplicación tiene un healthcheck.

- Administración: http://localhost:3000
- Portal: http://localhost:5173
- Worker: http://localhost:3001/health
- PostgreSQL desde el host: localhost:55432, base y usuario nailnet, contraseña de desarrollo nailnet_local_only.

Los puertos publicados escuchan solo en localhost. Las aplicaciones dentro de Docker usan postgres:5432; el portal no recibe DATABASE_URL. No se copian .env ni dependencias Windows a la imagen. La imagen es para desarrollo, no para producción.

## Qué se puede probar

Pantallas iniciales, controles HTTP, base persistente y datos sintéticos: dos franquiciados, tres sedes, seis usuarios sin contraseña y dos puntos de venta del mismo emisor. Todavía no hay login ni CRUD visual. Los permisos se prueban con la suite de integración, no desde las pantallas actuales.

Para ejecutar esa suite contra este PostgreSQL con fixtures adicionales aisladas por organización:

```sh
docker compose run --rm -e TEST_DATABASE_URL=postgresql://nailnet:nailnet_local_only@postgres:5432/nailnet setup npm run test -w @nailnet/database
```

La prueba agrega datos sintéticos; no elimina ni reemplaza datos existentes.

## Operación cotidiana

```sh
docker compose ps -a
docker compose logs --tail 80 setup backoffice booking worker
docker compose down
```

down conserva la base. No usar la opción de borrar volúmenes si se quieren conservar datos. Para volver a arrancar, repetir el comando inicial. Los directorios src de las aplicaciones están montados para desarrollo; cambios de dependencias, paquetes compartidos o configuración requieren reconstruir con --build. Si Vite no detecta un cambio de archivos en Windows, reiniciar booking.

Si se cambian credenciales en compose.yaml después de crear el volumen, PostgreSQL conserva las credenciales originales; modificar el archivo no las cambia en la base existente.
