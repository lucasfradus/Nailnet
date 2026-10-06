-- AlterTable
ALTER TABLE "Profesional" ADD COLUMN     "fotoId" UUID;

-- AlterTable
ALTER TABLE "Servicio" ADD COLUMN     "imagenId" UUID;

-- CreateTable
CREATE TABLE "Imagen" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "datos" BYTEA NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "creadoPor" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Imagen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Imagen_organizacionId_id_key" ON "Imagen"("organizacionId", "id");

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_organizacionId_imagenId_fkey" FOREIGN KEY ("organizacionId", "imagenId") REFERENCES "Imagen"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profesional" ADD CONSTRAINT "Profesional_organizacionId_fotoId_fkey" FOREIGN KEY ("organizacionId", "fotoId") REFERENCES "Imagen"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Imagen" ADD CONSTRAINT "Imagen_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas no expresables en schema.prisma. Solo se guardan imágenes ya procesadas por el backend.
ALTER TABLE "Imagen" ADD CONSTRAINT "Imagen_mime" CHECK ("mime" = 'image/webp');
ALTER TABLE "Imagen" ADD CONSTRAINT "Imagen_dimensiones" CHECK ("ancho" BETWEEN 1 AND 4000 AND "alto" BETWEEN 1 AND 4000);
ALTER TABLE "Imagen" ADD CONSTRAINT "Imagen_tamano" CHECK (octet_length("datos") BETWEEN 1 AND 2000000);
ALTER TABLE "Imagen" ADD CONSTRAINT "Imagen_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
