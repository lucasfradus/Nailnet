import { aUtc, diaSemana, type Rango } from "./agenda.ts";

// Motor puro: sin base de datos ni reloj implícito. Trabaja en milisegundos UTC con intervalos [desde, hasta).
export type Intervalo = { desde: number; hasta: number };
const cruza = (a: Intervalo, b: Intervalo) => a.desde < b.hasta && b.desde < a.hasta;
const contiene = (fuera: Intervalo, dentro: Intervalo) => fuera.desde <= dentro.desde && dentro.hasta <= fuera.hasta;
const MIN = 60_000;

// ─── Calendario del día ───────────────────────────────────────────────────────

export type FilaSemanal = { diaSemana: number; inicioMinutos: number; finMinutos: number; vigenteDesde: string | null; vigenteHasta: string | null };
export type FilaExcepcion = { cerrado: boolean; inicioMinutos: number | null; finMinutos: number | null };

const vigente = (f: FilaSemanal, fecha: string) => (f.vigenteDesde === null || f.vigenteDesde <= fecha) && (f.vigenteHasta === null || fecha <= f.vigenteHasta);
function desdeExcepciones(filas: readonly FilaExcepcion[]): Rango[] {
  if (filas.some(f => f.cerrado)) return [];
  return filas.map(f => ({ inicio: f.inicioMinutos!, fin: f.finMinutos! })).sort((a, b) => a.inicio - b.inicio);
}

/**
 * Apertura de la sede en una fecha local. Prioridad: fechas especiales de la sede, luego de la
 * organización (feriados), luego el horario semanal vigente. Cualquier «cerrado» cierra el día.
 */
export function aperturaDelDia(semanal: readonly FilaSemanal[], excepcionesSede: readonly FilaExcepcion[], excepcionesOrganizacion: readonly FilaExcepcion[], fecha: string): Rango[] {
  if (excepcionesSede.length) return desdeExcepciones(excepcionesSede);
  if (excepcionesOrganizacion.length) return desdeExcepciones(excepcionesOrganizacion);
  return jornadaDelDia(semanal, fecha);
}
export function jornadaDelDia(semanal: readonly FilaSemanal[], fecha: string): Rango[] {
  const dia = diaSemana(fecha);
  return semanal.filter(f => f.diaSemana === dia && vigente(f, fecha)).map(f => ({ inicio: f.inicioMinutos, fin: f.finMinutos })).sort((a, b) => a.inicio - b.inicio);
}
export function aIntervalos(rangos: readonly Rango[], fecha: string, tz: string): Intervalo[] {
  return rangos.map(r => ({ desde: aUtc(fecha, r.inicio, tz).getTime(), hasta: aUtc(fecha, r.fin, tz).getTime() }));
}

// ─── Búsqueda ─────────────────────────────────────────────────────────────────

export type ItemPedido = {
  servicioId: string; duracionMinutos: number; bufferAntesMinutos: number; bufferDespuesMinutos: number;
  requisitos: { tipoRecursoId: string; cantidad: number }[];
  /** Profesionales aptos (sede, skills, habilitación, activos). Si se eligió uno, solo ese. */
  candidatos: string[];
};
export type DatosProfesional = { jornada: Intervalo[]; ocupado: Intervalo[]; cargaMinutos: number };
export type DatosRecurso = { id: string; tipoRecursoId: string; ocupado: Intervalo[] };
export type Consulta = {
  fecha: string; tz: string; pasoMinutos: number;
  apertura: Intervalo[];
  items: ItemPedido[];
  profesionales: ReadonlyMap<string, DatosProfesional>;
  recursos: readonly DatosRecurso[];
  /** Primer instante admitido (ahora + anticipación) y último inicio admitido (horizonte). */
  desdeMs: number; hastaMs: number | null;
};
export type ItemAsignado = { servicioId: string; profesionalId: string; inicio: number; fin: number; ocupaDesde: number; ocupaHasta: number; recursoIds: string[] };
export type Turno = { inicio: number; fin: number; items: ItemAsignado[] };

/** Orden para «cualquiera» (D16): menor carga del día, luego ID. Determinista. */
function ordenar(candidatos: readonly string[], profesionales: Consulta["profesionales"]) {
  return [...candidatos].filter(id => profesionales.has(id))
    .sort((a, b) => profesionales.get(a)!.cargaMinutos - profesionales.get(b)!.cargaMinutos || (a < b ? -1 : a > b ? 1 : 0));
}

