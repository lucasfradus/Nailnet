/** Contrato público de liveness; no certifica acceso a base de datos o proveedores. */
export interface HealthResponse { status: "ok"; service: "backoffice" | "worker"; }
