-- CreateEnum
CREATE TYPE "CanalReserva" AS ENUM ('ONLINE', 'RECEPCION');

-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('PENDIENTE_PAGO', 'PAGO_EN_REVISION', 'CONFIRMADA', 'ATENDIDA', 'AUSENTE', 'CANCELADA', 'EXPIRADA');

-- AlterTable
ALTER TABLE "ConfiguracionOrganizacion" ADD COLUMN     "pasoGrillaMinutos" INTEGER;

-- AlterTable
ALTER TABLE "ConfiguracionSede" ADD COLUMN     "pasoGrillaMinutos" INTEGER;

-- CreateTable
CREATE TABLE "Reserva" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "clienteId" UUID,
    "canal" "CanalReserva" NOT NULL,
    "estado" "EstadoReserva" NOT NULL,
    "expiraEn" TIMESTAMP(3),
    "creadoPor" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservaItem" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "posicion" INTEGER NOT NULL,
    "servicioId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "ocupaDesde" TIMESTAMP(3) NOT NULL,
    "ocupaHasta" TIMESTAMP(3) NOT NULL,
    "duracionMinutos" INTEGER NOT NULL,
    "bufferAntesMinutos" INTEGER NOT NULL,
    "bufferDespuesMinutos" INTEGER NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "sena" DECIMAL(12,2),

    CONSTRAINT "ReservaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservaItemRecurso" (
    "organizacionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "recursoId" UUID NOT NULL,
    "ocupaDesde" TIMESTAMP(3) NOT NULL,
    "ocupaHasta" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservaItemRecurso_pkey" PRIMARY KEY ("itemId","recursoId")
);

-- CreateIndex
CREATE INDEX "Reserva_sedeId_estado_idx" ON "Reserva"("sedeId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Reserva_organizacionId_id_key" ON "Reserva"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "ReservaItem_profesionalId_ocupaDesde_idx" ON "ReservaItem"("profesionalId", "ocupaDesde");

-- CreateIndex
CREATE UNIQUE INDEX "ReservaItem_organizacionId_id_key" ON "ReservaItem"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReservaItem_reservaId_posicion_key" ON "ReservaItem"("reservaId", "posicion");

-- CreateIndex
CREATE INDEX "ReservaItemRecurso_recursoId_ocupaDesde_idx" ON "ReservaItemRecurso"("recursoId", "ocupaDesde");

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_organizacionId_clienteId_fkey" FOREIGN KEY ("organizacionId", "clienteId") REFERENCES "Cliente"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaItem" ADD CONSTRAINT "ReservaItem_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaItem" ADD CONSTRAINT "ReservaItem_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaItem" ADD CONSTRAINT "ReservaItem_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaItemRecurso" ADD CONSTRAINT "ReservaItemRecurso_organizacionId_itemId_fkey" FOREIGN KEY ("organizacionId", "itemId") REFERENCES "ReservaItem"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaItemRecurso" ADD CONSTRAINT "ReservaItemRecurso_organizacionId_recursoId_fkey" FOREIGN KEY ("organizacionId", "recursoId") REFERENCES "Recurso"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. NULL-safe.
ALTER TABLE "ConfiguracionOrganizacion" ADD CONSTRAINT "ConfiguracionOrganizacion_paso" CHECK ("pasoGrillaMinutos" IS NULL OR ("pasoGrillaMinutos" BETWEEN 5 AND 120 AND "pasoGrillaMinutos" % 5 = 0));
ALTER TABLE "ConfiguracionSede" ADD CONSTRAINT "ConfiguracionSede_paso" CHECK ("pasoGrillaMinutos" IS NULL OR ("pasoGrillaMinutos" BETWEEN 5 AND 120 AND "pasoGrillaMinutos" % 5 = 0));
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_pendiente_vence" CHECK (
  "estado" NOT IN ('PENDIENTE_PAGO', 'PAGO_EN_REVISION') OR "expiraEn" IS NOT NULL);
ALTER TABLE "ReservaItem" ADD CONSTRAINT "ReservaItem_intervalos" CHECK (
  "fin" > "inicio" AND "ocupaDesde" <= "inicio" AND "ocupaHasta" >= "fin" AND "posicion" >= 0
  AND "duracionMinutos" > 0 AND "bufferAntesMinutos" >= 0 AND "bufferDespuesMinutos" >= 0 AND "precio" >= 0
  AND ("sena" IS NULL OR ("sena" >= 0 AND "sena" <= "precio")));
ALTER TABLE "ReservaItemRecurso" ADD CONSTRAINT "ReservaItemRecurso_intervalo" CHECK ("ocupaHasta" > "ocupaDesde");
