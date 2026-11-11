// Grilla del día de Tratamientos (doc 31, etapa 4): lo que el servidor le pasa a la pantalla y las cuentas
// que la pantalla hace para resaltar inicios libres y huecos. Todos los horarios van en minutos desde la
// medianoche de la fecha mirada, en la zona de la sede; el servidor los vuelve a convertir al operar.
// Es orientativo: el motor revalida todo con locks al reservar o mover, y si rechaza se muestra el motivo.

import type { EstadoGrilla } from "@nailnet/database/agenda-dia";

export type Intervalo = { desde: number; hasta: number };
export type Requisito = { tipoRecursoId: string; cantidad: number };

export type TurnoGrilla = {
  reservaId: string; itemId: string; posicion: number; itemsDeLaReserva: number;
  profesionalId: string; recursoIds: string[]; servicioId: string; servicio: string;
  inicio: number; fin: number; ocupaDesde: number; ocupaHasta: number;
  cliente: { id: string; nombre: string; telefono: string | null } | null;
  notas: string | null; online: boolean; estado: EstadoGrilla; expira: number | null; terminado: boolean;
};

export type DestinoGrilla = {
  profesionalIds: string[];
  inicios: { inicio: number; fin: number; items: { recursos: (Requisito & { libres: string[] })[] }[] }[];
};

export type Moviendo = {
  reservaId: string; cliente: string; servicios: string; desde: string;
  /** null mientras no hay destinos (por ejemplo, el turno ya no se puede mover). */
  destinos: DestinoGrilla[] | null; error: string | null;
};

export type DatosGrilla = {
  fecha: string; hoy: string; esHoy: boolean; ahora: number | null; paso: number;
  apertura: Intervalo[];
  profesionales: { id: string; nombre: string; servicioIds: string[]; disponible: Intervalo[]; ausencias: (Intervalo & { motivo: string | null })[] }[];
  servicios: { id: string; nombre: string; duracion: number; recursos: Requisito[] }[];
  recursos: { id: string; nombre: string; tipoRecursoId: string; tipo: string }[];
  turnos: TurnoGrilla[];
  moviendo: Moviendo | null;
  vista: "profesional" | "cabina";
  /** Parámetros de la URL que se conservan al navegar (universo, fecha, vista, mover). */
  parametros: Record<string, string>;
  puede: { cobrar: boolean; verClientes: boolean; crearClientes: boolean };
};

export const cruzan = (a: Intervalo, b: Intervalo) => a.desde < b.hasta && b.desde < a.hasta;
export const dentro = (x: Intervalo, en: readonly Intervalo[]) => en.some(e => e.desde <= x.desde && x.hasta <= e.hasta);

/** Intersección de dos listas de intervalos ordenados. */
export function interseccion(a: readonly Intervalo[], b: readonly Intervalo[]): Intervalo[] {
  const r: Intervalo[] = [];
  for (const x of a) for (const y of b) {
    const desde = Math.max(x.desde, y.desde), hasta = Math.min(x.hasta, y.hasta);
    if (desde < hasta) r.push({ desde, hasta });
  }
  return r.sort((x, y) => x.desde - y.desde);
}

/** Lo que queda de `base` sacando `quitar`. */
export function restar(base: readonly Intervalo[], quitar: readonly Intervalo[]): Intervalo[] {
  let r = [...base];
  for (const q of quitar) r = r.flatMap(x => !cruzan(x, q) ? [x] : [
    ...(x.desde < q.desde ? [{ desde: x.desde, hasta: q.desde }] : []),
    ...(q.hasta < x.hasta ? [{ desde: q.hasta, hasta: x.hasta }] : []),
  ]);
  return r;
}

/** Las reservas que ocupan agenda (todas las de la grilla: la ausente también, como en el motor). */
const ocupaciones = (turnos: readonly TurnoGrilla[], filtro: (t: TurnoGrilla) => boolean) =>
  turnos.filter(filtro).map(t => ({ desde: t.ocupaDesde, hasta: t.ocupaHasta }));

