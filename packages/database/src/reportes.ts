// L03 · Reportes de una sede para un período de fechas locales. Ver docs/30-reportes.md.
// Solo lectura. Cada sección declara su fecha de corte: ventas por fecha de venta, cobros por fecha del
// cobro, turnos por el inicio del primer servicio, base comisionable por la fecha en que la venta quedó
// cobrada completa. Dinero en centavos (bigint); nunca Number.
import { AccesoDenegado, cubreSede, tienePermiso } from "@nailnet/domain";
import { aUtc } from "@nailnet/domain/agenda";
import { aIntervalos, aperturaDelDia, jornadaDelDia, ocupacionDelDia, type Intervalo } from "@nailnet/domain/disponibilidad";
import { sumarDias, validarPeriodo } from "@nailnet/domain/gastos";
import { minutosEnVentana, porcentaje, promedio, prorratearDescuento } from "@nailnet/domain/reportes";
import type { MedioCobro } from "@nailnet/domain/ventas";
import type { Database } from "./client.ts";
import { DatosInvalidos, asignacionesActor, exigirIds, mapaSedes } from "./access.ts";
import { centavos } from "./caja.ts";
import { semanal } from "./disponibilidad.ts";

const MARGEN = 4 * 3_600_000;
const nombre = (p: { nombre: string; apellido: string | null }) => [p.nombre, p.apellido].filter(Boolean).join(" ");
const sumar = <K>(m: Map<K, bigint>, k: K, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);

export async function reporteSede(db: Database, actorId: string, organizacionId: string, filtro: { sedeId: string; desde: string; hasta: string }, ahora = new Date()) {
  exigirIds(filtro.sedeId);
  const error = validarPeriodo(filtro.desde, filtro.hasta);
  if (error) throw new DatosInvalidos(error);
  const actor = await asignacionesActor(db, actorId, organizacionId);
  const franquiciadoDe = await mapaSedes(db, organizacionId);
  if (!actor.some(a => tienePermiso(a, "reporte:leer") && cubreSede(a, filtro.sedeId, franquiciadoDe))) throw new AccesoDenegado();
  const sede = await db.sede.findFirstOrThrow({ where: { id: filtro.sedeId, organizacionId }, select: { id: true, nombre: true, timezone: true } });
  const { desde, hasta } = filtro;
  const periodo = { gte: aUtc(desde, 0, sede.timezone), lt: aUtc(sumarDias(hasta, 1), 0, sede.timezone) };
  const base = { organizacionId, sedeId: sede.id };

  return {
    sede, desde, hasta,
    ventas: await ventas(db, base, desde, hasta),
    cobros: await cobros(db, base, periodo),
    turnos: await turnos(db, base, periodo),
    ocupacion: await ocupacion(db, base, desde, hasta, sede.timezone, ahora),
    clientes: await clientes(db, base, periodo),
    comisiones: await comisiones(db, base, periodo),
    recepcion: await recepcion(db, base, periodo, ahora),
  };
}
export type ReporteSede = Awaited<ReturnType<typeof reporteSede>>;
type Base = { organizacionId: string; sedeId: string };

// ─── Ventas: por fecha de venta, netas de descuento ───────────────────────────

const conItems = { items: { orderBy: { posicion: "asc" }, include: { servicio: { select: { nombre: true } }, profesional: { select: { nombre: true, apellido: true } } } } } as const;

/** Líneas de una venta con su parte del descuento ya restada. */
function lineasNetas<T extends { subtotal: Parameters<typeof centavos>[0] }>(v: { descuento: Parameters<typeof centavos>[0]; items: T[] }) {
  const brutos = v.items.map(i => centavos(i.subtotal));
  const descuentos = prorratearDescuento(brutos, centavos(v.descuento));
  return v.items.map((item, k) => ({ item, bruto: brutos[k]!, descuento: descuentos[k]!, neto: brutos[k]! - descuentos[k]! }));
}

