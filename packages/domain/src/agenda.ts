// Calendario local: rangos en minutos desde la medianoche de la sede, semiabiertos [inicio, fin).
// Fechas locales como "YYYY-MM-DD"; instantes en UTC. La zona IANA es la de la sede.
export type Rango = { inicio: number; fin: number };

const HORA = /^([01]\d|2[0-4]):([0-5]\d)$/;
export function aMinutos(hhmm: string): number | null {
  const m = HORA.exec(hhmm.trim());
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total <= 1440 ? total : null;
}
export function aHora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

export function solapan(a: Rango, b: Rango): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** «09:00-13:00, 14:00-20:00» → rangos ordenados, en múltiplos de 5 y sin solaparse. Vacío = no trabaja. */
export function parsearRangos(texto: string): { error: string } | { rangos: Rango[] } {
  const partes = texto.split(",").map(p => p.trim()).filter(Boolean);
  const rangos: Rango[] = [];
  for (const parte of partes) {
    const [a, b, extra] = parte.split("-").map(x => x.trim());
    const inicio = a ? aMinutos(a) : null, fin = b ? aMinutos(b) : null;
    if (extra !== undefined || inicio === null || fin === null) return { error: `Rango inválido: «${parte}». Usá HH:MM-HH:MM` };
    if (inicio >= fin) return { error: `El rango ${parte} termina antes de empezar` };
    if (inicio % 5 || fin % 5) return { error: `Usá horarios en múltiplos de 5 minutos (${parte})` };
    rangos.push({ inicio, fin });
  }
  rangos.sort((x, y) => x.inicio - y.inicio);
  for (let i = 1; i < rangos.length; i++) if (solapan(rangos[i - 1]!, rangos[i]!)) return { error: "Los rangos de un mismo día no pueden superponerse" };
  return { rangos };
}
export function formatearRangos(rangos: readonly Rango[]): string {
  return [...rangos].sort((a, b) => a.inicio - b.inicio).map(r => `${aHora(r.inicio)}-${aHora(r.fin)}`).join(", ");
}

/** Vigencias inclusivas por fecha local; null = sin límite. */
export function vigenciasSeCruzan(d1: string | null, h1: string | null, d2: string | null, h2: string | null): boolean {
  return (d1 === null || h2 === null || d1 <= h2) && (d2 === null || h1 === null || d2 <= h1);
}
export function validarFecha(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

// ─── Zonas horarias ────────────────────────────────────────────────────────────

function partesLocales(instante: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(instante).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute), segundos: Number(p.second) };
}
/** Fecha y minuto local de un instante en la zona de la sede. */
export function aLocal(instante: Date, tz: string): { fecha: string; minutos: number } {
  const { fecha, minutos } = partesLocales(instante, tz);
  return { fecha, minutos };
}
/**
 * Instante UTC de una hora local. Ajusta por el desfasaje real de esa fecha (sirve con cambios de horario).
 * Una hora local inexistente se corre hacia adelante; una repetida toma la primera ocurrencia.
 */
export function aUtc(fecha: string, minutos: number, tz: string): Date {
  const [y, m, d] = fecha.split("-").map(Number) as [number, number, number];
  const ingenuo = Date.UTC(y, m - 1, d, 0, minutos);
  let instante = ingenuo;
  for (let i = 0; i < 3; i++) {
    const local = partesLocales(new Date(instante), tz);
    const [ly, lm, ld] = local.fecha.split("-").map(Number) as [number, number, number];
    const comoUtc = Date.UTC(ly, lm - 1, ld, 0, local.minutos, local.segundos);
    const desfase = comoUtc - instante;
    const siguiente = ingenuo - desfase;
    if (siguiente === instante) break;
    instante = siguiente;
  }
  return new Date(instante);
}
/** Día de la semana de una fecha local (0 = domingo). */
export function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}
