-- Dirección de cada sede en el portal de reservas (`/lomada`). Se completa desde el nombre con la misma
-- regla que `slugDesdeNombre` (packages/domain/src/sedes.ts): sin acentos, minúsculas y guiones. Si dos sedes
-- de la organización darían el mismo, la más nueva lleva sufijo (`-2`); las rutas reservadas del portal también.

-- AlterTable
ALTER TABLE "Sede" ADD COLUMN "slug" TEXT;

WITH base AS (
  SELECT id, "organizacionId", "createdAt",
    COALESCE(NULLIF(trim(BOTH '-' FROM left(trim(BOTH '-' FROM regexp_replace(
      lower(translate(nombre, 'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÇáéíóúüñàèìòùâêîôûç', 'AEIOUUNAEIOUAEIOUCaeiouunaeiouaeiouc')),
      '[^a-z0-9]+', '-', 'g')), 55)), ''), 'sede') AS b
  FROM "Sede"
), numerado AS (
  SELECT id, b,
    row_number() OVER (PARTITION BY "organizacionId", b ORDER BY "createdAt", id)
      + CASE WHEN b IN ('assets', 'api', 'mis-turnos', 'turnos', 'reserva', 'reservas', 'sedes') THEN 1 ELSE 0 END AS n
  FROM base
)
UPDATE "Sede" s SET "slug" = CASE WHEN numerado.n = 1 THEN numerado.b ELSE numerado.b || '-' || numerado.n END
FROM numerado WHERE numerado.id = s.id;

ALTER TABLE "Sede" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Sede_organizacionId_slug_key" ON "Sede"("organizacionId", "slug");
