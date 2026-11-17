-- Precios por medio de pago, etapa 2 (D22, doc 32): la venta congela el medio cuyo precio se aplicó, su
-- ajuste y el redondeo; cada ítem, su precio con ese ajuste. Las ventas anteriores quedan con lista.

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "ajustePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "medioPrecioId" UUID,
ADD COLUMN     "redondeoPaso" INTEGER,
ADD COLUMN     "redondeoSentido" "SentidoRedondeo";

-- AlterTable
ALTER TABLE "VentaItem" ADD COLUMN     "precioMedio" DECIMAL(12,2);

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_organizacionId_sedeId_medioPrecioId_fkey" FOREIGN KEY ("organizacionId", "sedeId", "medioPrecioId") REFERENCES "MedioPagoSede"("organizacionId", "sedeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. Sin medio no hay ajuste ni redondeo (precio de lista).
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_precio_aplicado" CHECK (COALESCE(
  "ajustePct" BETWEEN -90 AND 100
  AND ("medioPrecioId" IS NOT NULL OR ("ajustePct" = 0 AND "redondeoPaso" IS NULL AND "redondeoSentido" IS NULL))
  AND ("redondeoPaso" IS NULL OR "redondeoPaso" IN (0, 10, 50, 100, 500, 1000))
  AND (("redondeoPaso" IS NULL) = ("redondeoSentido" IS NULL)), false));
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_precio_medio" CHECK ("precioMedio" IS NULL OR "precioMedio" >= 0);

-- El precio aplicado tampoco se edita después del alta (venta_transicion cubre el resto de los datos).
CREATE FUNCTION "venta_precio_fijo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."medioPrecioId", NEW."ajustePct", NEW."redondeoPaso", NEW."redondeoSentido")
     IS DISTINCT FROM (OLD."medioPrecioId", OLD."ajustePct", OLD."redondeoPaso", OLD."redondeoSentido") THEN
    RAISE EXCEPTION 'El precio aplicado de una venta no se edita';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Venta_precio_fijo" BEFORE UPDATE ON "Venta" FOR EACH ROW EXECUTE FUNCTION "venta_precio_fijo"();

-- El medio del precio estaba habilitado al registrar la venta, y su ajuste es el congelado.
CREATE FUNCTION "venta_medio_precio"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  medio RECORD;
BEGIN
  IF NEW."medioPrecioId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO medio FROM "MedioPagoSede" WHERE "organizacionId" = NEW."organizacionId" AND "sedeId" = NEW."sedeId" AND "id" = NEW."medioPrecioId";
  IF NOT FOUND OR NOT medio."habilitado" THEN
    RAISE EXCEPTION 'El medio del precio no está habilitado en la sede';
  END IF;
  IF medio."ajustePct" <> NEW."ajustePct" THEN
    RAISE EXCEPTION 'El ajuste de la venta no coincide con el de su medio';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Venta_medio_precio" BEFORE INSERT ON "Venta" FOR EACH ROW EXECUTE FUNCTION "venta_medio_precio"();
