-- Universos de recepción, etapa 3b (doc 31): flexibilidad en Manos y pies. La clienta con turno que llegó
-- con su profesional ocupada queda esperando (llegoEn), y el turno apunta a la espera de la que salió
-- (esperaId) para que la visita sea una sola comanda: lo que se sienta después se suma a ese turno.

-- AlterEnum
ALTER TYPE "TipoEventoReserva" ADD VALUE 'SERVICIO_SUMADO';

-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "esperaId" UUID,
ADD COLUMN     "llegoEn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Reserva_esperaId_idx" ON "Reserva"("esperaId");

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_organizacionId_esperaId_fkey" FOREIGN KEY ("organizacionId", "esperaId") REFERENCES "EsperaRecepcion"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. COALESCE: un CHECK que evalúa a NULL se acepta.
-- Solo llega (y espera) una clienta con turno: una atención sin turno previo empieza al crearse.
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_llegada" CHECK (COALESCE("llegoEn" IS NULL OR NOT "sinTurnoPrevio", false));

-- Relleno de esperaId en los turnos existentes (doc 31, etapa 3b). Lo prueba tests/flexibilidad.test.ts:
-- las sentencias de relleno van entre estas dos marcas, separadas por punto y coma al final de la línea.
-- relleno:desde
-- 1. Los turnos que cerraron una espera («Atender ahora» desde la espera, o sentarla con todo lo que pidió).
UPDATE "Reserva" r SET "esperaId" = e."id"
FROM "EsperaRecepcion" e
WHERE e."organizacionId" = r."organizacionId" AND e."reservaId" = r."id" AND r."esperaId" IS NULL;
-- 2. Los sentados parciales: la espera quedó solo en el detalle del evento de creación del turno.
UPDATE "Reserva" r SET "esperaId" = e."id"
FROM "ReservaEvento" ev, "EsperaRecepcion" e
WHERE ev."reservaId" = r."id" AND ev."organizacionId" = r."organizacionId" AND ev."tipo" = 'CREADA'
  AND jsonb_typeof(ev."detalle" -> 'esperaId') = 'string'
  AND e."organizacionId" = r."organizacionId" AND e."id"::text = ev."detalle" ->> 'esperaId'
  AND r."esperaId" IS NULL;
-- relleno:hasta
