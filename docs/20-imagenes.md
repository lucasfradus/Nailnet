# Imágenes de servicios y profesionales · 2026-10-05

Fotos para el portal: una imagen por servicio y una foto por profesional, subidas desde el backoffice. Migración `202610050011_imagenes`.

## Almacenamiento

Las imágenes se guardan en PostgreSQL (tabla `Imagen`, columna `bytea`), no en un bucket. Para un piloto con decenas de imágenes alcanza, entra en el backup de la base y no suma infraestructura ni costos. Si el volumen crece, se puede pasar a un bucket (S3, R2 o Railway) cambiando solo `imagenes.ts` y la ruta pública: el portal recibe URLs y no sabe dónde viven.

- **Siempre procesadas:** se guarda la versión ya convertida, nunca el archivo original.
- **Inmutables:** reemplazar crea otra fila y borra la anterior en la misma transacción. Así el id sirve de clave de caché.
- **Reglas en la base:** `CHECK` de tipo (`image/webp`), dimensiones, tamaño (2 MB máximo) y formato del hash.
- **Referencias:** `Servicio.imagenId` y `Profesional.fotoId`, con FK compuesta por organización: no se puede apuntar a una imagen de otra organización.

## Procesamiento (`packages/database/src/imagenes.ts`, con sharp)

- **Entrada:** JPG, PNG, WebP o AVIF de hasta 8 MB y 50 megapíxeles. Se decodifica de verdad: un archivo que no es imagen, un SVG o un GIF se rechaza aunque la extensión diga otra cosa.
- **Servicio:** hasta 1200 px de lado, sin recorte ni agrandar; el portal encuadra.
- **Retrato:** cuadrado de 600 px tomado desde arriba, donde suele estar la cara. La estrategia «attention» de sharp se descartó: en la demo eligió la ropa y cortó la cabeza.
- **Salida:** WebP calidad 80, con orientación corregida y **sin metadatos**. EXIF puede traer la ubicación GPS de quien sacó la foto, y la imagen se publica. En la demo quedan entre 15 y 120 KB.

## Permisos

| Operación | Quién |
|---|---|
| Imagen de servicio | `catalogo:administrar` (master), igual que editar el servicio |
| Foto de profesional | `profesional:administrar` sobre alguna sede del profesional (admin de sede, franquiciado, master), igual que editar sus datos |

Cada cambio queda auditado (`catalogo.servicio.imagen`, `profesional.foto` y sus variantes `.quitar`).

## Backoffice

- **Catálogo:** en «Catálogo de la organización», al abrir un servicio aparecen la vista previa, subir/reemplazar y quitar. El resumen indica «sin imagen» cuando falta.
- **Profesional:** en su ficha, foto redonda con las mismas acciones.
- **Límite de subida:** las Server Actions admiten cuerpos de hasta 9 MB (`experimental.serverActions.bodySizeLimit`).

## API pública

- `GET /api/public/v1/imagenes/{id}`: `image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `ETag` con el SHA-256 (responde 304 a `If-None-Match`), `Cross-Origin-Resource-Policy: cross-origin` y una CSP que impide interpretarla como documento.
- **Qué se sirve:** solo una imagen en uso por un servicio o profesional de una organización activa. Cualquier otro caso responde 404 `no-store`, sin distinguir el motivo.
- **Contrato:**
  - `ServicioPublico` suma `descripcion` e `imagenUrl`.
  - `ProfesionalPublico` suma `fotoUrl`.
  - Los ítems de `ReservaPublicaEstado` suman `imagenUrl` y `fotoUrl`.
  - Las URLs son rutas relativas al origen de la API; el portal les agrega `VITE_API_URL`.

## Portal

Portada en el primer paso y tarjetas de servicio con foto y descripción (lista en móvil, dos columnas en escritorio). Los profesionales aparecen con su retrato, y «Cualquier profesional» muestra las caras del equipo. El resumen lleva la foto del servicio y el comprobante final incluye foto del servicio y del profesional. Sin imagen, o si no carga, se muestra un fondo con la inicial. Las imágenes cargan en diferido (`loading="lazy"`).

## Demo

`packages/database/prisma/demo-imagenes/` tiene fotos de stock de Pexels; las fuentes están en `CREDITOS.md`. Las personas retratadas no son profesionales reales de la marca: reemplazarlas antes de un piloto. El seed las sube con el mismo procesamiento, solo a servicios y profesionales demo sin imagen, y completa las descripciones vacías.

## Verificación

- **`npm run test:database`:** 111 tests. `imagenes.test.ts` cubre:
  - EXIF con GPS eliminado, tamaños y retrato cuadrado;
  - rechazo de SVG, GIF, texto, archivo vacío y más de 8 MB;
  - permisos por rol, sede y organización;
  - reemplazo y borrado de la anterior, y huérfana no servida;
  - contrato público y organización inactiva.
- **Backoffice en Chrome:** login, subir y reemplazar una foto (la anterior pasa a 404) y un archivo inválido con su mensaje.
- **Portal en Chrome:** a 390 y 1280 px, todas las imágenes cargan y no hay scroll horizontal.
