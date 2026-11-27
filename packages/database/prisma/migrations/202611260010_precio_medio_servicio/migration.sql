-- Precio fijo de un servicio por medio de pago (D22, doc 32, «Precio fijo por servicio»; pedido el 2026-11-26).
-- Para los servicios cuyo precio en efectivo no sale de un porcentaje parejo (lista de tratamientos de
-- Sicurella): el precio fijo reemplaza la lista con el ajuste del medio y se cobra tal cual, sin redondeo.

-- CreateTable
CREATE TABLE "ServicioSedePrecioMedio" (
    "organizacionId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "medioPagoId" UUID NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioSedePrecioMedio_pkey" PRIMARY KEY ("servicioId","sedeId","medioPagoId")
);

-- CreateIndex
CREATE INDEX "ServicioSedePrecioMedio_organizacionId_sedeId_idx" ON "ServicioSedePrecioMedio"("organizacionId", "sedeId");

-- CreateIndex
CREATE INDEX "ServicioSedePrecioMedio_medioPagoId_idx" ON "ServicioSedePrecioMedio"("medioPagoId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioSede_organizacionId_servicioId_sedeId_key" ON "ServicioSede"("organizacionId", "servicioId", "sedeId");

-- AddForeignKey
ALTER TABLE "ServicioSedePrecioMedio" ADD CONSTRAINT "ServicioSedePrecioMedio_organizacionId_servicioId_sedeId_fkey" FOREIGN KEY ("organizacionId", "servicioId", "sedeId") REFERENCES "ServicioSede"("organizacionId", "servicioId", "sedeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioSedePrecioMedio" ADD CONSTRAINT "ServicioSedePrecioMedio_organizacionId_sedeId_medioPagoId_fkey" FOREIGN KEY ("organizacionId", "sedeId", "medioPagoId") REFERENCES "MedioPagoSede"("organizacionId", "sedeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas no expresables en schema.prisma. COALESCE: un CHECK que evalúa a NULL se rechaza.
ALTER TABLE "ServicioSedePrecioMedio" ADD CONSTRAINT "ServicioSedePrecioMedio_precio" CHECK (COALESCE("precio" > 0, false));
