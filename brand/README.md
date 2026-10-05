# Sicurella — kit de marca

Recursos extraídos de la identidad vigente en [sicurella.com.ar](https://sicurella.com.ar/) (relevada el 2026-10-05) para usar en Nailnet. Lo que no existe en el sitio y se agregó para la app está marcado como **[derivado]** en los tokens.

```
brand/
├── logos/svg/     logo y wordmark en teal, negro y blanco (vector)
├── logos/png/     las mismas variantes a 480 px y 1600 px de ancho + el PNG original del sitio
├── icons/         isotipo "S", favicon (.svg/.ico), apple-touch-icon, íconos PWA 192/512/maskable
├── tokens/        tokens.css · tokens.json · tokens.ts
├── fonts/         Figtree 400–700 y Varela Round 400 (woff2, OFL) + fonts.css
└── preview.html   hoja visual de referencia
```

## Logo

| Archivo | Uso |
|---|---|
| `sicurella-logo-*.svg` | Logo completo con ®. Uso por defecto. |
| `sicurella-wordmark-*.svg` | Sin ®, para tamaños chicos (< 120 px de ancho), donde el ® se vuelve ilegible. |
| `sicurella-isotipo*.svg` | "S" del logo sobre teal. Avatar, app icon, favicon. |

- El SVG es una vectorización fiel del PNG publicado en el sitio (diferencia < 1 % de píxeles). Si existe el archivo fuente del diseñador (AI/PDF), conviene reemplazarlo.
- Versión teal sobre fondos claros; blanca sobre `--color-primary` o fotos oscuras; negra solo cuando no hay color disponible.
- Área de resguardo: dejar libre alrededor un margen mínimo igual a la mitad de la altura del logo.
- No deformar, no recolorear fuera de las tres variantes, no agregar sombras ni contornos.
- El favicon actual del sitio (círculo `#00BCD4` con una "S" tipográfica genérica) es un placeholder que no coincide con la marca; `icons/favicon.svg` lo reemplaza con la "S" real y el teal correcto.

## Color

| Token | Hex | Uso |
|---|---|---|
| `--color-brand` | `#008194` | Color exacto del logo |
| `--color-primary` | `#008094` | Botones primarios, links, foco, acentos en títulos |
| `--color-primary-foreground` | `#F5FEFF` | Texto sobre primary (contraste 4,5:1) |
| `--color-foreground` | `#020817` | Títulos y texto principal |
| `--color-muted-foreground` | `#628084` | Texto secundario del sitio (4,25:1 sobre blanco). Las apps lo reemplazan por `#536F73` (≥ 5:1 sobre blanco, `secondary` y `muted`) porque lo usan en tamaños chicos |
| `--color-secondary` | `#F2F7F8` | Fondos suaves, chips, botón secundario |
| `--color-secondary-foreground` | `#005A66` | Texto sobre secondary |
| `--color-border` | `#E0E9EB` | Bordes, divisores, inputs |
| `--color-destructive` | `#EF4444` | Errores (para texto sobre blanco usar `#C53030`, 5,5:1) |

Escala `--teal-50…950` y `success`/`warning` son **[derivado]**, calculadas sobre el teal de marca y verificadas para AA. El sitio define un modo oscuro, pero es el default de shadcn/ui sin teal (primary blanco); no forma parte de la identidad y no se incluye.

## Tipografía

- **Logo**: tipografía redondeada geométrica con terminales redondeadas; por forma parece Gotham Rounded (comercial, no confirmado). No se usa para texto: el logo va siempre como imagen.
- **Sitio**: no carga fuentes propias; usa la pila del sistema (`ui-sans-serif, system-ui…`), por lo que se ve Segoe UI en Windows y SF Pro en Apple. Títulos en bold 700 con tracking muy cerrado (`-0.05em`); cuerpo 400.
- **App (propuesta)**: `Figtree` para toda la UI — geométrica, de la misma familia visual que el logo y consistente entre sistemas operativos. `Varela Round` opcional como display (saludos, números grandes, estados vacíos), por su cercanía con el wordmark. Si se prefiere replicar el sitio al 100 %, basta con quitar `"Figtree"` de `--font-sans`.

Jerarquía usada en el sitio: H1 60 px / 700 / line-height 1; H2 36–48 px / 700; cuerpo grande 20 px / 28 px; cuerpo 14–16 px; botones 14 px / 500.

## Forma

`--radius` 12 px (cards e imágenes), botones e inputs 10 px, badges en pill. Bordes de 1 px `--color-border`, sombras mínimas. Botón primario: fondo teal, texto `#F5FEFF`, 14 px / 500, padding 8 × 16 px.

## Integración en Nailnet

```css
/* apps/booking/src/style.css · apps/backoffice/src/app/globals.css */
@import "../../../brand/fonts/fonts.css";   /* ajustar la ruta relativa */
@import "../../../brand/tokens/tokens.css";

body { font-family: var(--font-sans); color: var(--color-foreground); background: var(--color-background); }
```

- **Backoffice (Next.js)**: copiar `icons/favicon.ico`, `favicon.svg` y `apple-touch-icon.png` a `apps/backoffice/src/app/` (Next los detecta por convención) y los logos a `public/`.
- **Booking (Vite)**: copiar `icons/` a `public/` y enlazar `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`.
- `tokens.ts` sirve para lógica en JS (colores de estados en la agenda, meta `theme-color`). Se generó desde `tokens.css`: si cambia uno, actualizar el otro.

## Licencias

Figtree y Varela Round: SIL Open Font License 1.1 (`fonts/OFL-*.txt`), uso comercial y embebido permitido. Logo e isotipo: propiedad de Sicurella.