function libre(ocupado: readonly Intervalo[], tentativo: readonly Intervalo[], intervalo: Intervalo) {
  return !ocupado.some(o => cruza(o, intervalo)) && !tentativo.some(o => cruza(o, intervalo));
}

/** Unidades distintas por tipo, libres en todo el intervalo; orden estable por ID. */
function asignarRecursos(item: ItemPedido, intervalo: Intervalo, recursos: Consulta["recursos"], tentativos: Map<string, Intervalo[]>): string[] | null {
  const elegidos: string[] = [];
  for (const req of item.requisitos) {
    const libres = recursos.filter(r => r.tipoRecursoId === req.tipoRecursoId && libre(r.ocupado, tentativos.get(r.id) ?? [], intervalo)).map(r => r.id).sort();
    if (libres.length < req.cantidad) return null;
    elegidos.push(...libres.slice(0, req.cantidad));
  }
  return elegidos;
}

/**
 * Asigna los ítems encadenados a partir de `inicio`. Cada ítem empieza cuando termina el servicio
 * anterior. El profesional ocupa su intervalo con tiempos de preparación, dentro de su jornada;
 * el servicio en sí debe caer dentro de la apertura de la sede. Búsqueda en profundidad acotada:
 * prueba profesionales en orden de preferencia y vuelve atrás si un ítem posterior no tiene lugar.
 */
function asignar(c: Consulta, inicio: number): ItemAsignado[] | null {
  const tentProf = new Map<string, Intervalo[]>();
  const tentRec = new Map<string, Intervalo[]>();
  const resultado: ItemAsignado[] = [];
  const paso = (i: number, desde: number): boolean => {
    if (i === c.items.length) return true;
    const item = c.items[i]!;
    const fin = desde + item.duracionMinutos * MIN;
    const servicio = { desde, hasta: fin };
    if (!c.apertura.some(a => contiene(a, servicio))) return false;
    const ocupa = { desde: desde - item.bufferAntesMinutos * MIN, hasta: fin + item.bufferDespuesMinutos * MIN };
    for (const id of ordenar(item.candidatos, c.profesionales)) {
      const p = c.profesionales.get(id)!;
      if (!p.jornada.some(j => contiene(j, ocupa)) || !libre(p.ocupado, tentProf.get(id) ?? [], ocupa)) continue;
      const recursoIds = asignarRecursos(item, ocupa, c.recursos, tentRec);
      if (!recursoIds) return false; // los recursos no dependen del profesional elegido
      tentProf.set(id, [...(tentProf.get(id) ?? []), ocupa]);
      for (const r of recursoIds) tentRec.set(r, [...(tentRec.get(r) ?? []), ocupa]);
      resultado.push({ servicioId: item.servicioId, profesionalId: id, inicio: desde, fin, ocupaDesde: ocupa.desde, ocupaHasta: ocupa.hasta, recursoIds });
      if (paso(i + 1, fin)) return true;
      resultado.pop();
      tentProf.get(id)!.pop();
      for (const r of recursoIds) tentRec.get(r)!.pop();
    }
    return false;
  };
  return paso(0, inicio) ? resultado : null;
}

/**
 * Turnos disponibles en la fecha. Los inicios caen en múltiplos de `pasoMinutos` desde la medianoche
 * local (D17 sigue pendiente: el paso es configuración de la sede, sin valor por defecto).
 */
export function buscarTurnos(c: Consulta): Turno[] {
  if (!c.items.length || !Number.isInteger(c.pasoMinutos) || c.pasoMinutos < 5) return [];
  const turnos: Turno[] = [];
  for (let minuto = 0; minuto < 1440; minuto += c.pasoMinutos) {
    const inicio = aUtc(c.fecha, minuto, c.tz).getTime();
    if (inicio < c.desdeMs || (c.hastaMs !== null && inicio > c.hastaMs)) continue;
    const items = asignar(c, inicio);
    if (items) turnos.push({ inicio, fin: items.at(-1)!.fin, items });
  }
  return turnos;
}

/** Útil para validar una solicitud concreta (retención): ¿sigue libre exactamente este inicio? */
export function asignarEn(c: Consulta, inicio: number): Turno | null {
  if (inicio < c.desdeMs || (c.hastaMs !== null && inicio > c.hastaMs)) return null;
  const items = asignar(c, inicio);
  return items ? { inicio, fin: items.at(-1)!.fin, items } : null;
}

