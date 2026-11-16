# Persistencia

Prisma 7.10 y PostgreSQL 18. Primera migración: organización, franquiciado, sede, usuario, membresía, asignación de roles, emisor y punto de venta por sede. `src/access.ts` contiene lectura y renombrado de sedes con autorización obligatoria. No se expone por HTTP hasta tener sesión validada.

Consultar [instrucciones y límites](../../docs/06-fundacion.md). El cliente generado se excluye de Git; ejecutar `npm run db:generate` desde la raíz después de instalar. Las constraints SQL manuales también deben conservarse al evolucionar el esquema.

## Turnos demo

`npm run demo:turnos -w @nailnet/database -- --sede <nombre>` llena la agenda de una sede con turnos sintéticos: crea 40 clientas (`demo.<sede>.N@example.invalid`, reutilizadas en corridas siguientes) y turnos desde ahora hasta dentro de 13 días (`--dias N`), con ~65 % de ocupación (`--ocupacion 0.5`). Respeta la jornada de cada profesional en la sede, los servicios que tiene habilitados, feriados, bloqueos y lo que ya ocupa agenda en cualquier sede. Los turnos quedan confirmados (algunos cancelados), con canal online o recepción y su evento de creación.

Por defecto es una simulación con rollback; `--aplicar` confirma. Tiene la misma barrera que el seed: `ALLOW_DEMO_SEED=true` y nunca con `NAILNET_AMBIENTE=produccion`. El historial de reservas es inmutable, así que lo aplicado no se borra: se cancela.
