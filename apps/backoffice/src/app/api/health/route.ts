import type { HealthResponse } from "@nailnet/contracts";
export function GET() { return Response.json({ status: "ok", service: "backoffice" } satisfies HealthResponse); }
