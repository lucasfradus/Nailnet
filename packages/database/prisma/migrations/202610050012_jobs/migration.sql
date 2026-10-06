-- CreateEnum
CREATE TYPE "EstadoJob" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'FALLIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "organizacionId" UUID,
    "tipo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" "EstadoJob" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "maxIntentos" INTEGER NOT NULL DEFAULT 8,
    "proximoIntento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseHasta" TIMESTAMP(3),
    "leaseDe" TEXT,
    "ultimoError" TEXT,
    "resultado" JSONB,
    "completadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_clave_key" ON "Job"("clave");

-- CreateIndex
CREATE INDEX "Job_estado_proximoIntento_idx" ON "Job"("estado", "proximoIntento");

-- CreateIndex
CREATE INDEX "Job_estado_leaseHasta_idx" ON "Job"("estado", "leaseHasta");


-- Reglas no expresables en schema.prisma.
ALTER TABLE "Job" ADD CONSTRAINT "Job_tipo_formato" CHECK ("tipo" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE "Job" ADD CONSTRAINT "Job_clave_longitud" CHECK (length("clave") BETWEEN 1 AND 200);
ALTER TABLE "Job" ADD CONSTRAINT "Job_intentos" CHECK ("intentos" >= 0 AND "maxIntentos" BETWEEN 1 AND 50);
-- Un trabajo en proceso siempre tiene dueño y vencimiento de lease.
ALTER TABLE "Job" ADD CONSTRAINT "Job_lease" CHECK ("estado" <> 'EN_PROCESO' OR ("leaseHasta" IS NOT NULL AND "leaseDe" IS NOT NULL));
-- El error guardado es un resumen, no un volcado: nunca payloads ni secretos completos.
ALTER TABLE "Job" ADD CONSTRAINT "Job_error_longitud" CHECK ("ultimoError" IS NULL OR length("ultimoError") <= 1000);
