# Autenticación del backoffice · 2026-09-30

Implementa F03: login, logout, sesiones revocables, límite de intentos y recuperación de contraseña de un solo uso. Migración `202609300001_autenticacion`.

## Decisiones técnicas

- **Sesiones propias en PostgreSQL** en lugar de Auth.js (beta en Clicnet). El plan exige revalidar usuario, membresía y revocación en cada operación. Con sesiones en base eso es directo; un JWT sin estado no lo permite.
- **Contraseñas con scrypt de Node** (`node:crypto`), sin dependencias nativas. Parámetros OWASP N=2^15, r=8, p=3 (~32 MiB por hash). El formato versionado `scrypt$v1$N$r$p$sal$hash` permite endurecer parámetros: el login rehashea automáticamente si cambian.
- **Política de contraseña**: 12 a 128 caracteres, sin reglas de composición (NIST 800-63B).
- **Tokens opacos** de 32 bytes aleatorios. En base solo se guarda su SHA-256; un volcado de la tabla no permite usar sesiones ni enlaces.

## Reglas implementadas

| Regla | Valor | Dónde |
|---|---|---|
| Duración máxima de sesión | 12 h | `POLITICA_ACCESO` en `packages/database/src/auth.ts` |
| Cierre por inactividad | 2 h (resolución de 1 min) | idem |
| Fallos por email | 5 en 15 min; un acceso correcto reinicia el conteo | idem |
| Fallos por IP | 30 en 15 min, solo si `TRUST_PROXY=true` | idem |
| Enlace de recuperación | 30 min, un uso, solo el último emitido vale | idem |
| Solicitudes de recuperación | 3 por email y 10 por IP por hora | idem |

- Sin membresía activa en una organización activa no hay sesión: mismo error que una clave incorrecta.
- Email inexistente, clave incorrecta y usuario sin contraseña devuelven el mismo mensaje y ejecutan scrypt igual, para no revelar por tiempo qué emails existen.
- Los intentos concurrentes sobre el mismo email se serializan con `pg_advisory_xact_lock`, así que el límite no se elude con requests en paralelo (probado).
- Desactivar un usuario o su membresía invalida sus sesiones en la siguiente request. Reactivarlo no revive sesiones revocadas.
- Restablecer o establecer contraseña cierra todas las sesiones y anula enlaces pendientes. El consumo del enlace es condicional: dos envíos simultáneos no pueden ganar ambos.
- Cookie `HttpOnly`, `SameSite=Lax`, con vencimiento igual al de la sesión. En producción se llama `__Host-nailnet_sesion` y es `Secure`.
- CSRF: los formularios son Server Actions; Next.js rechaza las que traen un `Origin` distinto del `Host`. Detrás de un proxy que reescriba el host habrá que configurar `serverActions.allowedOrigins`.
- El token de recuperación viaja en el fragmento (`/restablecer#token`): no llega a logs del servidor ni se filtra por `Referer`, y la página lo borra de la barra de direcciones.
- Cabeceras: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` y sin `X-Powered-By`.

## Pendiente, deliberadamente

- **Envío de emails** (P03, Resend + outbox del worker F04). En desarrollo el enlace de recuperación se imprime en la consola del backoffice. En producción la pantalla de recuperación no emite enlaces y deriva a un administrador, para no crear tokens que nadie recibiría.
- Alta de usuarios e invitaciones desde la UI (A02). Hoy la contraseña inicial se asigna por CLI.
- Limpieza periódica de sesiones vencidas e intentos antiguos: tarea del worker.
- Selección de organización activa para usuarios con varias membresías: se resolverá con el selector de sede (A02).
- Verificación en dos pasos: fuera del MVP salvo pedido.

## Uso local

Los usuarios de la demo no tienen contraseña. Para asignar una (se lee de variable de entorno, no de argumentos):

```powershell
$env:NAILNET_PASSWORD = 'una frase de al menos doce'
npm run usuario:password -w @nailnet/database -- master-00000000-0000-4000-8000-000000000001@example.invalid
```

Con Docker:

```sh
docker compose run --rm -e NAILNET_PASSWORD='una frase de al menos doce' setup npm run usuario:password -w @nailnet/database -- master-00000000-0000-4000-8000-000000000001@example.invalid
```

Los emails demo siguen el patrón `<rol>-00000000-0000-4000-8000-000000000001@example.invalid` con rol `master`, `franquiciado`, `admin`, `recepcion`, `profesional` o `sin-rol`. Después ingresar en http://localhost:3000/login.

## Verificación

- `npm run test:domain`: hash, verificación, formatos inválidos, política y tokens.
- `npm run test:database`: 11 escenarios de autenticación en PostgreSQL real, entre ellos bloqueo en paralelo, límite por IP, desactivación, vencimientos, carrera de restablecimiento y constraints.
- `node scripts/smoke.mjs`: `/` redirige a `/login` sin sesión y el login responde con las cabeceras de seguridad.
- Se ejecutó además una prueba E2E manual (no incluida en CI) con PostgreSQL embebido y `next dev`, enviando los formularios por HTTP: clave incorrecta, `Origin` ajeno rechazado, login, inicio protegido, logout que invalida la cookie, recuperación de un uso y login con la nueva clave. No se probó en un navegador real.
