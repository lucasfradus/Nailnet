-- Tablero de recepción, etapa 3 (doc 29): lista de espera de clientas sin turno cuando no hay nadie libre.

-- CreateEnum
CREATE TYPE "EstadoEspera" AS ENUM ('ESPERANDO', 'ATENDIDA', 'SE_FUE');

-- CreateTable
CREATE TABLE "EsperaRecepcion" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "servicioIds" UUID[],
    "profesionalId" UUID,
    "notas" TEXT,
    "llegada" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoEspera" NOT NULL,
    "cerradaEn" TIMESTAMP(3),
    "reservaId" UUID,
    "registradaPorId" UUID NOT NULL,
    "cerradaPorId" UUID,

    CONSTRAINT "EsperaRecepcion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EsperaRecepcion_sedeId_estado_llegada_idx" ON "EsperaRecepcion"("sedeId", "estado", "llegada");

-- CreateIndex
CREATE UNIQUE INDEX "EsperaRecepcion_organizacionId_id_key" ON "EsperaRecepcion"("organizacionId", "id");

-- AddForeignKey
ALTER TABLE "EsperaRecepcion" ADD CONSTRAINT "EsperaRecepcion_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsperaRecepcion" ADD CONSTRAINT "EsperaRecepcion_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsperaRecepcion" ADD CONSTRAINT "EsperaRecepcion_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. COALESCE: un CHECK que evalúa a NULL se acepta.
-- Esperando = abierta; cerrada = con fecha y quién; atendida = con su turno. Entre 1 y 3 servicios.
ALTER TABLE "EsperaRecepcion" ADD CONSTRAINT "EsperaRecepcion_forma" CHECK (COALESCE(
  length(btrim("nombre")) BETWEEN 1 AND 80
  AND cardinality("servicioIds") BETWEEN 1 AND 3
  AND (("estado" = 'ESPERANDO') = ("cerradaEn" IS NULL))
  AND (("cerradaEn" IS NULL) = ("cerradaPorId" IS NULL))
  AND (("estado" = 'ATENDIDA') = ("reservaId" IS NOT NULL))
  AND ("cerradaEn" IS NULL OR "cerradaEn" >= "llegada"), false));
