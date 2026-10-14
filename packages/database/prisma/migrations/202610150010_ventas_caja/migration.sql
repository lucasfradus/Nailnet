-- CreateEnum
CREATE TYPE "MedioCobro" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'MERCADO_PAGO', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('PENDIENTE', 'COMPLETADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "TipoItemVenta" AS ENUM ('SERVICIO', 'PRODUCTO');

-- CreateEnum
CREATE TYPE "TipoCobro" AS ENUM ('COBRO', 'REVERSO');

-- CreateEnum
CREATE TYPE "EstadoCaja" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('INGRESO_COBRO', 'EGRESO_GASTO', 'ENTRADA', 'SALIDA', 'REVERSO');

-- CreateTable
CREATE TABLE "Venta" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "reservaId" UUID,
    "fecha" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "anticipo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pagoAnticipoId" UUID,
    "estado" "EstadoVenta" NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "registradoPorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completadaEn" TIMESTAMP(3),
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorId" UUID,
    "motivoAnulacion" TEXT,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaItem" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "posicion" INTEGER NOT NULL,
    "tipo" "TipoItemVenta" NOT NULL,
    "reservaItemId" UUID,
    "productoId" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "VentaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CobroVenta" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "tipo" "TipoCobro" NOT NULL,
    "medio" "MedioCobro" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referencia" TEXT,
    "cajaId" UUID,
    "revierteId" UUID,
    "motivo" TEXT,
    "claveIdempotencia" TEXT,
    "registradoPorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CobroVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caja" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "estado" "EstadoCaja" NOT NULL,
    "montoInicial" DECIMAL(12,2) NOT NULL,
    "abiertaPorId" UUID NOT NULL,
    "abiertaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaPorId" UUID,
    "cerradaEn" TIMESTAMP(3),
    "esperado" DECIMAL(12,2),
    "contado" DECIMAL(12,2),
    "diferencia" DECIMAL(12,2),
    "observaciones" TEXT,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "cajaId" UUID NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "cobroId" UUID,
    "gastoId" UUID,
    "revierteId" UUID,
    "registradoPorId" UUID NOT NULL,
    "orden" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Venta_sedeId_fecha_idx" ON "Venta"("sedeId", "fecha");

-- CreateIndex
CREATE INDEX "Venta_reservaId_idx" ON "Venta"("reservaId");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_organizacionId_id_key" ON "Venta"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_organizacionId_claveIdempotencia_key" ON "Venta"("organizacionId", "claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "VentaItem_ventaId_posicion_key" ON "VentaItem"("ventaId", "posicion");

-- CreateIndex
CREATE INDEX "CobroVenta_ventaId_idx" ON "CobroVenta"("ventaId");

-- CreateIndex
CREATE INDEX "CobroVenta_cajaId_idx" ON "CobroVenta"("cajaId");

-- CreateIndex
CREATE INDEX "CobroVenta_sedeId_createdAt_idx" ON "CobroVenta"("sedeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CobroVenta_organizacionId_id_key" ON "CobroVenta"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CobroVenta_organizacionId_revierteId_key" ON "CobroVenta"("organizacionId", "revierteId");

-- CreateIndex
CREATE UNIQUE INDEX "CobroVenta_organizacionId_claveIdempotencia_key" ON "CobroVenta"("organizacionId", "claveIdempotencia");

-- CreateIndex
CREATE INDEX "Caja_sedeId_abiertaEn_idx" ON "Caja"("sedeId", "abiertaEn");

-- CreateIndex
CREATE UNIQUE INDEX "Caja_organizacionId_id_key" ON "Caja"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "MovimientoCaja_cajaId_orden_idx" ON "MovimientoCaja"("cajaId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_organizacionId_id_key" ON "MovimientoCaja"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_organizacionId_cobroId_key" ON "MovimientoCaja"("organizacionId", "cobroId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_organizacionId_gastoId_key" ON "MovimientoCaja"("organizacionId", "gastoId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_organizacionId_revierteId_key" ON "MovimientoCaja"("organizacionId", "revierteId");

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_ventaId_fkey" FOREIGN KEY ("organizacionId", "ventaId") REFERENCES "Venta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_organizacionId_reservaId_fkey" FOREIGN KEY ("organizacionId", "reservaId") REFERENCES "Reserva"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_pagoAnticipoId_fkey" FOREIGN KEY ("pagoAnticipoId") REFERENCES "Pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_organizacionId_ventaId_fkey" FOREIGN KEY ("organizacionId", "ventaId") REFERENCES "Venta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_organizacionId_reservaItemId_fkey" FOREIGN KEY ("organizacionId", "reservaItemId") REFERENCES "ReservaItem"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES "Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_organizacionId_ventaId_fkey" FOREIGN KEY ("organizacionId", "ventaId") REFERENCES "Venta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_organizacionId_cajaId_fkey" FOREIGN KEY ("organizacionId", "cajaId") REFERENCES "Caja"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_organizacionId_revierteId_fkey" FOREIGN KEY ("organizacionId", "revierteId") REFERENCES "CobroVenta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_organizacionId_cajaId_fkey" FOREIGN KEY ("organizacionId", "cajaId") REFERENCES "Caja"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_organizacionId_cobroId_fkey" FOREIGN KEY ("organizacionId", "cobroId") REFERENCES "CobroVenta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_organizacionId_gastoId_fkey" FOREIGN KEY ("organizacionId", "gastoId") REFERENCES "Gasto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_organizacionId_revierteId_fkey" FOREIGN KEY ("organizacionId", "revierteId") REFERENCES "MovimientoCaja"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Reglas de ventas y caja en la base (segunda defensa; la primera es src/ventas.ts y src/caja.ts) ───
-- Los CHECK usan COALESCE(…, false): un CHECK que evalúa a NULL se aceptaría.

-- Venta: total = subtotal − descuento; el anticipo cubre parte del total y siempre tiene su pago.
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_importes" CHECK (COALESCE(
  "subtotal" >= 0 AND "descuento" >= 0 AND "descuento" <= "subtotal" AND "total" = "subtotal" - "descuento"
  AND "anticipo" >= 0 AND "anticipo" <= "total" AND ("anticipo" > 0) = ("pagoAnticipoId" IS NOT NULL), false));
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_estado" CHECK (COALESCE(
  ("estado" = 'PENDIENTE' AND "completadaEn" IS NULL AND "anuladaEn" IS NULL AND "anuladaPorId" IS NULL AND "motivoAnulacion" IS NULL)
  OR ("estado" = 'COMPLETADA' AND "completadaEn" IS NOT NULL AND "anuladaEn" IS NULL AND "anuladaPorId" IS NULL AND "motivoAnulacion" IS NULL)
  OR ("estado" = 'ANULADA' AND "anuladaEn" IS NOT NULL AND "anuladaPorId" IS NOT NULL AND length(btrim("motivoAnulacion")) BETWEEN 5 AND 500), false));
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clave" CHECK (length("claveIdempotencia") BETWEEN 16 AND 64);

