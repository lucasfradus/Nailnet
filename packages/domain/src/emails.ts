/**
 * Plantillas de los emails transaccionales (P03). Puras: reciben datos ya cargados y devuelven asunto,
 * HTML y texto. Todo dato que viene del cliente o de la configuración (nombres, servicios, sede) se
 * escapa antes de ir al HTML; el asunto se limpia de saltos de línea.
 *
 * Marca: el nombre de la organización (Sicurella) y el teal del kit de marca (brand/tokens).
 */
export type MensajeEmail = { asunto: string; html: string; texto: string };

const COLOR = { primario: "#008094", texto: "#020817", secundario: "#536F73", fondo: "#F2F7F8", borde: "#E0E9EB", sobrePrimario: "#F5FEFF" } as const;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapa texto para HTML (contenido y atributos entre comillas). */
export const escaparHtml = (texto: string) => texto.replace(/[&<>"']/g, c => ESCAPES[c]!);

/** Una línea, sin caracteres de control y acotada: el asunto nunca lleva saltos de línea. */
export const limpiarLinea = (texto: string, max = 200) => texto.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** «lunes 13 de octubre» y «15:30» en la zona horaria de la sede. */
export function fechaHora(instante: Date, timezone: string) {
  const fecha = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(instante);
  const hora = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instante);
  return { fecha, hora };
}

/** Solo enlaces https (o http a localhost en desarrollo). Cualquier otra cosa no se pone en un href. */
export function enlaceSeguro(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return u.toString();
  } catch { /* inválido */ }
  return null;
}

type Bloque = { titulo: string; parrafos: string[]; detalle?: [string, string][]; boton?: { texto: string; url: string }; nota?: string };

