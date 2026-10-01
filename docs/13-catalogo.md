# Catálogo de servicios y precios por sede · 2026-10-01

Implementa C02. Migración `202610010004_catalogo`. Pantalla: Catálogo.

## Global y local

Aplica la propuesta de D12, todavía no confirmada. El esquema no impide cambiarla.

| Nivel | Qué define | Quién |
|---|---|---|
| Organización | Categorías, servicios, duración base, tiempos de preparación, habilidades requeridas, recursos que ocupa, consentimientos que exige, seña por defecto | Master |
| Sede | Habilitación, **precio**, duración propia, seña propia, si se reserva online | Admin de sede, franquiciado o master, dentro de su alcance |

- **Precio:** es solo de la sede, independiente del profesional. El análisis de la competencia mostró que el precio por profesional existe en su sistema pero no se usa.
- **Habilitación:** un servicio habilitado exige precio, también por `CHECK` en la base. Desactivar un servicio lo quita de todas las sedes.
- **Habilidades:** el profesional debe tener todas las requeridas (se asignan en C03).
- **Recursos:** se declara cuántas unidades distintas de cada tipo ocupa el servicio durante todo el turno. Las unidades concretas por sede llegan en C03.
- **Consentimientos:** se vinculan por clave, así siempre rige la versión vigente. Solo se aceptan claves de consentimientos de práctica existentes.
- **Tiempos de preparación:** los usará el motor de disponibilidad (C04). La grilla de inicio de turnos (D17) sigue pendiente.

## Seña: modelada, no decidida (D3)

- **Opciones:** sin definir, sin seña, monto fijo o porcentaje entero (1–100).
- **Herencia:** se define por servicio y cada sede puede usar su propio valor.
- **Seña sin definir:** el servicio no se ofrece online. Queda disponible en recepción si está habilitado. No hay valor por defecto.
- **Límite:** la seña fija no puede superar el precio. Si después baja el precio o sube la seña del servicio, la seña deja de ser válida y el servicio sale de la oferta online.
- **Validación en la base:** un `CHECK` exige coherencia entre tipo y valor. Se corrigió un bug detectado por los tests: una comparación con NULL dejaba pasar una seña fija sin monto. Ahora el `CHECK` usa `COALESCE(..., false)`.
- **Montos:** en centavos (`bigint`) en el dominio, `Decimal(12,2)` en la base y cadenas `"30000.00"` hacia afuera. Nunca `Number` para calcular dinero.
- **Redondeo del porcentaje:** al centavo, mitad hacia arriba. El ejemplo del plan ($30.000 con 30% = $9.000) está en los tests.

**Qué significa «online» en esta pantalla:** que el servicio está en condiciones de ofrecerse online. Para publicar turnos, la sede además necesita horizonte y anticipación definidos (D18, doc 11) y el motor de disponibilidad (C04).

Los cambios de precio, duración o seña no alteran reservas ya tomadas: la reserva guardará una copia (snapshot) de sus condiciones (R01).

## Pendiente

- Confirmar D12 y D3 (tipo e importe inicial de seña).
- Variantes y adicionales de servicio: la competencia los tiene habilitados pero no los usa; fuera del MVP.
- Unidades de recurso concretas y requisito de «unidad específica» (C03).
- Imágenes de servicios y categorías para el portal (P01).

## Verificación

- `npm run test:domain`: importes sin punto flotante, seña fija y porcentual, redondeo, seña mayor al precio, duración y condiciones efectivas con herencia.
- `npm run test:database`: 5 escenarios de catálogo en PostgreSQL:
  - administración exclusiva del master y nombres únicos;
  - validaciones y aislamiento entre organizaciones (categoría, skill o servicio ajenos);
  - `CHECK` de seña;
  - precio por sede sin herencia entre sedes, servicio no online sin seña definida;
  - seña heredada y excepción por sede, límite contra el precio, «solo recepción», servicio inactivo.
- Prueba E2E manual con `next dev`:
  - el master crea una categoría y un servicio con seña del 30%;
  - el admin de sede fija $30.000 y ve la seña heredada de $9.000;
  - recepción consulta sin poder editar.
  - No se probó en un navegador real.