-- Un turno se cobra en una sola venta vigente y una seña se aplica una sola vez (sin doble ingreso).
-- Anular la venta libera ambos para volver a cobrar.
CREATE UNIQUE INDEX "Venta_reserva_vigente" ON "Venta"("reservaId") WHERE "reservaId" IS NOT NULL AND "estado" <> 'ANULADA';
CREATE UNIQUE INDEX "Venta_anticipo_vigente" ON "Venta"("pagoAnticipoId") WHERE "pagoAnticipoId" IS NOT NULL AND "estado" <> 'ANULADA';

-- Alta: nace PENDIENTE (los cobros se insertan después y la venta se completa con una transición);
-- la reserva es de la misma sede; el anticipo es exactamente un pago APROBADO de esa sede.
CREATE FUNCTION "venta_alta"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pago RECORD;
BEGIN
  IF NEW."estado" <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'Una venta nace pendiente';
  END IF;
  IF NEW."reservaId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Reserva" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."reservaId" AND "sedeId" = NEW."sedeId") THEN
    RAISE EXCEPTION 'La reserva es de otra sede';
  END IF;
  IF NEW."pagoAnticipoId" IS NOT NULL THEN
    SELECT * INTO pago FROM "Pago" WHERE "id" = NEW."pagoAnticipoId";
    IF NOT FOUND OR pago."organizacionId" <> NEW."organizacionId" OR pago."sedeId" <> NEW."sedeId" OR pago."estado" <> 'APROBADO' OR pago."monto" <> NEW."anticipo" THEN
      RAISE EXCEPTION 'El anticipo no corresponde a un pago aprobado de la sede';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Venta_alta" BEFORE INSERT ON "Venta" FOR EACH ROW EXECUTE FUNCTION "venta_alta"();

