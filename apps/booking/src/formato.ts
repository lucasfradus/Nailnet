// Fechas y horas siempre en la zona de la sede, no en la del navegador.
const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const dinero = (decimal: string) => pesos.format(Number(decimal));

export const hora = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export const fechaLarga = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));

export function duracion(minutos: number) {
  const h = Math.floor(minutos / 60), m = minutos % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** Fecha calendario AAAA-MM-DD de un instante (por defecto, ahora) en la zona indicada. */
export const fechaEn = (timezone: string, instante: string | Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));

// Las fechas AAAA-MM-DD se operan al mediodía UTC: así ningún desfase horario cambia el día.
const mediodia = (fecha: string) => new Date(`${fecha}T12:00:00Z`);
export function sumarDias(fecha: string, dias: number) {
  const d = mediodia(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export function partesDia(fecha: string) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", ...o }).format(mediodia(fecha)).replace(".", "");
  return { semana: f({ weekday: "short" }), numero: f({ day: "numeric" }), mes: f({ month: "short" }) };
}
