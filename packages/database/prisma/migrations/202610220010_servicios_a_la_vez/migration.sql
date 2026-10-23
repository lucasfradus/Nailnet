-- Tablero de recepción, etapa 2 (doc 29): servicios a la vez con varias profesionales y «Terminó» por
-- profesional. Cada ítem guarda cuándo terminó su profesional; el turno pasa a atendido cuando terminaron todas.

-- AlterTable
ALTER TABLE "ReservaItem" ADD COLUMN     "terminadoEn" TIMESTAMP(3);

-- Atenciones ya terminadas con «Terminó» (etapa 1): todos sus ítems terminaron con el turno.
UPDATE "ReservaItem" ri SET "terminadoEn" = r."terminadaEn"
FROM "Reserva" r
WHERE ri."reservaId" = r."id" AND r."terminadaEn" IS NOT NULL AND ri."terminadoEn" IS NULL;
