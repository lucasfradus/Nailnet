# Persistencia

Prisma 7.10 y PostgreSQL 18. Primera migración: organización, franquiciado, sede, usuario, membresía, asignación de roles, emisor y punto de venta por sede. `src/access.ts` contiene lectura y renombrado de sedes con autorización obligatoria. No se expone por HTTP hasta tener sesión validada.

Consultar [instrucciones y límites](../../docs/06-fundacion.md). El cliente generado se excluye de Git; ejecutar `npm run db:generate` desde la raíz después de instalar. Las constraints SQL manuales también deben conservarse al evolucionar el esquema.
