/**
 * «Agregar al calendario» del comprobante: enlace de Google Calendar y archivo .ics (Apple, Outlook y el
 * resto). Todo se arma en el navegador con lo que ya muestra el comprobante; no hay pedido al backend.
 */
export type EventoTurno = { titulo: string; inicio: string; fin: string; lugar: string; detalle: string };

/** 2026-11-21T13:00:00.000Z → 20261121T130000Z (UTC, como piden Google e iCalendar). */
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function enlaceGoogle(e: EventoTurno) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.titulo, dates: `${utc(e.inicio)}/${utc(e.fin)}`, details: e.detalle, location: e.lugar });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// RFC 5545: escapar \ ; , y saltos de línea; líneas de hasta 75 octetos (se pliegan con CRLF + espacio).
const escapar = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function plegar(linea: string) {
  const partes: string[] = [];
  let actual = "", bytes = 0;
  for (const c of linea) {
    const n = new TextEncoder().encode(c).length;
    if (bytes + n > (partes.length ? 74 : 75)) { partes.push(actual); actual = ""; bytes = 0; }
    actual += c; bytes += n;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

export function archivoIcs(e: EventoTurno, uid: string) {
  const lineas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sicurella//Reservas//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utc(new Date().toISOString())}`, `DTSTART:${utc(e.inicio)}`, `DTEND:${utc(e.fin)}`,
    `SUMMARY:${escapar(e.titulo)}`, `LOCATION:${escapar(e.lugar)}`, `DESCRIPTION:${escapar(e.detalle)}`,
    // Recordatorio un día antes, para que no se olvide.
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", `DESCRIPTION:${escapar(e.titulo)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lineas.map(plegar).join("\r\n") + "\r\n";
}

/** Descarga el .ics. En iOS Safari abre directamente la hoja de «Agregar al calendario». */
export function descargarIcs(e: EventoTurno, uid: string) {
  const url = URL.createObjectURL(new Blob([archivoIcs(e, uid)], { type: "text/calendar;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "turno-sicurella.ics" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
