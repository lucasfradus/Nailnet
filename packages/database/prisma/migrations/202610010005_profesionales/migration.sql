-- CreateTable
CREATE TABLE "Profesional" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT,
    "usuarioId" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfesionalSede" (
    "organizacionId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProfesionalSede_pkey" PRIMARY KEY ("profesionalId","sedeId")
);

-- CreateTable
CREATE TABLE "ProfesionalSkill" (
    "organizacionId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "skillId" UUID NOT NULL,

    CONSTRAINT "ProfesionalSkill_pkey" PRIMARY KEY ("profesionalId","skillId")
);

-- CreateTable
CREATE TABLE "ProfesionalServicio" (
    "organizacionId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,

    CONSTRAINT "ProfesionalServicio_pkey" PRIMARY KEY ("profesionalId","servicioId")
);

-- CreateTable
CREATE TABLE "HorarioSede" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "inicioMinutos" INTEGER NOT NULL,
    "finMinutos" INTEGER NOT NULL,
    "vigenteDesde" DATE,
    "vigenteHasta" DATE,

    CONSTRAINT "HorarioSede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioProfesional" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "inicioMinutos" INTEGER NOT NULL,
    "finMinutos" INTEGER NOT NULL,
    "vigenteDesde" DATE,
    "vigenteHasta" DATE,

    CONSTRAINT "HorarioProfesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcepcionHorario" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID,
    "fecha" DATE NOT NULL,
    "cerrado" BOOLEAN NOT NULL,
    "inicioMinutos" INTEGER,
    "finMinutos" INTEGER,
    "motivo" TEXT,

    CONSTRAINT "ExcepcionHorario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloqueoAgenda" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "creadoPor" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloqueoAgenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recurso" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "tipoRecursoId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Recurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloqueoRecurso" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "recursoId" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,

    CONSTRAINT "BloqueoRecurso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profesional_organizacionId_id_key" ON "Profesional"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Profesional_organizacionId_usuarioId_key" ON "Profesional"("organizacionId", "usuarioId");

-- CreateIndex
CREATE INDEX "ProfesionalSede_organizacionId_sedeId_idx" ON "ProfesionalSede"("organizacionId", "sedeId");

-- CreateIndex
CREATE INDEX "HorarioSede_sedeId_diaSemana_idx" ON "HorarioSede"("sedeId", "diaSemana");

-- CreateIndex
CREATE INDEX "HorarioProfesional_profesionalId_diaSemana_idx" ON "HorarioProfesional"("profesionalId", "diaSemana");

-- CreateIndex
CREATE INDEX "HorarioProfesional_sedeId_diaSemana_idx" ON "HorarioProfesional"("sedeId", "diaSemana");

-- CreateIndex
CREATE INDEX "ExcepcionHorario_organizacionId_fecha_idx" ON "ExcepcionHorario"("organizacionId", "fecha");

-- CreateIndex
CREATE INDEX "BloqueoAgenda_profesionalId_inicio_idx" ON "BloqueoAgenda"("profesionalId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "Recurso_organizacionId_id_key" ON "Recurso"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Recurso_sedeId_nombre_key" ON "Recurso"("sedeId", "nombre");

-- CreateIndex
CREATE INDEX "BloqueoRecurso_recursoId_inicio_idx" ON "BloqueoRecurso"("recursoId", "inicio");

-- AddForeignKey
ALTER TABLE "Profesional" ADD CONSTRAINT "Profesional_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesionalSede" ADD CONSTRAINT "ProfesionalSede_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesionalSede" ADD CONSTRAINT "ProfesionalSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesionalSkill" ADD CONSTRAINT "ProfesionalSkill_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesionalSkill" ADD CONSTRAINT "ProfesionalSkill_organizacionId_skillId_fkey" FOREIGN KEY ("organizacionId", "skillId") REFERENCES "Skill"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesionalServicio" ADD CONSTRAINT "ProfesionalServicio_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesionalServicio" ADD CONSTRAINT "ProfesionalServicio_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioSede" ADD CONSTRAINT "HorarioSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioProfesional" ADD CONSTRAINT "HorarioProfesional_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioProfesional" ADD CONSTRAINT "HorarioProfesional_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcepcionHorario" ADD CONSTRAINT "ExcepcionHorario_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcepcionHorario" ADD CONSTRAINT "ExcepcionHorario_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloqueoAgenda" ADD CONSTRAINT "BloqueoAgenda_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recurso" ADD CONSTRAINT "Recurso_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recurso" ADD CONSTRAINT "Recurso_organizacionId_tipoRecursoId_fkey" FOREIGN KEY ("organizacionId", "tipoRecursoId") REFERENCES "TipoRecurso"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloqueoRecurso" ADD CONSTRAINT "BloqueoRecurso_organizacionId_recursoId_fkey" FOREIGN KEY ("organizacionId", "recursoId") REFERENCES "Recurso"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. Todas NULL-safe: un CHECK que evalúa a NULL se acepta.
ALTER TABLE "HorarioSede" ADD CONSTRAINT "HorarioSede_rango" CHECK (
  "diaSemana" BETWEEN 0 AND 6 AND "inicioMinutos" >= 0 AND "finMinutos" <= 1440 AND "inicioMinutos" < "finMinutos"
  AND "inicioMinutos" % 5 = 0 AND "finMinutos" % 5 = 0
  AND ("vigenteDesde" IS NULL OR "vigenteHasta" IS NULL OR "vigenteDesde" <= "vigenteHasta"));
ALTER TABLE "HorarioProfesional" ADD CONSTRAINT "HorarioProfesional_rango" CHECK (
  "diaSemana" BETWEEN 0 AND 6 AND "inicioMinutos" >= 0 AND "finMinutos" <= 1440 AND "inicioMinutos" < "finMinutos"
  AND "inicioMinutos" % 5 = 0 AND "finMinutos" % 5 = 0
  AND ("vigenteDesde" IS NULL OR "vigenteHasta" IS NULL OR "vigenteDesde" <= "vigenteHasta"));
ALTER TABLE "ExcepcionHorario" ADD CONSTRAINT "ExcepcionHorario_forma" CHECK (COALESCE(
  ("cerrado" AND "inicioMinutos" IS NULL AND "finMinutos" IS NULL)
  OR (NOT "cerrado" AND "inicioMinutos" IS NOT NULL AND "finMinutos" IS NOT NULL AND "inicioMinutos" >= 0
      AND "finMinutos" <= 1440 AND "inicioMinutos" < "finMinutos" AND "inicioMinutos" % 5 = 0 AND "finMinutos" % 5 = 0), false));
ALTER TABLE "BloqueoAgenda" ADD CONSTRAINT "BloqueoAgenda_intervalo" CHECK ("fin" > "inicio");
ALTER TABLE "BloqueoRecurso" ADD CONSTRAINT "BloqueoRecurso_intervalo" CHECK ("fin" > "inicio");