async function ventas(db: Database, base: Base, desde: string, hasta: string) {
  const filas = await db.venta.findMany({ where: { ...base, fecha: { gte: new Date(`${desde}T00:00:00Z`), lte: new Date(`${hasta}T00:00:00Z`) } }, include: conItems });
  const vigentes = filas.filter(v => v.estado !== "ANULADA");
  const anuladas = filas.filter(v => v.estado === "ANULADA");
  const completadas = vigentes.filter(v => v.estado === "COMPLETADA");
  const total = (xs: typeof filas) => xs.reduce((m, v) => m + centavos(v.total), 0n);
  const porServicio = new Map<string, { nombre: string; cantidad: number; neto: bigint }>();
  const porProfesional = new Map<string, { nombre: string; servicios: number; neto: bigint }>();
  let servicios = 0n, productos = 0n;
  for (const v of vigentes) for (const { item, neto } of lineasNetas(v)) {
    if (item.tipo === "PRODUCTO") { productos += neto; continue; }
    servicios += neto;
    const s = porServicio.get(item.servicioId!) ?? { nombre: item.servicio?.nombre ?? item.descripcion, cantidad: 0, neto: 0n };
    porServicio.set(item.servicioId!, { ...s, cantidad: s.cantidad + 1, neto: s.neto + neto });
    const p = porProfesional.get(item.profesionalId!) ?? { nombre: item.profesional ? nombre(item.profesional) : "—", servicios: 0, neto: 0n };
    porProfesional.set(item.profesionalId!, { ...p, servicios: p.servicios + 1, neto: p.neto + neto });
  }
  const totalCompletadas = total(completadas);
  const porNeto = <T extends { neto: bigint }>(a: T, b: T) => (a.neto === b.neto ? 0 : a.neto > b.neto ? -1 : 1);
  return {
    cantidad: vigentes.length, completadas: completadas.length, pendientes: vigentes.length - completadas.length,
    total: total(vigentes), descuentos: vigentes.reduce((m, v) => m + centavos(v.descuento), 0n), servicios, productos,
    // Ticket promedio (doc 02): ventas completadas, netas de descuento, sobre la cantidad de ventas completadas.
    ticketPromedio: completadas.length ? totalCompletadas / BigInt(completadas.length) : null,
    anuladas: { cantidad: anuladas.length, total: total(anuladas) },
    porServicio: [...porServicio.values()].sort(porNeto),
    porProfesional: [...porProfesional.values()].sort(porNeto),
  };
}

// ─── Cobros: por fecha del cobro; reversos aparte ─────────────────────────────

async function cobros(db: Database, base: Base, periodo: { gte: Date; lt: Date }) {
  const filas = await db.cobroVenta.findMany({ where: { ...base, createdAt: periodo }, select: { tipo: true, medio: true, monto: true } });
  const cobrado = new Map<MedioCobro, bigint>(), revertido = new Map<MedioCobro, bigint>();
  for (const c of filas) sumar(c.tipo === "REVERSO" ? revertido : cobrado, c.medio, centavos(c.monto));
  const medios = [...new Set([...cobrado.keys(), ...revertido.keys()])];
  const porMedio = medios.map(medio => ({ medio, cobrado: cobrado.get(medio) ?? 0n, revertido: revertido.get(medio) ?? 0n, neto: (cobrado.get(medio) ?? 0n) + (revertido.get(medio) ?? 0n) }))
    .sort((a, b) => (a.neto === b.neto ? 0 : a.neto > b.neto ? -1 : 1));
  // Señas: entran por Mercado Pago antes de la venta; en la venta se aplican como anticipo, no como cobro.
  const senas = await db.pago.findMany({ where: { ...base, aprobadoEn: periodo }, select: { monto: true } });
  return {
    porMedio, neto: porMedio.reduce((m, x) => m + x.neto, 0n), revertido: porMedio.reduce((m, x) => m + x.revertido, 0n),
    senas: { cantidad: senas.length, total: senas.reduce((m, p) => m + centavos(p.monto), 0n) },
  };
}

// ─── Turnos: por inicio del primer servicio de la reserva ─────────────────────

