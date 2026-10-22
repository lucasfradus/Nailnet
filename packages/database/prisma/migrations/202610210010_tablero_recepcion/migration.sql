-- Tablero de recepción (doc 29, D20): presencia diaria de las profesionales y comienzo/fin real de la atención.

-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "iniciadaEn" TIMESTAMP(3),
ADD COLUMN     "terminadaEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PresenciaProfesional" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "entrada" TIMESTAMP(3) NOT NULL,
    "salida" TIMESTAMP(3),
    "entradaPorId" UUID NOT NULL,
    "salidaPorId" UUID,

    CONSTRAINT "PresenciaProfesional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PresenciaProfesional_sedeId_entrada_idx" ON "PresenciaProfesional"("sedeId", "entrada");

-- CreateIndex
CREATE INDEX "PresenciaProfesional_profesionalId_entrada_idx" ON "PresenciaProfesional"("profesionalId", "entrada");

-- CreateIndex
CREATE UNIQUE INDEX "PresenciaProfesional_organizacionId_id_key" ON "PresenciaProfesional"("organizacionId", "id");

-- AddForeignKey
ALTER TABLE "PresenciaProfesional" ADD CONSTRAINT "PresenciaProfesional_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenciaProfesional" ADD CONSTRAINT "PresenciaProfesional_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. NULL-safe.
-- Una sola presencia abierta por profesional, en cualquier sede: dos recepcionistas que marcan la entrada
-- a la vez no la duplican.
CREATE UNIQUE INDEX "PresenciaProfesional_abierta_key" ON "PresenciaProfesional"("profesionalId") WHERE "salida" IS NULL;
ALTER TABLE "PresenciaProfesional" ADD CONSTRAINT "PresenciaProfesional_intervalo" CHECK (
  ("salida" IS NULL) = ("salidaPorId" IS NULL) AND ("salida" IS NULL OR "salida" >= "entrada"));
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_atencion" CHECK (
  "terminadaEn" IS NULL OR "iniciadaEn" IS NULL OR "terminadaEn" >= "iniciadaEn");

-- Atenciones sin turno previo ya registradas: empezaron con su primer servicio.
UPDATE "Reserva" r SET "iniciadaEn" = (SELECT min(ri."inicio") FROM "ReservaItem" ri WHERE ri."reservaId" = r."id")
WHERE r."sinTurnoPrevio" AND r."iniciadaEn" IS NULL;
