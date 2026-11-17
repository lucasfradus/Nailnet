-- Precios por medio de pago, etapa 1 (D22, doc 32): medios de pago de cada sede con su ajuste sobre la
-- lista, redondeo de la sede y el medio con que se hizo cada cobro.

-- CreateEnum
CREATE TYPE "SentidoRedondeo" AS ENUM ('ABAJO', 'CERCANO', 'ARRIBA');

-- AlterTable
ALTER TABLE "ConfiguracionSede" ADD COLUMN     "redondeoPaso" INTEGER,
ADD COLUMN     "redondeoSentido" "SentidoRedondeo";

-- AlterTable
ALTER TABLE "CobroVenta" ADD COLUMN     "medioNombre" TEXT,
ADD COLUMN     "medioPagoId" UUID;

-- CreateTable
CREATE TABLE "MedioPagoSede" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "MedioCobro" NOT NULL,
    "ajustePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedioPagoSede_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedioPagoSede_sedeId_orden_idx" ON "MedioPagoSede"("sedeId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "MedioPagoSede_organizacionId_id_key" ON "MedioPagoSede"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MedioPagoSede_organizacionId_sedeId_id_key" ON "MedioPagoSede"("organizacionId", "sedeId", "id");

-- CreateIndex
CREATE INDEX "CobroVenta_medioPagoId_idx" ON "CobroVenta"("medioPagoId");

-- AddForeignKey
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_organizacionId_sedeId_medioPagoId_fkey" FOREIGN KEY ("organizacionId", "sedeId", "medioPagoId") REFERENCES "MedioPagoSede"("organizacionId", "sedeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedioPagoSede" ADD CONSTRAINT "MedioPagoSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. COALESCE: un CHECK que evalúa a NULL se rechaza.
-- Nombre único por sede sin distinguir mayúsculas; ajuste entre −90% y +100%.
CREATE UNIQUE INDEX "MedioPagoSede_sede_nombre" ON "MedioPagoSede"("sedeId", lower("nombre"));
ALTER TABLE "MedioPagoSede" ADD CONSTRAINT "MedioPagoSede_valores" CHECK (COALESCE(
  length(btrim("nombre")) BETWEEN 1 AND 40 AND "ajustePct" BETWEEN -90 AND 100 AND "orden" >= 0, false));
ALTER TABLE "ConfiguracionSede" ADD CONSTRAINT "ConfiguracionSede_redondeo" CHECK (
  "redondeoPaso" IS NULL OR "redondeoPaso" IN (0, 10, 50, 100, 500, 1000));
ALTER TABLE "CobroVenta" ADD CONSTRAINT "CobroVenta_medio_nombre" CHECK (
  ("medioPagoId" IS NULL) = ("medioNombre" IS NULL) AND ("medioNombre" IS NULL OR length(btrim("medioNombre")) BETWEEN 1 AND 40));

-- El tipo de un medio no cambia (los cobros guardan el suyo) y un medio no se borra: se deshabilita.
CREATE FUNCTION "medio_pago_estable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un medio de pago no se borra: deshabilitalo';
  END IF;
  IF NEW."tipo" <> OLD."tipo" OR NEW."sedeId" <> OLD."sedeId" OR NEW."organizacionId" <> OLD."organizacionId" THEN
    RAISE EXCEPTION 'El tipo y la sede de un medio de pago no cambian';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MedioPagoSede_estable" BEFORE UPDATE OR DELETE ON "MedioPagoSede" FOR EACH ROW EXECUTE FUNCTION "medio_pago_estable"();

-- El cobro con medio de la sede lleva el tipo de ese medio, y el medio está habilitado al cobrar. El
-- reverso repite el medio del cobro original (aunque después se haya deshabilitado).
CREATE FUNCTION "cobro_medio_coherente"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  medio RECORD;
  original RECORD;
BEGIN
  IF NEW."tipo" = 'REVERSO' THEN
    SELECT * INTO original FROM "CobroVenta" WHERE "organizacionId" = NEW."organizacionId" AND "id" = NEW."revierteId";
    IF FOUND AND original."medioPagoId" IS DISTINCT FROM NEW."medioPagoId" THEN
      RAISE EXCEPTION 'El reverso no corresponde al medio del cobro original';
    END IF;
  END IF;
  IF NEW."medioPagoId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO medio FROM "MedioPagoSede" WHERE "organizacionId" = NEW."organizacionId" AND "sedeId" = NEW."sedeId" AND "id" = NEW."medioPagoId";
  IF NOT FOUND OR medio."tipo" <> NEW."medio" THEN
    RAISE EXCEPTION 'El cobro no corresponde al tipo de su medio de pago';
  END IF;
  IF NEW."tipo" = 'COBRO' AND NOT medio."habilitado" THEN
    RAISE EXCEPTION 'El medio de pago está deshabilitado en la sede';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CobroVenta_medio_coherente" BEFORE INSERT ON "CobroVenta" FOR EACH ROW EXECUTE FUNCTION "cobro_medio_coherente"();

-- Cada sede nace con los seis medios estándar en 0%: nada cambia hasta que la sede cargue sus porcentajes.
CREATE FUNCTION "medios_pago_iniciales"(org UUID, sede UUID) RETURNS void LANGUAGE sql AS $$
  INSERT INTO "MedioPagoSede" ("id", "organizacionId", "sedeId", "nombre", "tipo", "orden", "updatedAt")
  SELECT gen_random_uuid(), org, sede, m.nombre, m.tipo::"MedioCobro", m.orden, CURRENT_TIMESTAMP
  FROM (VALUES ('Efectivo', 'EFECTIVO', 0), ('Transferencia', 'TRANSFERENCIA', 1), ('Débito', 'TARJETA_DEBITO', 2),
               ('Crédito', 'TARJETA_CREDITO', 3), ('Mercado Pago', 'MERCADO_PAGO', 4), ('Otro', 'OTRO', 5)) AS m(nombre, tipo, orden);
$$;
CREATE FUNCTION "sede_medios_pago"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "medios_pago_iniciales"(NEW."organizacionId", NEW."id");
  RETURN NULL;
END;
$$;
CREATE TRIGGER "Sede_medios_pago" AFTER INSERT ON "Sede" FOR EACH ROW EXECUTE FUNCTION "sede_medios_pago"();

-- Relleno: las sedes que ya existen reciben los mismos medios.
SELECT "medios_pago_iniciales"(s."organizacionId", s."id") FROM "Sede" s;
