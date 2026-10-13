-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('EN_PROCESO', 'APROBADO', 'RECHAZADO', 'A_DEVOLVER', 'REEMBOLSADO');

-- CreateTable
CREATE TABLE "CheckoutPago" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "proveedor" "Proveedor" NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "preferenciaId" TEXT,
    "url" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "checkoutId" UUID NOT NULL,
    "proveedor" "Proveedor" NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "externoId" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL,
    "estado" "EstadoPago" NOT NULL,
    "estadoExterno" TEXT NOT NULL,
    "detalleExterno" TEXT,
    "motivo" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutPago_reservaId_idx" ON "CheckoutPago"("reservaId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutPago_organizacionId_id_key" ON "CheckoutPago"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "Pago_reservaId_idx" ON "Pago"("reservaId");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_proveedor_ambiente_externoId_key" ON "Pago"("proveedor", "ambiente", "externoId");

-- AddForeignKey
ALTER TABLE "CheckoutPago" ADD CONSTRAINT "CheckoutPago_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_organizacionId_checkoutId_fkey" FOREIGN KEY ("organizacionId", "checkoutId") REFERENCES "CheckoutPago"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas no expresables en schema.prisma.
ALTER TABLE "CheckoutPago" ADD CONSTRAINT "CheckoutPago_monto_positivo" CHECK ("monto" > 0);
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_monto_no_negativo" CHECK ("monto" >= 0);
-- Un pago aprobado (aplicado o a devolver) siempre registra cuándo se aprobó.
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_aprobado_con_fecha" CHECK ("estado" NOT IN ('APROBADO', 'A_DEVOLVER') OR "aprobadoEn" IS NOT NULL);
-- Como mucho un pago aplicado por reserva: un segundo pago aprobado queda A_DEVOLVER.
CREATE UNIQUE INDEX "Pago_un_aprobado_por_reserva" ON "Pago"("reservaId") WHERE "estado" = 'APROBADO';
