import type { Celda } from "@nailnet/domain/reportes";
import type { ReporteSede } from "@nailnet/database/reportes";
import { MEDIOS_COBRO_ETIQUETA } from "../ventas/comun";

// Una sola definición por tabla: la pantalla y el CSV muestran exactamente lo mismo.
// Celdas: bigint = pesos en centavos; number = cantidad, horas o porcentaje; null = sin dato.
export type Tabla = { titulo: string; encabezados: string[]; filas: Celda[][] };

const horas = (minutos: number) => Math.round(minutos / 6) / 10;

export const TABLAS = {
  profesionales: (r: ReporteSede): Tabla => ({
    titulo: "Ventas por profesional",
    encabezados: ["Profesional", "Servicios", "Vendido neto"],
    filas: r.ventas.porProfesional.map(p => [p.nombre, p.servicios, p.neto]),
  }),
  servicios: (r: ReporteSede): Tabla => ({
    titulo: "Ventas por servicio",
    encabezados: ["Servicio", "Cantidad", "Vendido neto"],
    filas: r.ventas.porServicio.map(s => [s.nombre, s.cantidad, s.neto]),
  }),
  cobros: (r: ReporteSede): Tabla => ({
    titulo: "Cobros por medio",
    encabezados: ["Medio", "Cobrado", "Revertido", "Neto"],
    filas: r.cobros.porMedio.map(c => [MEDIOS_COBRO_ETIQUETA[c.medio], c.cobrado, c.revertido, c.neto]),
  }),
  turnos: (r: ReporteSede): Tabla => ({
    titulo: "Turnos por estado",
    encabezados: ["Estado", "Turnos"],
    filas: [
      ["Atendidos", r.turnos.atendidos], ["Ausentes", r.turnos.ausentes], ["Cancelados", r.turnos.cancelados],
      ["Confirmados sin marcar", r.turnos.confirmados], ["Pendientes de pago", r.turnos.pendientes], ["Total", r.turnos.total],
      ["Reprogramados (no suman)", r.turnos.reprogramados], ["Retenciones vencidas (no suman)", r.turnos.expirados],
    ],
  }),
  ocupacion: (r: ReporteSede): Tabla => ({
    titulo: "Ocupación por profesional",
    encabezados: ["Profesional", "Disponible (h)", "Con turnos (h)", "Pendiente de pago (h)", "Ocupación (%)"],
    filas: r.ocupacion.profesionales.map(o => [o.nombre, horas(o.disponibleMinutos), horas(o.ocupadoMinutos), horas(o.pendienteMinutos), o.porcentaje]),
  }),
  comisiones: (r: ReporteSede): Tabla => ({
    titulo: "Base comisionable por profesional",
    encabezados: ["Profesional", "Servicios", "Bruto", "Descuento", "Base comisionable"],
    filas: r.comisiones.profesionales.map(p => [p.nombre, p.servicios, p.bruto, -p.descuento, p.base]),
  }),
} satisfies Record<string, (r: ReporteSede) => Tabla>;

export type Seccion = keyof typeof TABLAS;
export const esSeccion = (s: string | null): s is Seccion => s !== null && Object.hasOwn(TABLAS, s);
