-- CreateEnum
CREATE TYPE "UnidadMedida" AS ENUM ('UNIDAD', 'MILILITRO', 'LITRO', 'GRAMO', 'KILOGRAMO');

-- CreateEnum
CREATE TYPE "TipoMovimientoStock" AS ENUM ('COMPRA', 'CONSUMO_INTERNO', 'AJUSTE', 'VENTA', 'TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA', 'REVERSO');

-- CreateTable
CREATE TABLE "Producto" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "sku" TEXT,
    "unidad" "UnidadMedida" NOT NULL,
    "vendible" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductoSede" (
    "organizacionId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "precio" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductoSede_pkey" PRIMARY KEY ("productoId","sedeId")
);

-- CreateTable
CREATE TABLE "StockSede" (
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSede_pkey" PRIMARY KEY ("sedeId","productoId")
);

-- CreateTable
CREATE TABLE "MovimientoStock" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "tipo" "TipoMovimientoStock" NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "saldoResultante" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT,
    "compraItemId" UUID,
    "transferenciaId" UUID,
    "ventaId" UUID,
    "revierteId" UUID,
    "actorId" UUID NOT NULL,
    "orden" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compra" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "proveedor" TEXT NOT NULL,
    "comprobante" TEXT,
    "fecha" DATE NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraItem" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "compraId" UUID NOT NULL,
    "posicion" INTEGER NOT NULL,
    "productoId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "costoUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CompraItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Producto_organizacionId_id_key" ON "Producto"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_organizacionId_nombre_key" ON "Producto"("organizacionId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_organizacionId_sku_key" ON "Producto"("organizacionId", "sku");

-- CreateIndex
CREATE INDEX "ProductoSede_organizacionId_sedeId_idx" ON "ProductoSede"("organizacionId", "sedeId");

-- CreateIndex
CREATE INDEX "StockSede_organizacionId_productoId_idx" ON "StockSede"("organizacionId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoStock_revierteId_key" ON "MovimientoStock"("revierteId");

-- CreateIndex
CREATE INDEX "MovimientoStock_organizacionId_sedeId_productoId_orden_idx" ON "MovimientoStock"("organizacionId", "sedeId", "productoId", "orden");

-- CreateIndex
CREATE INDEX "MovimientoStock_transferenciaId_idx" ON "MovimientoStock"("transferenciaId");

-- CreateIndex
CREATE INDEX "MovimientoStock_ventaId_idx" ON "MovimientoStock"("ventaId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoStock_organizacionId_compraItemId_key" ON "MovimientoStock"("organizacionId", "compraItemId");

-- CreateIndex
CREATE INDEX "Compra_organizacionId_sedeId_fecha_idx" ON "Compra"("organizacionId", "sedeId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_organizacionId_id_key" ON "Compra"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompraItem_organizacionId_id_key" ON "CompraItem"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompraItem_compraId_posicion_key" ON "CompraItem"("compraId", "posicion");

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductoSede" ADD CONSTRAINT "ProductoSede_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES "Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductoSede" ADD CONSTRAINT "ProductoSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSede" ADD CONSTRAINT "StockSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSede" ADD CONSTRAINT "StockSede_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES "Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES "Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_compraItemId_fkey" FOREIGN KEY ("organizacionId", "compraItemId") REFERENCES "CompraItem"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_revierteId_fkey" FOREIGN KEY ("revierteId") REFERENCES "MovimientoStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_organizacionId_compraId_fkey" FOREIGN KEY ("organizacionId", "compraId") REFERENCES "Compra"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES "Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Reglas de stock en la base (segunda defensa; la primera es el lock de fila en src/stock.ts) ───

-- El saldo nunca es negativo: aunque una escritura esquive la aplicación, la base la rechaza.
ALTER TABLE "StockSede" ADD CONSTRAINT "StockSede_no_negativo" CHECK ("cantidad" >= 0);

-- Ningún movimiento en cero; el saldo que deja tampoco es negativo.
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_cantidad" CHECK ("cantidad" <> 0 AND "saldoResultante" >= 0);
-- Signo según el tipo: ingresos positivos, egresos negativos; ajuste y reverso en cualquier sentido.
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_signo" CHECK (CASE "tipo"
  WHEN 'COMPRA' THEN "cantidad" > 0
  WHEN 'TRANSFERENCIA_ENTRADA' THEN "cantidad" > 0
  WHEN 'CONSUMO_INTERNO' THEN "cantidad" < 0
  WHEN 'VENTA' THEN "cantidad" < 0
  WHEN 'TRANSFERENCIA_SALIDA' THEN "cantidad" < 0
  ELSE true END);
-- Cada tipo con su origen: la compra con su ítem, el reverso con el original, la transferencia con su id.
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_origen" CHECK (
  ("tipo" = 'COMPRA') = ("compraItemId" IS NOT NULL)
  AND ("tipo" = 'REVERSO') = ("revierteId" IS NOT NULL)
  AND ("tipo" IN ('TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA')) = ("transferenciaId" IS NOT NULL)
  AND ("ventaId" IS NULL OR "tipo" = 'VENTA')
  AND ("tipo" NOT IN ('AJUSTE', 'REVERSO') OR "motivo" IS NOT NULL));
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_motivo" CHECK ("motivo" IS NULL OR length("motivo") BETWEEN 1 AND 300);

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_textos" CHECK (length("nombre") BETWEEN 1 AND 120 AND ("sku" IS NULL OR length("sku") BETWEEN 1 AND 40));
ALTER TABLE "ProductoSede" ADD CONSTRAINT "ProductoSede_precio" CHECK ("precio" IS NULL OR "precio" > 0);
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_valores" CHECK ("total" >= 0 AND length("proveedor") BETWEEN 1 AND 120 AND ("comprobante" IS NULL OR length("comprobante") BETWEEN 1 AND 60));
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_valores" CHECK ("cantidad" > 0 AND "costoUnitario" >= 0 AND "subtotal" >= 0 AND "posicion" >= 0);

-- Movimientos y compras son evidencia: solo inserción (función creada en 202610010003_clientes).
-- Un error se corrige con un movimiento REVERSO, nunca editando ni borrando.
CREATE TRIGGER "MovimientoStock_inmutable" BEFORE UPDATE OR DELETE ON "MovimientoStock" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
CREATE TRIGGER "Compra_inmutable" BEFORE UPDATE OR DELETE ON "Compra" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
CREATE TRIGGER "CompraItem_inmutable" BEFORE UPDATE OR DELETE ON "CompraItem" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