async function turnos(db: Database, base: Base, periodo: { gte: Date; lt: Date }) {
  const filas = await db.reserva.findMany({
    where: { ...base, items: { some: { posicion: 0, inicio: periodo } } },
    select: { estado: true, sinTurnoPrevio: true, reemplazadaPor: { select: { id: true } } },
  });
  const cuenta = (pred: (r: (typeof filas)[number]) => boolean) => filas.filter(pred).length;
  const atendidos = cuenta(r => r.estado === "ATENDIDA"), ausentes = cuenta(r => r.estado === "AUSENTE");
  // Una reprogramación cancela la reserva original y crea otra: cuenta la nueva, no como cancelación.
  const reprogramados = cuenta(r => r.estado === "CANCELADA" && r.reemplazadaPor !== null);
  const cancelados = cuenta(r => r.estado === "CANCELADA" && r.reemplazadaPor === null);
  const confirmados = cuenta(r => r.estado === "CONFIRMADA");
  const pendientes = cuenta(r => r.estado === "PENDIENTE_PAGO" || r.estado === "PAGO_EN_REVISION");
  // Las retenciones vencidas nunca fueron turnos: se informan pero no entran en el denominador.
  const expirados = cuenta(r => r.estado === "EXPIRADA");
  const total = atendidos + ausentes + cancelados + confirmados + pendientes;
  return {
    total, atendidos, ausentes, cancelados, confirmados, pendientes, reprogramados, expirados,
    sinTurnoPrevio: cuenta(r => r.estado === "ATENDIDA" && r.sinTurnoPrevio),
    tasaCancelacion: porcentaje(cancelados, total), tasaAusentismo: porcentaje(ausentes, atendidos + ausentes),
  };
}

// ─── Ocupación: firmes sobre disponible; pendientes aparte ────────────────────

const FIRMES = ["CONFIRMADA", "ATENDIDA", "AUSENTE"] as const;

async function ocupacion(db: Database, base: Base, desde: string, hasta: string, tz: string, ahora: Date) {
  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  const ventana = { gte: new Date(aUtc(desde, 0, tz).getTime() - MARGEN), lt: new Date(aUtc(sumarDias(hasta, 1), 0, tz).getTime() + MARGEN) };
  const profesionales = await db.profesional.findMany({ where: { organizacionId: base.organizacionId, sedes: { some: { sedeId: base.sedeId } } }, select: { id: true, nombre: true, apellido: true } });
  const profIds = profesionales.map(p => p.id);
  const [horarios, items, bloqueos, horarioSede, excepciones] = await Promise.all([
    db.horarioProfesional.findMany({ where: { profesionalId: { in: profIds }, sedeId: base.sedeId } }),
    db.reservaItem.findMany({
      where: { profesionalId: { in: profIds }, ocupaDesde: { lt: ventana.lt }, ocupaHasta: { gt: ventana.gte }, reserva: { OR: [{ estado: { in: [...FIRMES] } }, { estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { gt: ahora } }] } },
      select: { profesionalId: true, ocupaDesde: true, ocupaHasta: true, reserva: { select: { estado: true } } },
    }),
    db.bloqueoAgenda.findMany({ where: { profesionalId: { in: profIds }, inicio: { lt: ventana.lt }, fin: { gt: ventana.gte } } }),
    db.horarioSede.findMany({ where: { sedeId: base.sedeId } }),
    db.excepcionHorario.findMany({ where: { organizacionId: base.organizacionId, fecha: { gte: new Date(`${desde}T00:00:00Z`), lte: new Date(`${hasta}T00:00:00Z`) }, OR: [{ sedeId: base.sedeId }, { sedeId: null }] } }),
  ]);
  const semana = horarioSede.map(semanal);
  const intervalo = (d: Date, h: Date): Intervalo => ({ desde: d.getTime(), hasta: h.getTime() });
  const esFirme = (estado: string) => (FIRMES as readonly string[]).includes(estado);
  const filas = profesionales.map(p => {
    const jornada = horarios.filter(h => h.profesionalId === p.id).map(semanal);
    const propios = items.filter(i => i.profesionalId === p.id);
    const firmes = propios.filter(i => esFirme(i.reserva.estado)).map(i => intervalo(i.ocupaDesde, i.ocupaHasta));
    const pendientes = propios.filter(i => !esFirme(i.reserva.estado)).map(i => intervalo(i.ocupaDesde, i.ocupaHasta));
    const ausencias = bloqueos.filter(b => b.profesionalId === p.id).map(b => intervalo(b.inicio, b.fin));
    let disponibleMinutos = 0, ocupadoMinutos = 0, pendienteMinutos = 0;
    for (const dia of dias) {
      const delDia = excepciones.filter(e => e.fecha.toISOString().slice(0, 10) === dia);
      const apertura = aIntervalos(aperturaDelDia(semana, delDia.filter(e => e.sedeId), delDia.filter(e => !e.sedeId), dia), dia, tz);
      const datos = { apertura, jornada: aIntervalos(jornadaDelDia(jornada, dia), dia, tz), bloqueos: ausencias };
      const f = ocupacionDelDia({ ...datos, turnos: firmes });
      disponibleMinutos += f.disponibleMinutos;
      ocupadoMinutos += f.ocupadoMinutos;
      pendienteMinutos += ocupacionDelDia({ ...datos, turnos: pendientes }).ocupadoMinutos;
    }
    return { nombre: nombre(p), disponibleMinutos, ocupadoMinutos, pendienteMinutos, porcentaje: porcentaje(ocupadoMinutos, disponibleMinutos) };
  }).filter(o => o.disponibleMinutos > 0).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const disponible = filas.reduce((m, o) => m + o.disponibleMinutos, 0), ocupado = filas.reduce((m, o) => m + o.ocupadoMinutos, 0);
  return { profesionales: filas, disponibleMinutos: disponible, ocupadoMinutos: ocupado, pendienteMinutos: filas.reduce((m, o) => m + o.pendienteMinutos, 0), porcentaje: porcentaje(ocupado, disponible) };
}

