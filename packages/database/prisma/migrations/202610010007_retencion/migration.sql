-- AlterTable
ALTER TABLE "ConfiguracionOrganizacion" ADD COLUMN     "retencionMinutos" INTEGER;

-- AlterTable
ALTER TABLE "ConfiguracionSede" ADD COLUMN     "retencionMinutos" INTEGER;


-- D4 pendiente: sin valor no se retienen turnos. NULL-safe.
ALTER TABLE "ConfiguracionOrganizacion" ADD CONSTRAINT "ConfiguracionOrganizacion_retencion" CHECK ("retencionMinutos" IS NULL OR "retencionMinutos" BETWEEN 5 AND 60);
ALTER TABLE "ConfiguracionSede" ADD CONSTRAINT "ConfiguracionSede_retencion" CHECK ("retencionMinutos" IS NULL OR "retencionMinutos" BETWEEN 5 AND 60);
