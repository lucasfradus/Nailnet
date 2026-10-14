-- CreateEnum
CREATE TYPE "MedioPagoGasto" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'MERCADO_PAGO', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoMovimientoGasto" AS ENUM ('GASTO', 'REVERSO');

-- CreateTable
CREATE TABLE "CategoriaGasto" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoriaGasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gasto" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "categoriaId" UUID NOT NULL,
    "tipo" "TipoMovimientoGasto" NOT NULL,
    "fecha" DATE NOT NULL,
    "montoCentavos" BIGINT NOT NULL,
    "medioPago" "MedioPagoGasto" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "comprobante" TEXT,
    "registradoPorId" UUID NOT NULL,
    "revierteId" UUID,
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoriaGasto_organizacionId_sedeId_idx" ON "CategoriaGasto"("organizacionId", "sedeId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaGasto_organizacionId_id_key" ON "CategoriaGasto"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "Gasto_sedeId_fecha_idx" ON "Gasto"("sedeId", "fecha");

-- CreateIndex
CREATE INDEX "Gasto_organizacionId_fecha_idx" ON "Gasto"("organizacionId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Gasto_organizacionId_id_key" ON "Gasto"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Gasto_organizacionId_revierteId_key" ON "Gasto"("organizacionId", "revierteId");

-- AddForeignKey
ALTER TABLE "CategoriaGasto" ADD CONSTRAINT "CategoriaGasto_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaGasto" ADD CONSTRAINT "CategoriaGasto_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_organizacionId_categoriaId_fkey" FOREIGN KEY ("organizacionId", "categoriaId") REFERENCES "CategoriaGasto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_organizacionId_revierteId_fkey" FOREIGN KEY ("organizacionId", "revierteId") REFERENCES "Gasto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma: mantener en migraciones SQL.

-- Nombres de categoría únicos sin distinguir mayúsculas: entre las globales de la organización y,
-- aparte, entre las locales de cada sede. Que una local no repita una global se valida en el repositorio.
ALTER TABLE "CategoriaGasto" ADD CONSTRAINT "CategoriaGasto_nombre" CHECK (length(btrim("nombre")) BETWEEN 1 AND 60);
CREATE UNIQUE INDEX "CategoriaGasto_nombre_global" ON "CategoriaGasto"("organizacionId", lower("nombre")) WHERE "sedeId" IS NULL;
CREATE UNIQUE INDEX "CategoriaGasto_nombre_local" ON "CategoriaGasto"("organizacionId", "sedeId", lower("nombre")) WHERE "sedeId" IS NOT NULL;

-- Forma de cada movimiento (COALESCE: un CHECK que evalúa a NULL se aceptaría).
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_forma" CHECK (COALESCE(
  ("tipo" = 'GASTO' AND "montoCentavos" > 0 AND "revierteId" IS NULL AND "motivoAnulacion" IS NULL)
  OR ("tipo" = 'REVERSO' AND "montoCentavos" < 0 AND "revierteId" IS NOT NULL AND length(btrim("motivoAnulacion")) BETWEEN 5 AND 500), false));
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_textos" CHECK (
  length(btrim("descripcion")) BETWEEN 3 AND 500 AND ("comprobante" IS NULL OR length("comprobante") <= 120));

-- Historial financiero: un gasto no se edita ni se borra, se anula con un reverso.
CREATE TRIGGER "Gasto_inmutable" BEFORE UPDATE OR DELETE ON "Gasto" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();

-- Coherencia que una FK no puede expresar:
-- - la categoría es global o local de la misma sede, y un gasto nuevo no usa categorías inactivas;
-- - el reverso copia sede, categoría, fecha y medio del gasto original y niega exactamente su monto.
CREATE FUNCTION "gasto_coherente"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  categoria RECORD;
  original RECORD;
BEGIN
  SELECT "sedeId", "activo" INTO categoria FROM "CategoriaGasto" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."categoriaId";
  IF FOUND AND categoria."sedeId" IS NOT NULL AND categoria."sedeId" <> NEW."sedeId" THEN
    RAISE EXCEPTION 'La categoría de gasto es local de otra sede';
  END IF;
  IF NEW."tipo" = 'GASTO' AND FOUND AND NOT categoria."activo" THEN
    RAISE EXCEPTION 'La categoría de gasto está inactiva';
  END IF;
  IF NEW."tipo" = 'REVERSO' THEN
    SELECT * INTO original FROM "Gasto" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."revierteId";
    IF NOT FOUND OR original."tipo" <> 'GASTO' OR original."sedeId" <> NEW."sedeId" OR original."categoriaId" <> NEW."categoriaId"
      OR original."fecha" <> NEW."fecha" OR original."medioPago" <> NEW."medioPago" OR original."montoCentavos" <> -NEW."montoCentavos" THEN
      RAISE EXCEPTION 'El reverso no corresponde al gasto original';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Gasto_coherente" BEFORE INSERT ON "Gasto" FOR EACH ROW EXECUTE FUNCTION "gasto_coherente"();