-- Cambios: una venta no se borra ni se editan sus datos. Solo avanza el estado
-- (PENDIENTE → COMPLETADA, PENDIENTE/COMPLETADA → ANULADA), y COMPLETADA exige anticipo + cobros = total.
CREATE FUNCTION "venta_transicion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cobrado NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una venta no se borra: se anula (solo inserción)';
  END IF;
  IF (NEW."id", NEW."organizacionId", NEW."sedeId", NEW."reservaId", NEW."fecha", NEW."subtotal", NEW."descuento", NEW."total", NEW."anticipo",
      NEW."pagoAnticipoId", NEW."claveIdempotencia", NEW."registradoPorId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."organizacionId", OLD."sedeId", OLD."reservaId", OLD."fecha", OLD."subtotal", OLD."descuento", OLD."total", OLD."anticipo",
      OLD."pagoAnticipoId", OLD."claveIdempotencia", OLD."registradoPorId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Los datos de una venta no se editan (solo inserción)';
  END IF;
  IF NOT ((OLD."estado" = 'PENDIENTE' AND NEW."estado" IN ('COMPLETADA', 'ANULADA')) OR (OLD."estado" = 'COMPLETADA' AND NEW."estado" = 'ANULADA')) THEN
    RAISE EXCEPTION 'Transición de venta inválida: % → %', OLD."estado", NEW."estado";
  END IF;
  IF OLD."completadaEn" IS NOT NULL AND NEW."completadaEn" IS DISTINCT FROM OLD."completadaEn" THEN
    RAISE EXCEPTION 'La fecha de completada no cambia';
  END IF;
  IF NEW."estado" = 'COMPLETADA' THEN
    SELECT COALESCE(sum("monto"), 0) INTO cobrado FROM "CobroVenta" WHERE "organizacionId" = NEW."organizacionId" AND "ventaId" = NEW."id";
    IF NEW."anticipo" + cobrado <> NEW."total" THEN
      RAISE EXCEPTION 'La venta no está cobrada por completo';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Venta_transicion" BEFORE UPDATE OR DELETE ON "Venta" FOR EACH ROW EXECUTE FUNCTION "venta_transicion"();

-- Ítems: servicio con su ítem de reserva (cantidad 1) o producto con cantidad positiva. Inmutables.
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_forma" CHECK (COALESCE(
  (("tipo" = 'SERVICIO' AND "reservaItemId" IS NOT NULL AND "productoId" IS NULL AND "cantidad" = 1)
    OR ("tipo" = 'PRODUCTO' AND "productoId" IS NOT NULL AND "reservaItemId" IS NULL AND "cantidad" > 0))
  AND "precioUnitario" >= 0 AND "subtotal" >= 0 AND "posicion" >= 0 AND length(btrim("descripcion")) BETWEEN 1 AND 300, false));
CREATE TRIGGER "VentaItem_inmutable" BEFORE UPDATE OR DELETE ON "VentaItem" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();

-- Cobros: positivo y sin motivo; su reverso, negativo y con motivo. El efectivo siempre pasa por una caja.
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_forma" CHECK (COALESCE(
  ("tipo" = 'COBRO' AND "monto" > 0 AND "revierteId" IS NULL AND "motivo" IS NULL)
  OR ("tipo" = 'REVERSO' AND "monto" < 0 AND "revierteId" IS NOT NULL AND length(btrim("motivo")) BETWEEN 5 AND 500), false));
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_efectivo_en_caja" CHECK ("medio" <> 'EFECTIVO' OR "cajaId" IS NOT NULL);
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_textos" CHECK (
  ("referencia" IS NULL OR length("referencia") <= 120) AND ("claveIdempotencia" IS NULL OR length("claveIdempotencia") BETWEEN 16 AND 64));
CREATE TRIGGER "CobroVenta_inmutable" BEFORE UPDATE OR DELETE ON "CobroVenta" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();

-- Coherencia del cobro. Bloquea la fila de la venta (FOR UPDATE): dos cobros simultáneos sobre la
-- misma venta se serializan aquí también, y el segundo ve la suma que dejó el primero. Nunca se cobra
-- de más: anticipo + cobros ≤ total. El reverso copia medio y venta, niega el monto y no repite.
CREATE FUNCTION "cobro_coherente"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  venta RECORD;
  original RECORD;
  cobrado NUMERIC;
