# Revisión de los proyectos existentes

## Alcance y evidencia

Revisión estática, el 2026-09-09, de `C:/Users/lucas/Clicnet` y `C:/Users/lucas/reservas/reservas-clientes-clic`. Se inspeccionaron estructura, dependencias, modelos y rutas representativas. No se ejecutaron las aplicaciones ni sus tests, no se conectó a bases o proveedores y no se leyeron archivos de secretos. Los hallazgos describen el código local; no certifican su comportamiento en producción ni su igualdad con GitHub.

Clicnet organiza negocio en `src/lib/modules`, integraciones en `src/lib/facturante` y `src/lib/mercadopago`, rutas en `src/app` y persistencia en `prisma/schema.prisma`. Su manifiesto declara Next 16.2.1, Prisma 7.6, React 19.2.4 y Auth.js 5 beta. Son versiones observadas, no una selección automática para NailNet.

## Matriz de reutilización

| Área | Evidencia local en Clicnet | Decisión para NailNet |
|---|---|---|
| Login | `auth.ts`: Credentials, bcrypt, normalización de email, limitación de intentos, usuario activo | Reutilizar conceptos; elegir y probar versiones de autenticación en fase 1 |
| Roles | `auth.ts` infiere rol por perfiles y usa ADMIN si no encuentra otro; `src/lib/permisos.ts` mantiene matriz estática | Roles explícitos, sin privilegio por ausencia de perfil; asignaciones con alcance |
| Alcances | `src/lib/auth/helpers.ts`: sedes por perfil y cookie de sede activa; `modules/_shared/create-action.ts`: permiso + validación + sede opcional | Centralizar autorización obligatoria; separar filtro visual del alcance autorizado |
| Sedes/franquiciados | `Sede`, `Franquiciado`, `FranquiciadoSede`; `modules/configuracion/sedes.ts` | Cambiar M:N de propiedad por un propietario por sede. Franquiciado será entidad comercial separada de Usuario |
| Clientes | `Alumno`, `Usuario`; `modules/alumnos/actions.ts` | Nuevo Cliente sin cuenta obligatoria ni datos de salud. Reutilizar validación y contacto; excluir fotos, ficha médica, planes y migraciones |
| Reservas | `Reserva` apunta a Clase y Suscripcion; `modules/reservas/core.ts` usa transacción y lock de Clase | Reutilizar transacciones; reemplazar cupos y accesos por intervalos de profesional y recursos |
| Pagos | `Pago` exige Suscripcion; `modules/pagos`, `modules/mercadopago` | Pago independiente, imputaciones a venta/reserva, múltiples cobros y reembolsos |
| Mercado Pago | `api/webhooks/mercadopago/route.ts`: firma HMAC y comparación constante, consultas y transacciones; cuentas por sede | Adaptador acotado a señas, reconciliación y reembolsos. Excluir preapprovals y renovaciones |
| Caja | `MovimientoCaja`, `CuentaCaja`, `MovimientoCuenta`, `CierrePeriodo`; `modules/caja-mc/generar-movimientos.ts` | Elegir un solo libro de movimientos; caja física y cobros digitales diferenciados. Dejar conciliador bancario avanzado fuera |
| Productos | Producto por sede, variantes, compras y ventas; `modules/productos/ventas-actions.ts` | Catálogo compartido y StockSede separado; unidades fraccionarias para consumibles |
| Facturante | `FacturanteConfig`, `Comprobante`, `lib/facturante/*`, `modules/facturacion/emitir.ts` | Reutilizar separación cliente/mappers/errores/cifrado, revisar idempotencia externa y adaptar venta/anticipo |
| Emails | `lib/notificaciones/email.ts`: Resend con alternativa SMTP | Resend y registro durable; remitente y plantillas propios |
| Reportes/auditoría | Módulos `reportes`, exportación `alumnos/exportar-xlsx.ts`, AuditLog | Reutilizar organización y trazabilidad mínima; nuevas métricas de atención, venta y cobro |

## Riesgos concretos al copiar

1. `auth.ts` asigna ADMIN cuando no hay otro perfil. NailNet debe denegar acceso sin asignación explícita. El franquiciado no debe estar ligado a un único usuario.
2. El wrapper de acciones hace opcional el chequeo de sede. Para NailNet, permiso y alcance deben verificarse también al acceder directamente por ID, exportar o procesar una acción financiera.
3. `reservas/core.ts` verifica una reserva duplicada antes del lock de Clase; ese patrón no basta para garantizar exclusión de intervalos. El nuevo motor revalidará todo dentro de la transacción.
4. `productos/ventas-actions.ts` comprueba stock antes de la transacción y luego decrementa. Reemplazar por actualización condicional atómica y restricción de stock no negativo.
5. `facturacion/emitir.ts` consulta permisos, lee comprobantes, llama al proveedor y después hace upsert. No se observa en esa función un claim persistido previo ni un control de alcance de la sede del pago. El índice `(pagoId, tipo)` evita filas locales repetidas, pero no dos emisiones externas concurrentes. No copiar ese orden.
6. El esquema de Comprobante contempla notas de crédito y reintentos; la función inspeccionada es emisión on-demand. No considerar probado un circuito completo de notas de crédito, reintentos o producción por la sola existencia de campos o tests.
7. `facturante/crypto.ts` cifra con AES-256-GCM e IV aleatorio. Es un patrón útil. `CuentaMercadoPago` tiene campos String para tokens: el esquema por sí solo no acredita cifrado. NailNet exigirá cifrado explícito y versión de clave para ambos proveedores.
8. El cliente Facturante local deja la URL de producción a configuración explícita y diferencia estado HTTP del resultado del proveedor. Los contratos actuales de producción y capacidades de consulta/deduplicación deben comprobarse con documentación del proveedor y sandbox.
9. El generador de movimientos de caja puede omitir el asiento si falta configuración de cuenta. NailNet deberá impedir habilitar cobros sin cuenta válida o registrar una incidencia reconciliable; no perder el rastro financiero silenciosamente.

## Portal de reservas

El supuesto del prompt quedó desactualizado: el proyecto contiene una aplicación React/Vite con React Router, páginas Landing, Sede, Precios, Reservar y Gracias; componentes visuales, cliente HTTP y tipos.

- `src/api/client.ts` consume sedes, clases, catálogo y checkout mediante `VITE_API_BASE_URL`.
- `src/pages/Reservar.tsx` captura contacto, valida, envía clase/sede al checkout y redirige a `initPoint`.
- `src/pages/Gracias.tsx` interpreta el estado de retorno por query params y prepara un calendario de 50 minutos. NailNet consultará el estado autorizado en backend y usará la duración del turno.
- Reutilizar estructura visual, tratamiento de errores y estados de carga. Reescribir selección por servicio/profesional/recurso, contratos y confirmación. No copiar marca CLIC, analítica ni dominio de clases.

No se verificó su integración real contra el backend. La existencia de pantallas y llamadas no implica que el flujo esté certificado.
