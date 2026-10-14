# Integraciones de servidor

Clientes de proveedores externos. No importar desde booking (lo impide el lint): solo el backoffice y el worker.

- `mercadopago`: Checkout Pro (crear preferencia, consultar pago). Ver docs/23-pagos-mercadopago.md.
- `resend`: emails transaccionales (envío con idempotencia y transporte falso para desarrollo). Ver docs/24-emails.md.
- Facturante: pendiente (M02).
