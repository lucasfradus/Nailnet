-- CreateEnum
CREATE TYPE "Proveedor" AS ENUM ('MERCADO_PAGO', 'FACTURANTE');

-- CreateTable
CREATE TABLE "ConfiguracionOrganizacion" (
    "organizacionId" UUID NOT NULL,
    "horizonteReservaDias" INTEGER,
    "anticipacionMinimaMinutos" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionOrganizacion_pkey" PRIMARY KEY ("organizacionId")
);

-- CreateTable
CREATE TABLE "ConfiguracionSede" (
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "horizonteReservaDias" INTEGER,
    "anticipacionMinimaMinutos" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionSede_pkey" PRIMARY KEY ("sedeId")
);

-- CreateTable
CREATE TABLE "CredencialProveedor" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "proveedor" "Proveedor" NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "cuentaExterna" TEXT,
    "publicos" JSONB NOT NULL,
    "secretoCifrado" TEXT NOT NULL,
    "pista" TEXT NOT NULL,
    "actualizadoPor" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredencialProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionSede_organizacionId_sedeId_key" ON "ConfiguracionSede"("organizacionId", "sedeId");

-- CreateIndex
CREATE INDEX "CredencialProveedor_organizacionId_idx" ON "CredencialProveedor"("organizacionId");

-- CreateIndex
CREATE UNIQUE INDEX "CredencialProveedor_sedeId_proveedor_ambiente_key" ON "CredencialProveedor"("sedeId", "proveedor", "ambiente");

-- CreateIndex
CREATE UNIQUE INDEX "CredencialProveedor_proveedor_ambiente_cuentaExterna_key" ON "CredencialProveedor"("proveedor", "ambiente", "cuentaExterna");

-- AddForeignKey
ALTER TABLE "ConfiguracionOrganizacion" ADD CONSTRAINT "ConfiguracionOrganizacion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionSede" ADD CONSTRAINT "ConfiguracionSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredencialProveedor" ADD CONSTRAINT "CredencialProveedor_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma: mantener en migraciones SQL.
ALTER TABLE "ConfiguracionOrganizacion" ADD CONSTRAINT "ConfiguracionOrganizacion_rangos" CHECK (
  ("horizonteReservaDias" IS NULL OR "horizonteReservaDias" BETWEEN 1 AND 365)
  AND ("anticipacionMinimaMinutos" IS NULL OR "anticipacionMinimaMinutos" BETWEEN 0 AND 10080));
ALTER TABLE "ConfiguracionSede" ADD CONSTRAINT "ConfiguracionSede_rangos" CHECK (
  ("horizonteReservaDias" IS NULL OR "horizonteReservaDias" BETWEEN 1 AND 365)
  AND ("anticipacionMinimaMinutos" IS NULL OR "anticipacionMinimaMinutos" BETWEEN 0 AND 10080));
-- Nunca texto plano: el formato cifrado es gcm.<version>.<iv>.<tag>.<datos>.
ALTER TABLE "CredencialProveedor" ADD CONSTRAINT "CredencialProveedor_cifrado" CHECK ("secretoCifrado" ~ '^gcm\.v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$');
