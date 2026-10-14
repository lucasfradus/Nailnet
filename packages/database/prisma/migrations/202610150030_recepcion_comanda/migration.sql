-- Flujo real de recepción de Sicurella (2026-10-14, ver docs/27-ventas-caja.md):
-- «Atender ahora» para clientes sin turno, comanda editable al cobrar y cierre con diferencia explicado.
-- Migración aparte porque 202610150010_ventas_caja ya está en main (y puede estar aplicada).

-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "sinTurnoPrevio" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VentaItem" ADD COLUMN     "servicioId" UUID,
ADD COLUMN     "profesionalId" UUID,
ADD COLUMN     "precioLista" DECIMAL(12,2);

-- Ítems de servicio ya registrados: servicio y profesional salen de su ítem de reserva. La tabla es de
-- solo inserción, así que el trigger se suspende solo para este relleno.
ALTER TABLE "VentaItem" DISABLE TRIGGER "VentaItem_inmutable";
UPDATE "VentaItem" v SET "servicioId" = ri."servicioId", "profesionalId" = ri."profesionalId"
FROM "ReservaItem" ri
WHERE v."tipo" = 'SERVICIO' AND ri."organizacionId" = v."organizacionId" AND ri."id" = v."reservaItemId";
ALTER TABLE "VentaItem" ENABLE TRIGGER "VentaItem_inmutable";

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_organizacionId_servicioId_fkey" FOREIGN KEY ("organizacionId", "servicioId") REFERENCES "Servicio"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_organizacionId_profesionalId_fkey" FOREIGN KEY ("organizacionId", "profesionalId") REFERENCES "Profesional"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Comanda: un servicio lleva servicio y profesional (y, si vino del turno, su ítem de reserva); un
-- producto, el producto. El precio de lista es el propuesto y el unitario, el cobrado.
ALTER TABLE "VentaItem" DROP CONSTRAINT "VentaItem_forma";
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_forma" CHECK (COALESCE(
  (("tipo" = 'SERVICIO' AND "servicioId" IS NOT NULL AND "profesionalId" IS NOT NULL AND "productoId" IS NULL AND "cantidad" = 1)
    OR ("tipo" = 'PRODUCTO' AND "productoId" IS NOT NULL AND "reservaItemId" IS NULL AND "servicioId" IS NULL AND "profesionalId" IS NULL AND "cantidad" > 0))
  AND ("precioLista" IS NULL OR "precioLista" >= 0)
  AND "precioUnitario" >= 0 AND "subtotal" >= 0 AND "posicion" >= 0 AND length(btrim("descripcion")) BETWEEN 1 AND 300, false));

-- Los servicios solo se cobran contra un turno (con o sin reserva previa): la venta tiene reserva, y el
-- ítem de reserva, si lo hay, es de ese turno.
CREATE FUNCTION "venta_item_coherente"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  venta RECORD;
BEGIN
  IF NEW."tipo" <> 'SERVICIO' THEN RETURN NEW; END IF;
  SELECT "reservaId" INTO venta FROM "Venta" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."ventaId";
  IF NOT FOUND OR venta."reservaId" IS NULL THEN
    RAISE EXCEPTION 'Los servicios se cobran contra un turno';
  END IF;
  IF NEW."reservaItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ReservaItem" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."reservaItemId" AND "reservaId" = venta."reservaId") THEN
    RAISE EXCEPTION 'El ítem de reserva es de otro turno';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "VentaItem_coherente" BEFORE INSERT ON "VentaItem" FOR EACH ROW EXECUTE FUNCTION "venta_item_coherente"();

-- Un cierre con diferencia se explica (confirmado por Sicurella el 2026-10-14). NOT VALID: los cierres
-- anteriores quedan como estaban; rige para los nuevos.
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_diferencia_explicada" CHECK (COALESCE(
  "estado" = 'ABIERTA' OR "diferencia" = 0 OR length(btrim("observaciones")) >= 5, false)) NOT VALID;
