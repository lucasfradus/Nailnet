-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('MASTER_FRANQUICIADOR', 'FRANQUICIADO', 'ADMIN_SEDE', 'RECEPCIONISTA', 'PROFESIONAL');

-- CreateEnum
CREATE TYPE "Alcance" AS ENUM ('ORGANIZACION', 'FRANQUICIADO', 'SEDE', 'PROPIO');

-- CreateEnum
CREATE TYPE "Ambiente" AS ENUM ('PRUEBA', 'PRODUCCION');

-- CreateTable
CREATE TABLE "Organizacion" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Franquiciado" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Franquiciado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sede" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "franquiciadoId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembresiaOrganizacion" (
    "organizacionId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembresiaOrganizacion_pkey" PRIMARY KEY ("organizacionId","usuarioId")
);

-- CreateTable
CREATE TABLE "AsignacionRol" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "rol" "Rol" NOT NULL,
    "alcance" "Alcance" NOT NULL,
    "franquiciadoId" UUID,
    "sedeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsignacionRol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmisorFiscal" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "cuit" VARCHAR(11) NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmisorFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionFiscalSede" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "emisorFiscalId" UUID NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionFiscalSede_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Franquiciado_organizacionId_id_key" ON "Franquiciado"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "Sede_organizacionId_franquiciadoId_idx" ON "Sede"("organizacionId", "franquiciadoId");

-- CreateIndex
CREATE UNIQUE INDEX "Sede_organizacionId_id_key" ON "Sede"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "AsignacionRol_organizacionId_usuarioId_idx" ON "AsignacionRol"("organizacionId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "EmisorFiscal_organizacionId_id_key" ON "EmisorFiscal"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EmisorFiscal_organizacionId_cuit_key" ON "EmisorFiscal"("organizacionId", "cuit");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionFiscalSede_organizacionId_sedeId_ambiente_key" ON "ConfiguracionFiscalSede"("organizacionId", "sedeId", "ambiente");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionFiscalSede_emisorFiscalId_ambiente_puntoVenta_key" ON "ConfiguracionFiscalSede"("emisorFiscalId", "ambiente", "puntoVenta");

-- AddForeignKey
ALTER TABLE "Franquiciado" ADD CONSTRAINT "Franquiciado_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sede" ADD CONSTRAINT "Sede_organizacionId_franquiciadoId_fkey" FOREIGN KEY ("organizacionId", "franquiciadoId") REFERENCES "Franquiciado"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembresiaOrganizacion" ADD CONSTRAINT "MembresiaOrganizacion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembresiaOrganizacion" ADD CONSTRAINT "MembresiaOrganizacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionRol" ADD CONSTRAINT "AsignacionRol_organizacionId_usuarioId_fkey" FOREIGN KEY ("organizacionId", "usuarioId") REFERENCES "MembresiaOrganizacion"("organizacionId", "usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionRol" ADD CONSTRAINT "AsignacionRol_organizacionId_franquiciadoId_fkey" FOREIGN KEY ("organizacionId", "franquiciadoId") REFERENCES "Franquiciado"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionRol" ADD CONSTRAINT "AsignacionRol_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmisorFiscal" ADD CONSTRAINT "EmisorFiscal_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionFiscalSede" ADD CONSTRAINT "ConfiguracionFiscalSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionFiscalSede" ADD CONSTRAINT "ConfiguracionFiscalSede_organizacionId_emisorFiscalId_fkey" FOREIGN KEY ("organizacionId", "emisorFiscalId") REFERENCES "EmisorFiscal"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas no expresables en schema.prisma: mantener en migraciones SQL.
ALTER TABLE "AsignacionRol" ADD CONSTRAINT "AsignacionRol_alcance_valido" CHECK (
  ("rol" = 'MASTER_FRANQUICIADOR' AND "alcance" = 'ORGANIZACION' AND "franquiciadoId" IS NULL AND "sedeId" IS NULL)
  OR ("rol" = 'FRANQUICIADO' AND "alcance" = 'FRANQUICIADO' AND "franquiciadoId" IS NOT NULL AND "sedeId" IS NULL)
  OR ("rol" IN ('ADMIN_SEDE', 'RECEPCIONISTA') AND "alcance" = 'SEDE' AND "sedeId" IS NOT NULL AND "franquiciadoId" IS NULL)
  OR ("rol" = 'PROFESIONAL' AND "alcance" = 'PROPIO' AND "franquiciadoId" IS NULL AND "sedeId" IS NULL)
);
CREATE UNIQUE INDEX "AsignacionRol_unica" ON "AsignacionRol"
  ("organizacionId", "usuarioId", "rol", "alcance", "franquiciadoId", "sedeId") NULLS NOT DISTINCT;
ALTER TABLE "ConfiguracionFiscalSede" ADD CONSTRAINT "puntoVenta_positivo" CHECK ("puntoVenta" > 0);
ALTER TABLE "EmisorFiscal" ADD CONSTRAINT "cuit_formato" CHECK ("cuit" ~ '^[0-9]{11}$');
ALTER TABLE "Usuario" ADD CONSTRAINT "email_normalizado" CHECK ("email" = lower(btrim("email")) AND length("email") > 3);
