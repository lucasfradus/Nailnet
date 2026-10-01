import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc, validarFecha } from "@nailnet/domain/agenda";
import { servicioEfectivo, type Sena } from "@nailnet/domain/catalogo";
import { aIntervalos, aperturaDelDia, asignarEn, buscarTurnos, jornadaDelDia, type Consulta, type DatosProfesional, type Intervalo, type Turno } from "@nailnet/domain/disponibilidad";
import type { Database } from "./client.ts";
import type { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, exigirIds, sedesConPermiso } from "./access.ts";
import { configuracionEfectiva } from "./configuracion.ts";

type Db = Database | Prisma.TransactionClient;
export type Canal = "ONLINE" | "RECEPCION";
export type Pedido = { sedeId: string; fecha: string; canal: Canal; items: { servicioId: string; profesionalId?: string | null }[] };

/** Falta configuración que el negocio todavía no definió: el motor no supone valores. */
export class ConfiguracionIncompleta extends Error {
  constructor(public faltantes: string[]) { super(`Configuración incompleta: ${faltantes.join(", ")}`); this.name = "ConfiguracionIncompleta"; }
}

/** Reservas que ocupan agenda: firmes o pendientes todavía vigentes. Una retención vencida no bloquea aunque el worker no la haya expirado. */
export function reservaActiva(ahora: Date): Prisma.ReservaWhereInput {
  return { OR: [{ estado: { in: ["CONFIRMADA", "ATENDIDA", "AUSENTE"] } }, { estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { gt: ahora } }] };
}
const fecha = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
const senaDe = (tipo: string | null, valor: Prisma.Decimal | null): Sena => (tipo ? { tipo: tipo as "FIJA", valor: valor === null ? null : tipo === "PORCENTAJE" ? valor.toFixed(0) : valor.toFixed(2) } : null);
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const MARGEN = 4 * 3_600_000;

/**
 * Arma la consulta del motor desde la base para un pedido ya autorizado. Se usa igual para mostrar
 * turnos y, dentro de la transacción con locks, para revalidar una retención (C05).
 */
