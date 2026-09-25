# Flujo de reserva web del cliente · 25 de septiembre de 2026

Diagramas preparados para revisar el estado del proyecto. Muestran el **flujo propuesto**, tomado de [02-arquitectura.md](02-arquitectura.md), [03-backlog.md](03-backlog.md) (P01–P04, R01–R05) y [04-decisiones.md](04-decisiones.md). Hoy **no está implementado**: el portal (`apps/booking`) solo muestra «Reservas online próximamente» y no existen endpoints públicos, reservas, pagos ni emails. Los valores marcados como pendientes dependen de decisiones abiertas.

## 1. Recorrido del cliente en el portal

Pasos definidos en P01: sede → servicio → profesional → horario → datos → seña → confirmación. El cliente reserva como invitado (propuesta D2).

```mermaid
flowchart TD
  A([Cliente entra al portal]) --> B[Elige sede]
  B --> C[Elige servicio]
  C --> D{"Profesional"}
  D -->|Uno en particular| E[Elige profesional]
  D -->|Cualquiera| F[El sistema asigna uno compatible]
  E --> G[Ve horarios disponibles]
  F --> G
  G --> H[Elige horario]
  H --> I["Completa datos de contacto<br/>y acepta consentimientos"]
  I --> J["Se crea la reserva<br/>PENDIENTE_PAGO · retención 15 min"]
  J -->|409 horario ya tomado| G
  J --> K[Redirección a Mercado Pago<br/>Checkout Pro]
  K --> L[Paga la seña]
  L --> M[Vuelve al portal]
  M --> N{"Estado consultado<br/>al backend"}
  N -->|CONFIRMADA| O([Turno confirmado + email])
  N -->|Pago en revisión| P[Pantalla de espera]
  N -->|Rechazado y retención vigente| K
  N -->|EXPIRADA| Q([Retención vencida:<br/>volver a elegir horario])
```

La vuelta desde Mercado Pago **no confirma** la reserva: solo dispara una consulta. Quien confirma es el webhook validado (sección 2).

## 2. Secuencia técnica: reserva, pago y confirmación

```mermaid
sequenceDiagram
  autonumber
  actor C as Cliente
  participant P as Portal React/Vite
  participant API as API pública Next.js
  participant DB as PostgreSQL
  participant MP as Mercado Pago
  participant W as Worker
  participant R as Resend

  C->>P: Elige sede, servicio y profesional
  P->>API: GET /api/public/v1/sedes, servicios, profesionales
  P->>API: GET disponibilidad
  API->>DB: Calcula horarios libres
  API-->>P: Horarios

  C->>P: Elige horario y carga datos
  P->>API: POST /api/public/v1/reservas + Idempotency-Key
  API->>DB: Lock profesional y recursos, revalida y guarda<br/>Reserva PENDIENTE_PAGO + ocupación + expiresAt
  alt Horario ya tomado
    API-->>P: 409 conflicto
  else Reserva creada
    API->>DB: Guarda intento de pago local
    API->>MP: Crea preferencia Checkout Pro
    API-->>P: URL de pago + token de consulta
  end

  P->>MP: Redirección
  C->>MP: Paga la seña
  MP->>API: Webhook de pago
  API->>DB: Persiste evento antes de responder
  API->>MP: Consulta el pago real
  API->>DB: Valida cuenta, referencia, moneda y monto<br/>Reserva CONFIRMADA + aplicación de seña + outbox
  MP-->>P: Retorno del cliente
  P->>API: Consulta estado con token opaco
  API-->>P: CONFIRMADA

  W->>DB: Toma job del outbox
  W->>R: Envía email de confirmación
  R-->>C: Email con enlace de gestión
```

## 3. Estados de la reserva

```mermaid
stateDiagram-v2
  [*] --> PENDIENTE_PAGO: POST reserva
  PENDIENTE_PAGO --> CONFIRMADA: Pago aprobado y validado
  PENDIENTE_PAGO --> PAGO_EN_REVISION: Pago pendiente en MP
  PAGO_EN_REVISION --> CONFIRMADA: Aprobado antes de vencer
  PENDIENTE_PAGO --> EXPIRADA: Vence la retención
  PAGO_EN_REVISION --> EXPIRADA: Vence la retención
  PENDIENTE_PAGO --> CANCELADA
  PAGO_EN_REVISION --> CANCELADA
  CONFIRMADA --> ATENDIDA: Se presta el servicio
  CONFIRMADA --> AUSENTE: No se presenta
  CONFIRMADA --> CANCELADA: Cliente o sede cancelan
  ATENDIDA --> [*]
  AUSENTE --> [*]
  EXPIRADA --> [*]
  CANCELADA --> [*]
```

El reembolso no es un estado de la reserva: es un estado del pago. Reprogramar crea una reserva nueva enlazada a la original, sin borrar el turno.

## 4. Retención, vencimiento y pago tardío

```mermaid
flowchart TD
  A[Reserva PENDIENTE_PAGO<br/>retiene el horario 15 min] --> B{"¿Llega un pago<br/>aprobado a tiempo?"}
  B -->|Sí| C[CONFIRMADA]
  B -->|Rechazado| D{"¿Retención vigente?"}
  D -->|Sí| E[Puede reintentar el pago<br/>sin extender el plazo]
  E --> B
  D -->|No| F
  B -->|No, vence| F[EXPIRADA: se libera el horario<br/>worker o próximo intento bajo lock]
  F --> G{"¿Llega aprobación<br/>después de vencer?"}
  G -->|No| H([Fin])
  G -->|Sí| I[Se registra el pago real<br/>y se abre incidencia de devolución]
  I --> J([No se recupera el horario<br/>ni se confirma en silencio])
```

## 5. Estado de implementación

```mermaid
flowchart LR
  subgraph HECHO["Hecho"]
    H1[Monorepo, CI y Docker local]
    H2[Organización, sedes, usuarios]
    H3[Permisos por sede]
    H4[Portal: pantalla «próximamente»]
  end
  subgraph FALTA["Pendiente para reservar online"]
    F2[Catálogo, profesionales,<br/>horarios y recursos C01–C03]
    F3[Motor de disponibilidad<br/>y exclusión C04–C05]
    F4[Reservas y retenciones R01–R02]
    F5[Checkout MP y webhook R04]
    F6[API pública R05]
    F7[Portal P01–P02]
    F8[Emails y cancelación P03–P04]
  end
  H2 --> F2 --> F3 --> F4 --> F5 --> F7
  F4 --> F6 --> F7 --> F8
  classDef done fill:#d4f4dd,stroke:#2e7d32,color:#1b5e20
  classDef todo fill:#fff3cd,stroke:#b8860b,color:#5c4400
  class H1,H2,H3,H4 done
  class F2,F3,F4,F5,F6,F7,F8 todo
```

## Decisiones abiertas que afectan este flujo

| ID | Tema | Impacto en el flujo |
|---|---|---|
| D2 | Cuenta del cliente | Propuesta: invitado con enlace por email; cuenta opcional después |
| D3 | Tipo e importe de seña | Monto que se cobra en Checkout Pro |
| D4 | Retención | 15 minutos propuestos; define cuándo expira |
| D5 | Cancelación y reprogramación | Anticipación mínima y devolución desde el enlace del email |
| D7 | Reembolsos | Circuito para pagos tardíos y cancelaciones |