// ─── Clientes: nuevos = primera atención en la sede dentro del período ────────

async function clientes(db: Database, base: Base, periodo: { gte: Date; lt: Date }) {
  const atendidas = await db.reserva.findMany({ where: { ...base, estado: "ATENDIDA", items: { some: { posicion: 0, inicio: periodo } } }, select: { clienteId: true } });
  const ids = [...new Set(atendidas.flatMap(r => (r.clienteId ? [r.clienteId] : [])))];
  const previos = ids.length ? await db.reserva.findMany({
    where: { ...base, estado: "ATENDIDA", clienteId: { in: ids }, items: { some: { posicion: 0, inicio: { lt: periodo.gte } } } },
    select: { clienteId: true }, distinct: ["clienteId"],
  }) : [];
  return { atendidos: ids.length, recurrentes: previos.length, nuevos: ids.length - previos.length, atencionesSinCliente: atendidas.filter(r => !r.clienteId).length };
}

// ─── Recepción: lo que registra el tablero (doc 29) ───────────────────────────
// Presencia: minutos entre entrada y salida dentro del período (una abierta cuenta hasta ahora).
// Atención real: turnos terminados con «Terminó» en el período; cada servicio cuenta desde su inicio
// hasta que su profesional terminó. Estimado: lo que decía el catálogo. Espera: anotadas en el período.

/** Una atención «se pasó» si duró más que lo estimado más este margen. */
export const MARGEN_DEMORA_MINUTOS = 5;
const minutos = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