export async function cargarConsulta(db: Db, organizacionId: string, pedido: Pedido, ahora: Date) {
  const { sedeId, canal } = pedido;
  if (!validarFecha(pedido.fecha)) throw new DatosInvalidos("Fecha inválida");
  if (!pedido.items.length || pedido.items.length > 4) throw new DatosInvalidos("Elegí entre 1 y 4 servicios");
  exigirIds(sedeId, ...pedido.items.flatMap(i => [i.servicioId, i.profesionalId]));
  const sede = await db.sede.findFirst({ where: { id: sedeId, organizacionId, activo: true, franquiciado: { activo: true } }, select: { timezone: true } });
  if (!sede) throw new AccesoDenegado();
  const tz = sede.timezone;

  const config = await configuracionEfectiva(db, organizacionId, sedeId);
  const faltan: string[] = [];
  if (config.pasoGrillaMinutos.valor === null) faltan.push("intervalo entre inicios de turno (D17)");
  if (canal === "ONLINE" && config.horizonteReservaDias.valor === null) faltan.push("horizonte de reserva (D18)");
  if (canal === "ONLINE" && config.anticipacionMinimaMinutos.valor === null) faltan.push("anticipación mínima (D18)");
  if (faltan.length) throw new ConfiguracionIncompleta(faltan);

  // Ventana de inicios admitidos: online respeta anticipación y horizonte; recepción, solo el presente.
  const hoy = aLocal(ahora, tz).fecha;
  const desdeMs = ahora.getTime() + (canal === "ONLINE" ? config.anticipacionMinimaMinutos.valor! * 60_000 : 0);
  const fueraDeHorizonte = canal === "ONLINE" && pedido.fecha > sumarDias(hoy, config.horizonteReservaDias.valor!);

  const ids = [...new Set(pedido.items.map(i => i.servicioId))];
  const servicios = await db.servicio.findMany({
    where: { id: { in: ids }, organizacionId },
    include: { sedes: { where: { sedeId } }, skills: { select: { skillId: true } }, recursos: { select: { tipoRecursoId: true, cantidad: true } } },
  });
  const efectivos = new Map(servicios.map(s => {
    const ss = s.sedes[0];
    const e = servicioEfectivo(
      { duracionMinutos: s.duracionMinutos, bufferAntesMinutos: s.bufferAntesMinutos, bufferDespuesMinutos: s.bufferDespuesMinutos, sena: senaDe(s.senaTipo, s.senaValor), activo: s.activo },
      ss ? { habilitado: ss.habilitado, precio: ss.precio?.toFixed(2) ?? null, duracionMinutos: ss.duracionMinutos, sena: senaDe(ss.senaTipo, ss.senaValor), reservableOnline: ss.reservableOnline } : null,
    );
    return [s.id, { ...e, servicio: s }];
  }));
  for (const i of pedido.items) {
    const e = efectivos.get(i.servicioId);
    if (!e?.habilitado) throw new DatosInvalidos("Hay un servicio que no está disponible en esta sede");
    if (canal === "ONLINE" && !e.reservableOnline) throw new DatosInvalidos("Hay un servicio que no se reserva online en esta sede");
  }

  // Candidatos: activos, vinculados a la sede, habilitados para el servicio y con TODAS sus skills.
  const profesionales = await db.profesional.findMany({
    where: { organizacionId, activo: true, sedes: { some: { sedeId, activo: true } }, servicios: { some: { servicioId: { in: ids } } } },
    include: { skills: { select: { skillId: true } }, servicios: { select: { servicioId: true } } },
  });
  const aptos = (servicioId: string) => {
    const req = efectivos.get(servicioId)!.servicio.skills.map(s => s.skillId);
    return profesionales.filter(p => p.servicios.some(s => s.servicioId === servicioId) && req.every(r => p.skills.some(s => s.skillId === r))).map(p => p.id);
  };

  const inicioDia = aUtc(pedido.fecha, 0, tz).getTime(), finDia = aUtc(pedido.fecha, 1440, tz).getTime();
  const ventana = { gte: new Date(inicioDia - MARGEN), lt: new Date(finDia + MARGEN) };
  const profIds = profesionales.map(p => p.id);
  const [horarios, ocupaciones, bloqueos, horarioSede, excepciones] = await Promise.all([
    db.horarioProfesional.findMany({ where: { profesionalId: { in: profIds }, sedeId } }),
    db.reservaItem.findMany({ where: { profesionalId: { in: profIds }, ocupaDesde: { lt: ventana.lt }, ocupaHasta: { gt: ventana.gte }, reserva: reservaActiva(ahora) }, select: { profesionalId: true, ocupaDesde: true, ocupaHasta: true } }),
    db.bloqueoAgenda.findMany({ where: { profesionalId: { in: profIds }, inicio: { lt: ventana.lt }, fin: { gt: ventana.gte } } }),
    db.horarioSede.findMany({ where: { sedeId } }),
    db.excepcionHorario.findMany({ where: { organizacionId, fecha: new Date(`${pedido.fecha}T00:00:00Z`), OR: [{ sedeId }, { sedeId: null }] } }),
  ]);
  const semanal = <T extends { diaSemana: number; inicioMinutos: number; finMinutos: number; vigenteDesde: Date | null; vigenteHasta: Date | null }>(f: T) =>
    ({ diaSemana: f.diaSemana, inicioMinutos: f.inicioMinutos, finMinutos: f.finMinutos, vigenteDesde: fecha(f.vigenteDesde), vigenteHasta: fecha(f.vigenteHasta) });
  const apertura = aIntervalos(aperturaDelDia(horarioSede.map(semanal), excepciones.filter(e => e.sedeId), excepciones.filter(e => !e.sedeId), pedido.fecha), pedido.fecha, tz);

  const datos = new Map<string, DatosProfesional>(profIds.map(id => {
    const ocupado: Intervalo[] = [
      ...ocupaciones.filter(o => o.profesionalId === id).map(o => ({ desde: o.ocupaDesde.getTime(), hasta: o.ocupaHasta.getTime() })),
      ...bloqueos.filter(b => b.profesionalId === id).map(b => ({ desde: b.inicio.getTime(), hasta: b.fin.getTime() })),
    ];
    // Carga del día para «cualquiera»: minutos ya ocupados por turnos en esa fecha local, en cualquier sede.
    const carga = ocupaciones.filter(o => o.profesionalId === id).reduce((m, o) => m + Math.max(0, Math.min(o.ocupaHasta.getTime(), finDia) - Math.max(o.ocupaDesde.getTime(), inicioDia)), 0) / 60_000;
    return [id, { jornada: aIntervalos(jornadaDelDia(horarios.filter(h => h.profesionalId === id).map(semanal), pedido.fecha), pedido.fecha, tz), ocupado, cargaMinutos: carga }];
  }));

  const tipos = [...new Set(servicios.flatMap(s => s.recursos.map(r => r.tipoRecursoId)))];
  const recursos = tipos.length ? await db.recurso.findMany({
    where: { sedeId, activo: true, tipoRecursoId: { in: tipos } },
    include: {
      ocupaciones: { where: { ocupaDesde: { lt: ventana.lt }, ocupaHasta: { gt: ventana.gte }, item: { reserva: reservaActiva(ahora) } }, select: { ocupaDesde: true, ocupaHasta: true } },
      bloqueos: { where: { inicio: { lt: ventana.lt }, fin: { gt: ventana.gte } }, select: { inicio: true, fin: true } },
    },
  }) : [];

  const consulta: Consulta = {
    fecha: pedido.fecha, tz, pasoMinutos: config.pasoGrillaMinutos.valor!, apertura,
    items: pedido.items.map(i => {
      const e = efectivos.get(i.servicioId)!;
      const candidatos = aptos(i.servicioId);
      return {
        servicioId: i.servicioId, duracionMinutos: e.duracionMinutos, bufferAntesMinutos: e.bufferAntesMinutos, bufferDespuesMinutos: e.bufferDespuesMinutos,
        requisitos: e.servicio.recursos, candidatos: i.profesionalId ? candidatos.filter(c => c === i.profesionalId) : candidatos,
      };
    }),
    profesionales: datos,
    recursos: recursos.map(r => ({ id: r.id, tipoRecursoId: r.tipoRecursoId, ocupado: [...r.ocupaciones.map(o => ({ desde: o.ocupaDesde.getTime(), hasta: o.ocupaHasta.getTime() })), ...r.bloqueos.map(b => ({ desde: b.inicio.getTime(), hasta: b.fin.getTime() }))] })),
    desdeMs, hastaMs: fueraDeHorizonte ? -1 : null,
  };
  return { consulta, efectivos, nombres: new Map(profesionales.map(p => [p.id, [p.nombre, p.apellido].filter(Boolean).join(" ")])) };
}

function presentar(turno: Turno, nombres: Map<string, string>) {
  return {
    inicio: new Date(turno.inicio).toISOString(), fin: new Date(turno.fin).toISOString(),
    items: turno.items.map(i => ({ servicioId: i.servicioId, profesionalId: i.profesionalId, profesional: nombres.get(i.profesionalId)!, inicio: new Date(i.inicio).toISOString(), fin: new Date(i.fin).toISOString(), recursoIds: i.recursoIds })),
  };
}

/** Turnos de una fecha para recepción (con actor) o para el portal (actor null, solo canal ONLINE). */
export async function consultarDisponibilidad(db: Database, actorId: string | null, organizacionId: string, pedido: Pedido, ahora = new Date()) {
  if (actorId) {
    const { ids } = await sedesConPermiso(db, actorId, organizacionId, "sede:leer");
    exigirIds(pedido.sedeId);
    if (!ids.has(pedido.sedeId)) throw new AccesoDenegado();
  } else if (pedido.canal !== "ONLINE") throw new AccesoDenegado();
  const { consulta, nombres } = await cargarConsulta(db, organizacionId, pedido, ahora);
  return buscarTurnos(consulta).map(t => presentar(t, nombres));
}

export { asignarEn };
