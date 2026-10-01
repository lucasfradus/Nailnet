-- AlterTable
ALTER TABLE "Organizacion" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "TokenReserva" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenReserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaveIdempotencia" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "ambito" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "hashSolicitud" CHAR(64) NOT NULL,
    "estado" TEXT NOT NULL,
    "codigo" INTEGER,
    "respuesta" JSONB,
    "reservaId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaveIdempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoPublico" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "clave" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoPublico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenReserva_tokenHash_key" ON "TokenReserva"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenReserva_reservaId_idx" ON "TokenReserva"("reservaId");

-- CreateIndex
CREATE INDEX "ClaveIdempotencia_expiraEn_idx" ON "ClaveIdempotencia"("expiraEn");

-- CreateIndex
CREATE UNIQUE INDEX "ClaveIdempotencia_organizacionId_ambito_clave_key" ON "ClaveIdempotencia"("organizacionId", "ambito", "clave");

-- CreateIndex
CREATE INDEX "EventoPublico_tipo_clave_createdAt_idx" ON "EventoPublico"("tipo", "clave", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacion_slug_key" ON "Organizacion"("slug");

-- AddForeignKey
ALTER TABLE "TokenReserva" ADD CONSTRAINT "TokenReserva_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. NULL-safe.
ALTER TABLE "Organizacion" ADD CONSTRAINT "Organizacion_slug_formato" CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "TokenReserva" ADD CONSTRAINT "TokenReserva_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ClaveIdempotencia" ADD CONSTRAINT "ClaveIdempotencia_estado" CHECK ("estado" IN ('EN_CURSO', 'COMPLETADA'));
