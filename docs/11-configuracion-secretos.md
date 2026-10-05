# Configuración y secretos por sede · 2026-10-01

Implementa A03. Migración `202610010002_configuracion_sede`. Pantalla: Sedes → nombre de la sede.

## Parámetros con herencia

Cada parámetro operativo tiene un valor opcional por organización y otro por sede. Vale el de la sede; si no tiene, el de la organización; si ninguno lo define, queda **sin definir**. Sin definir significa que el motor de reservas no debe operar con ese parámetro: la sede no ofrecerá turnos online hasta completarlo. No se asume ningún valor por defecto.

| Parámetro | Rango | Decisión |
|---|---|---|
| Horizonte de reserva | 1–365 días | D18: criterio confirmado, valor pendiente (sistema actual: ~14) |
| Anticipación mínima | 0–10.080 minutos | D18: criterio confirmado, valor pendiente |
| Intervalo entre inicios de turno | 5–120 minutos, múltiplo de 5 | D17: pendiente; agregado con C04 |
| Retención de turno pendiente | 5–60 minutos | D4: confirmado, 15 por defecto |

**Quién edita:**
- **Valores de la sede:** administración de sede, franquiciado o master, siempre dentro de su alcance.
- **Valores de la organización:** solo el master.

**Validación:** los rangos se controlan en el dominio y además con `CHECK` en la base. Nuevos parámetros (retención D4, grilla D17, cancelación D5) se agregan a `PARAMETROS` en `packages/domain/src/configuracion.ts` una vez decididos.

D12 (qué es global y qué es local) sigue pendiente. El mecanismo de herencia permite cualquiera de las dos respuestas sin cambiar el esquema.

## Credenciales de proveedores

Cada sede tiene sus credenciales por proveedor (Mercado Pago, Facturante) y ambiente (prueba, producción), como pide D8.

- **Quién las gestiona:** solo el franquiciado dueño de la sede o el master (permiso `sede:credenciales`). Administración de sede y recepción no las ven. Es una propuesta: si el negocio quiere delegarlo a la administración de sede, se cambia en la matriz de permisos.
- **Escritura sin lectura:** la UI muestra el estado, los datos públicos (ID de cuenta, public key, company/subsidiary) y una pista con los últimos 4 caracteres. Para cambiar un secreto se cargan de nuevo todos.
- **Cifrado:** AES-256-GCM con IV aleatorio y versión de clave. Sede, proveedor y ambiente van como dato asociado: un secreto copiado a otra fila no descifra (probado).
- **Controles en la base:** un `CHECK` rechaza texto plano en la columna cifrada.
- **Cuenta de Mercado Pago:** un mismo `user_id` no puede quedar vinculado a dos sedes en el mismo ambiente.
- **Facturante:** no tiene restricción equivalente, porque varias sedes pueden compartir CUIT con puntos de venta distintos (`ConfiguracionFiscalSede`).
- **Formatos:** se valida lo mínimo para detectar errores de carga. Los formatos exactos de Mercado Pago son estimados y se ajustarán con las credenciales sandbox (F05).
- **Lectura interna:** `leerCredencial` descifra solo para adaptadores de servidor (worker y webhooks). No recibe actor y nunca debe usarse con datos de un formulario.
- **Redacción:** `auditar()` pasa todo por `redactar()`. Claves con nombres como token, secret, password o key quedan como `[redactado]`, aunque alguien las incluya por error.

## Claves y rotación

Variables solo de servidor (backoffice y worker; nunca con prefijo `VITE_`):

- `NAILNET_CLAVES_CIFRADO`: lista `v1:<base64 de 32 bytes>;v2:<...>`.
- `NAILNET_CLAVE_ACTIVA`: versión con la que se cifra, p. ej. `v2`.

Sin estas variables, guardar credenciales falla con un mensaje claro: no hay modo sin cifrado. Para generar una clave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Rotación:
1. Agregar la clave nueva a la lista.
2. Apuntar la versión activa a ella y desplegar.
3. Ejecutar `npm run secretos:recifrar -w @nailnet/database`. Es idempotente y no pisa credenciales reemplazadas durante el proceso.
4. Recién después retirar la versión vieja.

La pantalla marca las credenciales pendientes de rotación.

`compose.yaml` incluye una clave generada **solo para desarrollo local**. Staging y producción necesitan claves propias, guardadas en las variables del servicio (Railway), fuera del repositorio y de la base.

## Pendiente

- No se cargaron credenciales reales ni se contactó a los proveedores. La conexión real y los formatos definitivos quedan para F05.
- Vincular la cuenta de Mercado Pago por OAuth en lugar de pegar tokens: se evaluará con F05/R04.
- Consulta de auditoría de cambios de credenciales en la UI.

## Verificación

- `npm run test:domain`: cifrado ligado al contexto, alteración detectada, rotación, llavero inválido, redacción, validación por proveedor, herencia y rangos.
- `npm run test:database`: 6 escenarios de configuración y credenciales en PostgreSQL. Cubren herencia y aislamiento entre organizaciones, permisos y `CHECK`, secretos ausentes en base, respuestas y auditoría, cuenta no compartida, secreto copiado ilegible y rotación idempotente.
- Prueba E2E manual (fuera de CI) con `next dev`: el franquiciado guarda una credencial y el HTML muestra solo la pista; el admin de sede configura parámetros sin ver credenciales; una sede ajena o un ID inválido devuelven 404. No se probó en un navegador real.