/** Esqueleto común: tabla simple con estilos en línea, legible en clientes de correo viejos. Recibe texto plano y lo escapa. */
function html(marca: string, b: Bloque) {
  const e = escaparHtml;
  const detalle = b.detalle?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;background:${COLOR.fondo};border-radius:10px">${b.detalle.map(([k, v]) =>
      `<tr><td style="padding:8px 16px;color:${COLOR.secundario};font-size:14px;width:35%;vertical-align:top">${e(k)}</td><td style="padding:8px 16px;color:${COLOR.texto};font-size:15px;font-weight:600">${e(v)}</td></tr>`).join("")}</table>`
    : "";
  const boton = b.boton
    ? `<p style="margin:24px 0"><a href="${e(b.boton.url)}" style="display:inline-block;background:${COLOR.primario};color:${COLOR.sobrePrimario};text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${e(b.boton.texto)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(b.titulo)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR.texto}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;border:1px solid ${COLOR.borde};border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:3px solid ${COLOR.primario};font-size:20px;font-weight:700;color:${COLOR.primario}">${e(marca)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${COLOR.texto}">${e(b.titulo)}</h1>
${b.parrafos.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${e(p)}</p>`).join("\n")}
${detalle}${boton}
${b.nota ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${COLOR.secundario}">${e(b.nota)}</p>` : ""}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${COLOR.secundario}">${e(marca)} · Este es un mensaje automático, no hace falta responderlo.</p>
</td></tr></table>
</body></html>`;
}

function texto(marca: string, b: Bloque) {
  return [
    b.titulo, "",
    ...b.parrafos, "",
    ...(b.detalle ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(b.boton ? ["", `${b.boton.texto}: ${b.boton.url}`] : []),
    ...(b.nota ? ["", b.nota] : []),
    "", "—", `${marca} · Este es un mensaje automático, no hace falta responderlo.`,
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function armar(marca: string, asunto: string, b: Bloque): MensajeEmail {
  const m = limpiarLinea(marca, 100) || "NailNet";
  const limpio: Bloque = { ...b, titulo: limpiarLinea(b.titulo), parrafos: b.parrafos.map(p => limpiarLinea(p, 1000)), detalle: b.detalle?.map(([k, v]) => [limpiarLinea(k, 100), limpiarLinea(v, 300)]) };
  return { asunto: limpiarLinea(asunto), html: html(m, limpio), texto: texto(m, limpio) };
}

// ─── Reservas ────────────────────────────────────────────────────────────────

export type ItemTurno = { servicio: string; profesional: string | null; inicio: Date };
export type DatosEmailReserva = {
  /** Nombre de la organización: la marca del email (p. ej. «Sicurella»). */
  marca: string;
  sede: string;
  timezone: string;
  cliente: string;
  items: ItemTurno[];
};

function detalleTurno(d: DatosEmailReserva): [string, string][] {
  const primero = d.items[0]!;
  const { fecha, hora } = fechaHora(primero.inicio, d.timezone);
  const servicios = d.items.map(i => i.servicio).join(" + ");
  const profesionales = [...new Set(d.items.map(i => i.profesional).filter((p): p is string => !!p))].join(", ");
  return [
    ["Día", fecha],
    ["Hora", `${hora} h`],
    [d.items.length > 1 ? "Servicios" : "Servicio", servicios],
    ...(profesionales ? [["Con", profesionales] as [string, string]] : []),
    ["Sede", d.sede],
  ];
}
const saludo = (nombre: string) => { const n = limpiarLinea(nombre, 80); return n ? `Hola, ${n}.` : "Hola."; };
const CONTACTO = "Si necesitás cancelar o cambiar el turno, comunicate con la sede.";

export function emailReservaConfirmada(d: DatosEmailReserva): MensajeEmail {
  const { fecha, hora } = fechaHora(d.items[0]!.inicio, d.timezone);
  return armar(d.marca, `Tu turno en ${d.marca} ${d.sede} está confirmado: ${fecha}, ${hora} h`, {
    titulo: "Tu turno está confirmado",
    parrafos: [saludo(d.cliente), `Te esperamos en ${d.marca} ${d.sede}. Estos son los datos de tu turno:`],
    detalle: detalleTurno(d),
    nota: `${CONTACTO} Te pedimos llegar unos minutos antes.`,
  });
}

export function emailReservaCancelada(d: DatosEmailReserva): MensajeEmail {
  const { fecha, hora } = fechaHora(d.items[0]!.inicio, d.timezone);
  return armar(d.marca, `Tu turno del ${fecha}, ${hora} h en ${d.marca} ${d.sede} fue cancelado`, {
    titulo: "Tu turno fue cancelado",
    parrafos: [saludo(d.cliente), "Cancelamos este turno:"],
    detalle: detalleTurno(d),
    nota: "Si no pediste la cancelación o querés reservar otro horario, comunicate con la sede. Si habías pagado una seña, la sede te va a contactar por la devolución.",
  });
}

export function emailReservaReprogramada(d: DatosEmailReserva & { anterior: Date }): MensajeEmail {
  const { fecha, hora } = fechaHora(d.items[0]!.inicio, d.timezone);
  const antes = fechaHora(d.anterior, d.timezone);
  return armar(d.marca, `Cambiamos tu turno en ${d.marca} ${d.sede}: ahora es el ${fecha}, ${hora} h`, {
    titulo: "Tu turno cambió de horario",
    parrafos: [saludo(d.cliente), `Tu turno del ${antes.fecha} a las ${antes.hora} h quedó reprogramado. Estos son los datos nuevos:`],
    detalle: detalleTurno(d),
    nota: `El horario anterior ya no está reservado. ${CONTACTO}`,
  });
}

// ─── Acceso al backoffice ────────────────────────────────────────────────────

export function emailRecuperacion(d: { marca: string; nombre: string; enlace: string; minutos: number }): MensajeEmail {
  const url = enlaceSeguro(d.enlace);
  if (!url) throw new Error("Enlace de recuperación inválido");
  return armar(d.marca, `Elegí una nueva contraseña para ${d.marca}`, {
    titulo: "Recuperá tu acceso",
    parrafos: [saludo(d.nombre), `Recibimos un pedido para cambiar la contraseña de tu usuario en ${d.marca}. Para elegir una nueva, usá este enlace:`],
    boton: { texto: "Elegir nueva contraseña", url },
    nota: `El enlace vale una sola vez y vence en ${d.minutos} minutos. Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.`,
  });
}