BEGIN
  SELECT * INTO venta FROM "Venta" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."ventaId" FOR UPDATE;
  IF NOT FOUND OR venta."sedeId" <> NEW."sedeId" THEN
    RAISE EXCEPTION 'El cobro no corresponde a una venta de la sede';
  END IF;
  IF NEW."tipo" = 'COBRO' THEN
    IF venta."estado" <> 'PENDIENTE' THEN
      RAISE EXCEPTION 'La venta no admite cobros (está %)', venta."estado";
    END IF;
    SELECT COALESCE(sum("monto"), 0) INTO cobrado FROM "CobroVenta" WHERE "organizacionId" = NEW."organizacionId" AND "ventaId" = NEW."ventaId";
    IF venta."anticipo" + cobrado + NEW."monto" > venta."total" THEN
      RAISE EXCEPTION 'El cobro supera el saldo de la venta';
    END IF;
  ELSE
    IF venta."estado" = 'ANULADA' THEN
      RAISE EXCEPTION 'La venta ya está anulada';
    END IF;
    SELECT * INTO original FROM "CobroVenta" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."revierteId";
    IF NOT FOUND OR original."tipo" <> 'COBRO' OR original."ventaId" <> NEW."ventaId" OR original."medio" <> NEW."medio" OR original."monto" <> -NEW."monto" THEN
      RAISE EXCEPTION 'El reverso no corresponde al cobro original';
    END IF;
  END IF;
  IF NEW."cajaId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Caja" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."cajaId" AND "sedeId" = NEW."sedeId" AND "estado" = 'ABIERTA') THEN
    RAISE EXCEPTION 'La caja del cobro no está abierta en la sede';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CobroVenta_coherente" BEFORE INSERT ON "CobroVenta" FOR EACH ROW EXECUTE FUNCTION "cobro_coherente"();

-- Al confirmar la transacción, todo cobro (o reverso) en efectivo tiene su movimiento en la caja.
CREATE FUNCTION "cobro_efectivo_en_caja"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."medio" = 'EFECTIVO' AND NOT EXISTS (SELECT 1 FROM "MovimientoCaja" WHERE "organizacionId" = NEW."organizacionId" AND "cobroId" = NEW."id") THEN
    RAISE EXCEPTION 'El cobro en efectivo no tiene su movimiento de caja';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "CobroVenta_efectivo_movimiento" AFTER INSERT ON "CobroVenta" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "cobro_efectivo_en_caja"();

-- Caja: una sola abierta por sede; el cierre guarda esperado, contado y diferencia = contado − esperado.
CREATE UNIQUE INDEX "Caja_una_abierta_por_sede" ON "Caja"("sedeId") WHERE "estado" = 'ABIERTA';
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_forma" CHECK (COALESCE("montoInicial" >= 0 AND (
  ("estado" = 'ABIERTA' AND "cerradaPorId" IS NULL AND "cerradaEn" IS NULL AND "esperado" IS NULL AND "contado" IS NULL AND "diferencia" IS NULL)
  OR ("estado" = 'CERRADA' AND "cerradaPorId" IS NOT NULL AND "cerradaEn" IS NOT NULL AND "esperado" IS NOT NULL AND "contado" >= 0 AND "diferencia" = "contado" - "esperado"))
  AND ("observaciones" IS NULL OR length("observaciones") <= 500), false));

-- Una caja nace abierta, se cierra una sola vez y no se borra. El esperado del cierre tiene que ser
-- exactamente el inicial más la suma de sus movimientos.
CREATE FUNCTION "caja_transicion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  movido NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."estado" <> 'ABIERTA' THEN RAISE EXCEPTION 'Una caja nace abierta'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una caja no se borra (solo inserción)';
  END IF;
  IF OLD."estado" <> 'ABIERTA' OR NEW."estado" <> 'CERRADA' THEN
    RAISE EXCEPTION 'Solo se cierra una caja abierta';
  END IF;
  IF (NEW."id", NEW."organizacionId", NEW."sedeId", NEW."montoInicial", NEW."abiertaPorId", NEW."abiertaEn")
     IS DISTINCT FROM (OLD."id", OLD."organizacionId", OLD."sedeId", OLD."montoInicial", OLD."abiertaPorId", OLD."abiertaEn") THEN
    RAISE EXCEPTION 'Los datos de apertura no se editan';
  END IF;
  SELECT COALESCE(sum("monto"), 0) INTO movido FROM "MovimientoCaja" WHERE "organizacionId" = NEW."organizacionId" AND "cajaId" = NEW."id";
  IF NEW."esperado" <> NEW."montoInicial" + movido THEN
    RAISE EXCEPTION 'El esperado del cierre no coincide con los movimientos de la caja';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Caja_transicion" BEFORE INSERT OR UPDATE OR DELETE ON "Caja" FOR EACH ROW EXECUTE FUNCTION "caja_transicion"();

