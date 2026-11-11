-- Universos de recepción (doc 31, D21): cada categoría de servicios pertenece a Manos y pies (el salón,
-- con y sin turno) o a Tratamientos (con turno previo). Las existentes quedan en Manos y pies.

-- CreateEnum
CREATE TYPE "Universo" AS ENUM ('MANOS_PIES', 'TRATAMIENTOS');

-- AlterTable
ALTER TABLE "CategoriaServicio" ADD COLUMN     "universo" "Universo" NOT NULL DEFAULT 'MANOS_PIES';
