# Fundación de datos y permisos · 2026-09-10

## Implementación

Primera parte de F02 y A01: migración Prisma 7.10/PostgreSQL 18, datos sintéticos y repositorios de sedes con autorización. Cada sede pertenece obligatoriamente a un franquiciado dentro de su organización. Las claves foráneas compuestas impiden enlaces entre organizaciones en sedes, roles y configuración fiscal.

Usuario y propietario comercial son entidades distintas. Membresía activa y asignación explícita son obligatorias. Un usuario sin rol no recibe acceso. Roles iniciales fijos en un enum; la matriz de permisos vive en domain y se prueba junto al código. No hay editor de roles ni tablas de permisos configurables todavía. ADMIN_SEDE administra su sede, pero no concede roles; recepción solo lee las sedes asignadas. Los permisos financieros no están implementados.

Las consultas comprueban organización, usuario y membresía activos, además de sede/franquiciado activos. Los roles se releen por operación y se revalidan en el predicado de la consulta final. El filtro de sede no amplía alcance. La escritura por ID usa el mismo control. Estos repositorios son internos: usuarioId debe venir de una futura sesión validada en servidor, nunca de un formulario o body público.

EmisorFiscal pertenece a la organización y es único por CUIT. ConfiguracionFiscalSede vincula emisor, sede, ambiente y punto de venta. Dos sedes pueden compartir emisor con puntos distintos; un punto no puede repetirse para el mismo emisor/ambiente. Solo se valida el formato del CUIT, no su existencia ni habilitación fiscal. El CUIT del seed es sintético. No se guardan credenciales ni se emiten comprobantes.

Constraints adicionales en SQL: forma válida de cada rol/alcance, asignación única incluyendo campos nulos, punto de venta positivo y email normalizado. No sustituir estas migraciones por db push. El esquema requiere PostgreSQL 15 o superior por NULLS NOT DISTINCT; el entorno de referencia y las pruebas usan 18.

## Uso local

Desde la raíz:

1. `npm ci`
2. `npm run db:generate`
3. Con Docker Desktop funcionando: `docker compose up -d --wait postgres`
4. Copiar `packages/database/.env.example` a `packages/database/.env`.
5. `npm run db:migrate`
6. En PowerShell: `$env:ALLOW_DEMO_SEED = 'true'`, luego `npm run db:seed`.

La base Docker escucha solo en localhost:55432 y usa credenciales de desarrollo. El seed está deshabilitado en producción y requiere habilitación explícita; es transaccional y no modifica una demo ya existente. Crea dos franquiciados, tres sedes, seis usuarios sin contraseña y un emisor compartido por dos sedes con puntos de venta distintos. No permite iniciar sesión.

La configuración .env la lee la CLI desde packages/database. Las futuras aplicaciones de servidor necesitarán su propia DATABASE_URL; nunca exponerla con un prefijo VITE_. Generar el cliente no necesita una conexión activa. Migraciones y seed sí.

## Verificación

`npm run test:database` inicia PostgreSQL real temporal con encoding UTF8, aplica la migración dos veces y el seed dos veces, prueba acceso cruzado en lectura/escritura, revocación, usuarios sin rol/inactivos, relaciones entre organizaciones y puntos de venta. Detiene y elimina únicamente su cluster temporal. No usa DATABASE_URL existente. Puerto predeterminado 55433; TEST_POSTGRES_PORT permite cambiarlo. El runner usa embedded-postgres solo como dependencia de desarrollo.

`npm run test:domain` verifica que roles con alcances inválidos no concedan permisos. `npm run check` verifica lint, tipos y builds. Los mismos comandos están en CI junto al smoke HTTP.

En este equipo Docker no arrancó; las pruebas se ejecutaron con PostgreSQL 18.4 temporal. No se provisionó una base persistente ni infraestructura remota.

Al instalar Prisma, npm audit reporta cuatro entradas de severidad alta en dependencias transitivas de su CLI (deepmerge-ts y mysql2 y sus dependientes). No hay uso de MySQL ni entradas de usuario en la configuración de Prisma. Queda pendiente actualizar esas dependencias con una versión compatible de la CLI antes de producción; no se aplicó una degradación automática de Prisma ni una actualización mayor sin validar.

## Próximo incremento

F02 todavía no incluye CRUD visual. F03 sigue pendiente: login/logout, hashing, sesiones, recuperación de un uso, límites de intentos y pruebas de revocación de sesión. Luego conectar las pantallas de sedes a los repositorios autorizados. A01 es parcial: agenda propia, clientes, exportaciones y permisos financieros se incorporarán con sus módulos. D12 no bloquea esta base de identidad; catálogo y políticas comerciales continúan pendientes.