-- Movimientos: signo y origen según el tipo. Los manuales llevan motivo; el reverso, el original y motivo.
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_forma" CHECK (COALESCE(CASE "tipo"
  WHEN 'INGRESO_COBRO' THEN "monto" > 0 AND "cobroId" IS NOT NULL AND "gastoId" IS NULL AND "revierteId" IS NULL AND "motivo" IS NULL
  WHEN 'EGRESO_GASTO' THEN "monto" < 0 AND "gastoId" IS NOT NULL AND "cobroId" IS NULL AND "revierteId" IS NULL AND "motivo" IS NULL
  WHEN 'ENTRADA' THEN "monto" > 0 AND "cobroId" IS NULL AND "gastoId" IS NULL AND "revierteId" IS NULL AND length(btrim("motivo")) BETWEEN 5 AND 500
  WHEN 'SALIDA' THEN "monto" < 0 AND "cobroId" IS NULL AND "gastoId" IS NULL AND "revierteId" IS NULL AND length(btrim("motivo")) BETWEEN 5 AND 500
  WHEN 'REVERSO' THEN "monto" <> 0 AND "revierteId" IS NOT NULL AND NOT ("cobroId" IS NOT NULL AND "gastoId" IS NOT NULL) AND length(btrim("motivo")) BETWEEN 5 AND 500
  ELSE false END, false));
CREATE TRIGGER "MovimientoCaja_inmutable" BEFORE UPDATE OR DELETE ON "MovimientoCaja" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();

-- Coherencia del movimiento. Bloquea la fila de la caja (FOR UPDATE), igual que el cierre: un movimiento
-- no entra en una caja que se está cerrando, y el efectivo nunca queda negativo.
CREATE FUNCTION "movimiento_caja_coherente"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  caja RECORD;
  cobro RECORD;
  gasto RECORD;
  original RECORD;
  movido NUMERIC;
BEGIN
  SELECT * INTO caja FROM "Caja" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."cajaId" FOR UPDATE;
  IF NOT FOUND OR caja."sedeId" <> NEW."sedeId" OR caja."estado" <> 'ABIERTA' THEN
    RAISE EXCEPTION 'La caja no está abierta en la sede';
  END IF;
  IF NEW."cobroId" IS NOT NULL THEN
    SELECT * INTO cobro FROM "CobroVenta" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."cobroId";
    IF NOT FOUND OR cobro."medio" <> 'EFECTIVO' OR cobro."monto" <> NEW."monto" OR cobro."cajaId" IS DISTINCT FROM NEW."cajaId"
       OR cobro."tipo" <> (CASE NEW."tipo" WHEN 'REVERSO' THEN 'REVERSO' ELSE 'COBRO' END)::"TipoCobro" THEN
      RAISE EXCEPTION 'El movimiento no corresponde al cobro en efectivo';
    END IF;
  END IF;
  IF NEW."gastoId" IS NOT NULL THEN
    SELECT * INTO gasto FROM "Gasto" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."gastoId";
    IF NOT FOUND OR gasto."sedeId" <> NEW."sedeId" OR gasto."medioPago" <> 'EFECTIVO' OR gasto."monto" <> -NEW."monto"
       OR gasto."tipo" <> (CASE NEW."tipo" WHEN 'REVERSO' THEN 'REVERSO' ELSE 'GASTO' END)::"TipoMovimientoGasto" THEN
      RAISE EXCEPTION 'El movimiento no corresponde al gasto en efectivo';
    END IF;
  END IF;
  IF NEW."tipo" = 'REVERSO' THEN
    SELECT * INTO original FROM "MovimientoCaja" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."revierteId";
    IF NOT FOUND OR original."tipo" = 'REVERSO' OR original."sedeId" <> NEW."sedeId" OR original."monto" <> -NEW."monto"
       OR (original."cobroId" IS NULL) <> (NEW."cobroId" IS NULL) OR (original."gastoId" IS NULL) <> (NEW."gastoId" IS NULL) THEN
      RAISE EXCEPTION 'El reverso no corresponde al movimiento original';
    END IF;
  END IF;
  SELECT COALESCE(sum("monto"), 0) INTO movido FROM "MovimientoCaja" WHERE "organizacionId" = NEW."organizacionId" AND "cajaId" = NEW."cajaId";
  IF caja."montoInicial" + movido + NEW."monto" < 0 THEN
    RAISE EXCEPTION 'La caja no tiene efectivo suficiente';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MovimientoCaja_coherente" BEFORE INSERT ON "MovimientoCaja" FOR EACH ROW EXECUTE FUNCTION "movimiento_caja_coherente"();

