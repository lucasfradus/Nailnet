-- CreateEnum
CREATE TYPE "TipoSena" AS ENUM ('NINGUNA', 'FIJA', 'PORCENTAJE');

-- CreateTable
CREATE TABLE "CategoriaServicio" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CategoriaServicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servicio" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "categoriaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "duracionMinutos" INTEGER NOT NULL,
    "bufferAntesMinutos" INTEGER NOT NULL DEFAULT 0,
    "bufferDespuesMinutos" INTEGER NOT NULL DEFAULT 0,
    "senaTipo" "TipoSena",
    "senaValor" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicioSkill" (
    "organizacionId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "skillId" UUID NOT NULL,

    CONSTRAINT "ServicioSkill_pkey" PRIMARY KEY ("servicioId","skillId")
);

-- CreateTable
CREATE TABLE "TipoRecurso" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "TipoRecurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicioRequisitoRecurso" (
    "organizacionId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "tipoRecursoId" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "ServicioRequisitoRecurso_pkey" PRIMARY KEY ("servicioId","tipoRecursoId")
);

-- CreateTable
CREATE TABLE "ServicioConsentimiento" (
    "organizacionId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "clave" TEXT NOT NULL,

    CONSTRAINT "ServicioConsentimiento_pkey" PRIMARY KEY ("servicioId","clave")
);

-- CreateTable
CREATE TABLE "ServicioSede" (
    "organizacionId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT false,
    "precio" DECIMAL(12,2),
    "duracionMinutos" INTEGER,
    "senaTipo" "TipoSena",
    "senaValor" DECIMAL(12,2),
    "reservableOnline" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioSede_pkey" PRIMARY KEY ("servicioId","sedeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaServicio_organizacionId_id_key" ON "CategoriaServicio"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaServicio_organizacionId_nombre_key" ON "CategoriaServicio"("organizacionId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Servicio_organizacionId_id_key" ON "Servicio"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Servicio_organizacionId_nombre_key" ON "Servicio"("organizacionId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_organizacionId_id_key" ON "Skill"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_organizacionId_nombre_key" ON "Skill"("organizacionId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "TipoRecurso_organizacionId_id_key" ON "TipoRecurso"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TipoRecurso_organizacionId_nombre_key" ON "TipoRecurso"("organizacionId", "nombre");

-- CreateIndex
CREATE INDEX "ServicioSede_organizacionId_sedeId_idx" ON "ServicioSede"("organizacionId", "sedeId");

-- AddForeignKey
ALTER TABLE "CategoriaServicio" ADD CONSTRAINT "CategoriaServicio_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_organizacionId_categoriaId_fkey" FOREIGN KEY ("organizacionId", "categoriaId") REFERENCES "CategoriaServicio"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioSkill" ADD CONSTRAINT "ServicioSkill_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioSkill" ADD CONSTRAINT "ServicioSkill_organizacionId_skillId_fkey" FOREIGN KEY ("organizacionId", "skillId") REFERENCES "Skill"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoRecurso" ADD CONSTRAINT "TipoRecurso_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioRequisitoRecurso" ADD CONSTRAINT "ServicioRequisitoRecurso_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioRequisitoRecurso" ADD CONSTRAINT "ServicioRequisitoRecurso_organizacionId_tipoRecursoId_fkey" FOREIGN KEY ("organizacionId", "tipoRecursoId") REFERENCES "TipoRecurso"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioConsentimiento" ADD CONSTRAINT "ServicioConsentimiento_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioSede" ADD CONSTRAINT "ServicioSede_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioSede" ADD CONSTRAINT "ServicioSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma: mantener en migraciones SQL.
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_duraciones" CHECK (
  "duracionMinutos" BETWEEN 5 AND 480 AND "duracionMinutos" % 5 = 0
  AND "bufferAntesMinutos" BETWEEN 0 AND 120 AND "bufferAntesMinutos" % 5 = 0
  AND "bufferDespuesMinutos" BETWEEN 0 AND 120 AND "bufferDespuesMinutos" % 5 = 0);
ALTER TABLE "ServicioSede" ADD CONSTRAINT "ServicioSede_valores" CHECK (
  ("precio" IS NULL OR "precio" >= 0)
  AND ("duracionMinutos" IS NULL OR ("duracionMinutos" BETWEEN 5 AND 480 AND "duracionMinutos" % 5 = 0))
  AND (NOT "habilitado" OR "precio" IS NOT NULL));
-- Seña coherente (COALESCE: un CHECK que evalúa a NULL se acepta, y valor NULL volvería NULL la comparación): sin tipo no hay valor; NINGUNA sin valor; FIJA > 0; PORCENTAJE entero 1..100.
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_sena" CHECK (COALESCE(
  ("senaTipo" IS NULL AND "senaValor" IS NULL) OR ("senaTipo" = 'NINGUNA' AND "senaValor" IS NULL)
  OR ("senaTipo" = 'FIJA' AND "senaValor" IS NOT NULL AND "senaValor" > 0)
  OR ("senaTipo" = 'PORCENTAJE' AND "senaValor" IS NOT NULL AND "senaValor" BETWEEN 1 AND 100 AND "senaValor" = trunc("senaValor")), false));
ALTER TABLE "ServicioSede" ADD CONSTRAINT "ServicioSede_sena" CHECK (COALESCE(
  ("senaTipo" IS NULL AND "senaValor" IS NULL) OR ("senaTipo" = 'NINGUNA' AND "senaValor" IS NULL)
  OR ("senaTipo" = 'FIJA' AND "senaValor" IS NOT NULL AND "senaValor" > 0)
  OR ("senaTipo" = 'PORCENTAJE' AND "senaValor" IS NOT NULL AND "senaValor" BETWEEN 1 AND 100 AND "senaValor" = trunc("senaValor")), false));
ALTER TABLE "ServicioRequisitoRecurso" ADD CONSTRAINT "ServicioRequisitoRecurso_cantidad" CHECK ("cantidad" BETWEEN 1 AND 10);
