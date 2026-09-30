-- CreateEnum
CREATE TYPE "TipoIntentoAcceso" AS ENUM ('LOGIN', 'RECUPERACION');

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "passwordActualizadaEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Sesion" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadaEn" TIMESTAMP(3),

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenRecuperacion" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),

    CONSTRAINT "TokenRecuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentoAcceso" (
    "id" UUID NOT NULL,
    "tipo" "TipoIntentoAcceso" NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "exitoso" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentoAcceso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sesion_tokenHash_key" ON "Sesion"("tokenHash");

-- CreateIndex
CREATE INDEX "Sesion_usuarioId_idx" ON "Sesion"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenRecuperacion_tokenHash_key" ON "TokenRecuperacion"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenRecuperacion_usuarioId_idx" ON "TokenRecuperacion"("usuarioId");

-- CreateIndex
CREATE INDEX "IntentoAcceso_tipo_email_createdAt_idx" ON "IntentoAcceso"("tipo", "email", "createdAt");

-- CreateIndex
CREATE INDEX "IntentoAcceso_tipo_ip_createdAt_idx" ON "IntentoAcceso"("tipo", "ip", "createdAt");

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenRecuperacion" ADD CONSTRAINT "TokenRecuperacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma: mantener en migraciones SQL.
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_vigencia_valida" CHECK ("expiraEn" > "createdAt");
ALTER TABLE "TokenRecuperacion" ADD CONSTRAINT "TokenRecuperacion_vigencia_valida" CHECK ("expiraEn" > "createdAt");
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_hash_formato" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "TokenRecuperacion" ADD CONSTRAINT "TokenRecuperacion_hash_formato" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Usuario" ADD CONSTRAINT "passwordHash_formato" CHECK ("passwordHash" IS NULL OR "passwordHash" LIKE 'scrypt$%');
