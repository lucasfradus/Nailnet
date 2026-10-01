-- CreateEnum
CREATE TYPE "TipoEventoReserva" AS ENUM ('CREADA', 'CONFIRMADA', 'EXPIRADA', 'CANCELADA', 'REPROGRAMADA', 'ATENDIDA', 'AUSENTE');

-- AlterTable
ALTER TABLE "ConfiguracionOrganizacion" ADD COLUMN     "recepcionExigeSena" BOOLEAN;

-- AlterTable
ALTER TABLE "ConfiguracionSede" ADD COLUMN     "recepcionExigeSena" BOOLEAN;

-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "notas" TEXT;

-- CreateTable
CREATE TABLE "ReservaEvento" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "tipo" "TipoEventoReserva" NOT NULL,
    "estadoAnterior" "EstadoReserva",
    "estadoNuevo" "EstadoReserva" NOT NULL,
    "actorId" UUID,
    "detalle" JSONB,
    "orden" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservaEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservaEvento_reservaId_orden_idx" ON "ReservaEvento"("reservaId", "orden");

-- AddForeignKey
ALTER TABLE "ReservaEvento" ADD CONSTRAINT "ReservaEvento_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- El historial es evidencia: solo inserción (función creada en 202610010003_clientes).
CREATE TRIGGER "ReservaEvento_inmutable" BEFORE UPDATE OR DELETE ON "ReservaEvento" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_notas" CHECK ("notas" IS NULL OR length("notas") <= 1000);
