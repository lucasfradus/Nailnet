-- Universos de recepción, etapa 2 (doc 31): sentar desde el tablero a una clienta en espera, con su ficha o
-- con solo el nombre. La espera puede traer la ficha elegida al anotarla; el turno de una clienta sin ficha
-- guarda el nombre provisional hasta que recepción le asigna la ficha.

-- AlterTable
ALTER TABLE "EsperaRecepcion" ADD COLUMN     "clienteId" UUID;

-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "clienteProvisional" TEXT;

-- AddForeignKey
ALTER TABLE "EsperaRecepcion" ADD CONSTRAINT "EsperaRecepcion_organizacionId_clienteId_fkey" FOREIGN KEY ("organizacionId", "clienteId") REFERENCES "Cliente"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. COALESCE: un CHECK que evalúa a NULL se acepta.
-- El nombre provisional es solo para un turno sin cliente, y con el mismo largo que el nombre de la espera.
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_cliente_provisional" CHECK (COALESCE(
  "clienteProvisional" IS NULL
  OR ("clienteId" IS NULL AND length(btrim("clienteProvisional")) BETWEEN 1 AND 80), false));
