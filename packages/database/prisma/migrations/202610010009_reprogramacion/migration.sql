-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "reemplazaId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Reserva_reemplazaId_key" ON "Reserva"("reemplazaId");

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_reemplazaId_fkey" FOREIGN KEY ("reemplazaId") REFERENCES "Reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

