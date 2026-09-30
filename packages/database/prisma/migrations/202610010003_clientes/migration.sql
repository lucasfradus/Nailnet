-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('FEMENINO', 'MASCULINO', 'OTRO', 'NO_INFORMA');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('DNI', 'CUIT', 'CUIL', 'PASAPORTE');

-- CreateEnum
CREATE TYPE "TipoConsentimiento" AS ENUM ('PRACTICA', 'TERMINOS', 'MARKETING');

-- CreateEnum
CREATE TYPE "AccionConsentimiento" AS ENUM ('ACEPTA', 'REVOCA');

-- CreateEnum
CREATE TYPE "CanalConsentimiento" AS ENUM ('RECEPCION', 'PORTAL');

-- CreateTable
CREATE TABLE "Cliente" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "sexo" "Sexo",
    "tipoDocumento" "TipoDocumento",
    "documento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteSede" (
    "organizacionId" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteSede_pkey" PRIMARY KEY ("clienteId","sedeId")
);

-- CreateTable
CREATE TABLE "ConsentimientoVersion" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "tipo" "TipoConsentimiento" NOT NULL,
    "clave" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "creadoPor" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentimientoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteConsentimiento" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "sedeId" UUID,
    "accion" "AccionConsentimiento" NOT NULL,
    "canal" "CanalConsentimiento" NOT NULL,
    "registradoPor" UUID,
    "evidencia" JSONB,
    "orden" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClienteConsentimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cliente_organizacionId_telefono_idx" ON "Cliente"("organizacionId", "telefono");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_organizacionId_id_key" ON "Cliente"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_organizacionId_email_key" ON "Cliente"("organizacionId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_organizacionId_tipoDocumento_documento_key" ON "Cliente"("organizacionId", "tipoDocumento", "documento");

-- CreateIndex
CREATE INDEX "ClienteSede_organizacionId_sedeId_idx" ON "ClienteSede"("organizacionId", "sedeId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentimientoVersion_organizacionId_clave_version_key" ON "ConsentimientoVersion"("organizacionId", "clave", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentimientoVersion_organizacionId_id_key" ON "ConsentimientoVersion"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "ClienteConsentimiento_organizacionId_clienteId_createdAt_idx" ON "ClienteConsentimiento"("organizacionId", "clienteId", "createdAt");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteSede" ADD CONSTRAINT "ClienteSede_organizacionId_clienteId_fkey" FOREIGN KEY ("organizacionId", "clienteId") REFERENCES "Cliente"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteSede" ADD CONSTRAINT "ClienteSede_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimientoVersion" ADD CONSTRAINT "ConsentimientoVersion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteConsentimiento" ADD CONSTRAINT "ClienteConsentimiento_organizacionId_clienteId_fkey" FOREIGN KEY ("organizacionId", "clienteId") REFERENCES "Cliente"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteConsentimiento" ADD CONSTRAINT "ClienteConsentimiento_organizacionId_versionId_fkey" FOREIGN KEY ("organizacionId", "versionId") REFERENCES "ConsentimientoVersion"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteConsentimiento" ADD CONSTRAINT "ClienteConsentimiento_organizacionId_sedeId_fkey" FOREIGN KEY ("organizacionId", "sedeId") REFERENCES "Sede"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma: mantener en migraciones SQL.
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_contacto" CHECK ("email" IS NOT NULL OR "telefono" IS NOT NULL);
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_email_normalizado" CHECK ("email" IS NULL OR "email" = lower(btrim("email")));
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_documento_completo" CHECK (("tipoDocumento" IS NULL) = ("documento" IS NULL));
ALTER TABLE "ConsentimientoVersion" ADD CONSTRAINT "ConsentimientoVersion_version_positiva" CHECK ("version" > 0);
ALTER TABLE "ConsentimientoVersion" ADD CONSTRAINT "ConsentimientoVersion_clave_formato" CHECK ("clave" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Textos aceptados y registros de aceptación son evidencia: solo inserción.
CREATE FUNCTION "solo_insercion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es de solo inserción', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "ConsentimientoVersion_inmutable" BEFORE UPDATE OR DELETE ON "ConsentimientoVersion" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
CREATE TRIGGER "ClienteConsentimiento_inmutable" BEFORE UPDATE OR DELETE ON "ClienteConsentimiento" FOR EACH ROW EXECUTE FUNCTION "solo_insercion"();
