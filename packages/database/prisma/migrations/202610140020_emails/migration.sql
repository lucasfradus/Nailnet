-- P03: evidencia de los emails transaccionales (Resend). Ver docs/24-emails.md.
-- CreateEnum
CREATE TYPE "EstadoEmail" AS ENUM ('PENDIENTE', 'ENVIADO', 'SIMULADO', 'OMITIDO', 'FALLIDO', 'DEMORADO', 'ENTREGADO', 'REBOTADO', 'QUEJA');

-- CreateTable
CREATE TABLE "EnvioEmail" (
    "id" UUID NOT NULL,
    "organizacionId" UUID,
    "clave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "reservaId" UUID,
    "usuarioId" UUID,
    "destinatario" TEXT,
    "asunto" TEXT,
    "proveedor" TEXT,
    "proveedorId" TEXT,
    "estado" "EstadoEmail" NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" TEXT,
    "motivo" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "eventoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvioEmail_clave_key" ON "EnvioEmail"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "EnvioEmail_proveedorId_key" ON "EnvioEmail"("proveedorId");

-- CreateIndex
CREATE INDEX "EnvioEmail_reservaId_idx" ON "EnvioEmail"("reservaId");

-- CreateIndex
CREATE INDEX "EnvioEmail_usuarioId_idx" ON "EnvioEmail"("usuarioId");

-- CreateIndex
CREATE INDEX "EnvioEmail_organizacionId_createdAt_idx" ON "EnvioEmail"("organizacionId", "createdAt");

-- CreateIndex
CREATE INDEX "EnvioEmail_estado_updatedAt_idx" ON "EnvioEmail"("estado", "updatedAt");

-- Reglas no expresables en schema.prisma.
ALTER TABLE "EnvioEmail" ADD CONSTRAINT "EnvioEmail_clave_longitud" CHECK (length("clave") BETWEEN 1 AND 200);
ALTER TABLE "EnvioEmail" ADD CONSTRAINT "EnvioEmail_tipo_formato" CHECK ("tipo" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE "EnvioEmail" ADD CONSTRAINT "EnvioEmail_intentos" CHECK ("intentos" >= 0);
-- Resúmenes acotados: nunca cuerpos de respuesta ni secretos completos.
ALTER TABLE "EnvioEmail" ADD CONSTRAINT "EnvioEmail_textos_longitud" CHECK (
  ("ultimoError" IS NULL OR length("ultimoError") <= 1000) AND ("motivo" IS NULL OR length("motivo") <= 500)
  AND ("asunto" IS NULL OR length("asunto") <= 300) AND ("destinatario" IS NULL OR length("destinatario") <= 320)
);
-- Lo que el proveedor aceptó tiene su id y su fecha de envío.
ALTER TABLE "EnvioEmail" ADD CONSTRAINT "EnvioEmail_aceptado_con_id" CHECK ("estado" NOT IN ('ENVIADO', 'SIMULADO', 'DEMORADO', 'ENTREGADO', 'REBOTADO', 'QUEJA') OR ("proveedorId" IS NOT NULL AND "enviadoEn" IS NOT NULL));