export function crearCuentas(d: DatosGrilla) {
  const profesional = new Map(d.profesionales.map(p => [p.id, p]));
  const servicio = new Map(d.servicios.map(s => [s.id, s]));
  const recurso = new Map(d.recursos.map(r => [r.id, r]));
  // Desde cuándo se puede reservar: hoy, desde el próximo paso; otro día pasado, nunca.
  const desdeMin = d.fecha < d.hoy ? Infinity : d.esHoy && d.ahora !== null ? Math.ceil(d.ahora / d.paso) * d.paso : -Infinity;

  const profesionalLibre = (id: string, x: Intervalo, ignorar?: string) => {
    const p = profesional.get(id);
    if (!p || !dentro(x, p.disponible) || p.ausencias.some(a => cruzan(a, x))) return false;
    return !ocupaciones(d.turnos, t => t.profesionalId === id && t.reservaId !== ignorar).some(o => cruzan(o, x));
  };
  const cabinaLibre = (id: string, x: Intervalo) => dentro(x, d.apertura) && !ocupaciones(d.turnos, t => t.recursoIds.includes(id)).some(o => cruzan(o, x));
  /** Cabinas libres de cada requisito del servicio en el intervalo. */
  const cabinasLibres = (servicioId: string, x: Intervalo) => (servicio.get(servicioId)?.recursos ?? []).map(q => ({
    ...q, libres: d.recursos.filter(r => r.tipoRecursoId === q.tipoRecursoId && cabinaLibre(r.id, x)).map(r => r.id),
  }));
  const hayCabinas = (servicioId: string, x: Intervalo, cabinaId?: string) => cabinasLibres(servicioId, x).every(q =>
    q.libres.length >= q.cantidad && (!cabinaId || recurso.get(cabinaId)?.tipoRecursoId !== q.tipoRecursoId || q.libres.includes(cabinaId)));
  const usaCabina = (servicioId: string, cabinaId: string) => (servicio.get(servicioId)?.recursos ?? []).some(q => q.tipoRecursoId === recurso.get(cabinaId)?.tipoRecursoId);

  /** Para «Nuevo turno»: si el servicio entra a esa hora con esa profesional (y en esa cabina, si se partió de una). */
  const entra = (servicioId: string, profesionalId: string, inicio: number, cabinaId?: string) => {
    const s = servicio.get(servicioId);
    if (!s || inicio < desdeMin || !profesional.get(profesionalId)?.servicioIds.includes(servicioId)) return false;
    const x = { desde: inicio, hasta: inicio + s.duracion };
    if (cabinaId && !usaCabina(servicioId, cabinaId)) return false;
    return profesionalLibre(profesionalId, x) && hayCabinas(servicioId, x, cabinaId);
  };
  /** Un inicio de la grilla se ofrece si entra algún servicio de la profesional (o de alguien en esa cabina). */
  const inicioLibreProfesional = (profesionalId: string, inicio: number) =>
    (profesional.get(profesionalId)?.servicioIds ?? []).some(s => entra(s, profesionalId, inicio));
  const inicioLibreCabina = (cabinaId: string, inicio: number) =>
    d.servicios.some(s => usaCabina(s.id, cabinaId) && d.profesionales.some(p => entra(s.id, p.id, inicio, cabinaId)));

  /** Huecos de una hora o más por profesional, para ofrecer por teléfono. */
  const huecos = () => d.profesionales.filter(p => p.servicioIds.length).flatMap(p => {
    const ocupado = [...p.ausencias, ...ocupaciones(d.turnos, t => t.profesionalId === p.id)];
    return restar(p.disponible, ocupado)
      .map(x => ({ desde: Math.max(x.desde, Math.ceil(Math.max(x.desde, desdeMin) / d.paso) * d.paso), hasta: x.hasta }))
      .filter(x => x.hasta - x.desde >= 60)
      .map(x => ({ ...x, profesionalId: p.id, nombre: p.nombre }));
  }).sort((a, b) => a.desde - b.desde || a.nombre.localeCompare(b.nombre));

  return { profesional, servicio, recurso, desdeMin, profesionalLibre, cabinaLibre, cabinasLibres, entra, usaCabina, inicioLibreProfesional, inicioLibreCabina, huecos };
}

export const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
export const duracion = (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