async function recepcion(db: Database, base: Base, periodo: { gte: Date; lt: Date }, ahora: Date) {
  const ventana = { desde: periodo.gte.getTime(), hasta: periodo.lt.getTime() };
  const presencias = await db.presenciaProfesional.findMany({
    where: { ...base, entrada: { lt: periodo.lt }, OR: [{ salida: null }, { salida: { gt: periodo.gte } }] },
    select: { profesionalId: true, entrada: true, salida: true, profesional: { select: { nombre: true, apellido: true } } },
  });
  const atenciones = await db.reserva.findMany({
    where: { ...base, estado: "ATENDIDA", terminadaEn: periodo, iniciadaEn: { not: null } },
    select: { id: true, iniciadaEn: true, terminadaEn: true, items: { select: { profesionalId: true, inicio: true, fin: true, duracionMinutos: true, terminadoEn: true, profesional: { select: { nombre: true, apellido: true } } } } },
  });
  const esperas = await db.esperaRecepcion.findMany({ where: { ...base, llegada: periodo }, select: { estado: true, llegada: true, cerradaEn: true } });

  const porProfesional = new Map<string, { nombre: string; presenteMinutos: number; atendiendoMinutos: number; atenciones: Set<string> }>();
  const fila = (id: string, p: { nombre: string; apellido: string | null }) => porProfesional.get(id) ?? porProfesional.set(id, { nombre: nombre(p), presenteMinutos: 0, atendiendoMinutos: 0, atenciones: new Set() }).get(id)!;
  for (const p of presencias) fila(p.profesionalId, p.profesional).presenteMinutos += minutosEnVentana(p.entrada.getTime(), p.salida?.getTime() ?? null, ventana, ahora.getTime());
  const reales: number[] = [], estimadas: number[] = [];
  let demoradas = 0;
  for (const a of atenciones) {
    for (const i of a.items) {
      const f = fila(i.profesionalId, i.profesional);
      f.atendiendoMinutos += Math.max(0, minutos(i.inicio, i.terminadoEn ?? i.fin));
      f.atenciones.add(a.id);
    }
    const real = minutos(a.iniciadaEn!, a.terminadaEn!);
    const primero = Math.min(...a.items.map(i => i.inicio.getTime()));
    const estimada = (Math.max(...a.items.map(i => i.inicio.getTime() + i.duracionMinutos * 60_000)) - primero) / 60_000;
    reales.push(real); estimadas.push(estimada);
    if (real > estimada + MARGEN_DEMORA_MINUTOS) demoradas++;
  }
  const profesionales = [...porProfesional.values()]
    .map(p => ({ nombre: p.nombre, presenteMinutos: p.presenteMinutos, atendiendoMinutos: p.atendiendoMinutos, atenciones: p.atenciones.size, porcentaje: porcentaje(p.atendiendoMinutos, p.presenteMinutos) }))
    // Una presencia abierta de otro día aparece en la consulta pero no suma nada en este período.
    .filter(p => p.presenteMinutos > 0 || p.atenciones > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const atendidas = esperas.filter(e => e.estado === "ATENDIDA"), seFueron = esperas.filter(e => e.estado === "SE_FUE").length;
  const tiempos = atendidas.map(e => minutos(e.llegada, e.cerradaEn!));
  return {
    profesionales,
    atenciones: { cantidad: atenciones.length, duracionReal: promedio(reales), duracionEstimada: promedio(estimadas), demoradas },
    espera: {
      anotadas: esperas.length, atendidas: atendidas.length, seFueron, sinCerrar: esperas.filter(e => e.estado === "ESPERANDO").length,
      promedioMinutos: promedio(tiempos), maximoMinutos: tiempos.length ? Math.round(Math.max(...tiempos)) : null,
      tasaAbandono: porcentaje(seFueron, atendidas.length + seFueron),
    },
  };
}

// ─── Base comisionable: servicios de ventas cobradas completas en el período ──
// Propuesta de D10 (doc 02): por servicio atendido y totalmente cobrado, después de descuento, sin
// productos. El porcentaje sigue pendiente, por eso se informa la base y no un importe a pagar.

async function comisiones(db: Database, base: Base, periodo: { gte: Date; lt: Date }) {
  const filas = await db.venta.findMany({ where: { ...base, estado: "COMPLETADA", completadaEn: periodo }, include: conItems });
  const porProfesional = new Map<string, { nombre: string; servicios: number; bruto: bigint; descuento: bigint; base: bigint }>();
  for (const v of filas) for (const { item, bruto, descuento, neto } of lineasNetas(v)) {
    if (item.tipo !== "SERVICIO") continue;
    const p = porProfesional.get(item.profesionalId!) ?? { nombre: item.profesional ? nombre(item.profesional) : "—", servicios: 0, bruto: 0n, descuento: 0n, base: 0n };
    porProfesional.set(item.profesionalId!, { ...p, servicios: p.servicios + 1, bruto: p.bruto + bruto, descuento: p.descuento + descuento, base: p.base + neto });
  }
  const profesionales = [...porProfesional.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { profesionales, base: profesionales.reduce((m, p) => m + p.base, 0n), servicios: profesionales.reduce((m, p) => m + p.servicios, 0) };
}
