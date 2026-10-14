-- CreateEnum
CREATE TYPE "FuenteIncidencia" AS ENUM ('TRABAJO', 'PAGO', 'EMAIL');

-- CreateEnum
CREATE TYPE "TipoAccionIncidencia" AS ENUM ('REVISADA', 'RESUELTA', 'REABIERTA', 'REINTENTADA', 'DEVOLUCION_GESTIONADA');

-- CreateTable
CREATE TABLE "AccionIncidencia" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "fuente" "FuenteIncidencia" NOT NULL,
    "entidadId" UUID NOT NULL,
    "incidencia" TEXT NOT NULL,
    "sedeId" UUID,
    "accion" "TipoAccionIncidencia" NOT NULL,
    "nota" TEXT NOT NULL,
    "estadoFuente" TEXT NOT NULL,
    "marcaFuente" TIMESTAMP(3) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccionIncidencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccionIncidencia_fuente_entidadId_createdAt_idx" ON "AccionIncidencia"("fuente", "entidadId", "createdAt");

-- CreateIndex
CREATE INDEX "AccionIncidencia_organizacionId_createdAt_idx" ON "AccionIncidencia"("organizacionId", "createdAt");


-- ─── Reglas en la base (segunda defensa; la primera es src/incidencias.ts) ───

-- La nota es obligatoria y acotada: es lo que explica la acción a quien la lea después.
ALTER TABLE "AccionIncidencia" ADD CONSTRAINT "AccionIncidencia_nota" CHECK (length(btrim("nota")) BETWEEN 5 AND 1000);
ALTER TABLE "AccionIncidencia" ADD CONSTRAINT "AccionIncidencia_textos" CHECK ("incidencia" ~ '^[A-Z][A-Z_]{2,59}$' AND length("estadoFuente") BETWEEN 1 AND 40);
-- Reintentar es solo para trabajos; gestionar una devolución, solo para pagos.
ALTER TABLE "AccionIncidencia" ADD CONSTRAINT "AccionIncidencia_accion_fuente" CHECK (
  ("accion" <> 'REINTENTADA' OR "fuente" = 'TRABAJO') AND ("accion" <> 'DEVOLUCION_GESTIONADA' OR "fuente" = 'PAGO'));

-- Es auditoría: nada se edita ni se borra (función creada en 202610010003_clientes).
CREATE TRIGGER "AccionIncidencia_inmutable" BEFORE UPDATE OR DELETE ON "AccionIncidencia" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
