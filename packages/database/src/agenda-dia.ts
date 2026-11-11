import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc, validarFecha } from "@nailnet/domain/agenda";
import { UNIVERSOS, type Universo } from "@nailnet/domain/catalogo";
import { aIntervalos, aperturaDelDia, buscarTurnos, jornadaDelDia, type Intervalo } from "@nailnet/domain/disponibilidad";
import type { Database } from "./client.ts";
import { DatosInvalidos, exigirIds, sedesConPermiso } from "./access.ts";
import { configuracionEfectiva } from "./configuracion.ts";
import { cargarConsulta, reservaActiva, semanal, type Pedido } from "./disponibilidad.ts";

// Grilla del día de Tratamientos (doc 31, etapa 4): lo que la pantalla necesita para mostrar un día por
// profesional o por cabina, y a dónde se puede mover un turno. Operar el turno sigue siendo lo de siempre
// (doc 17): `tomarTurno`, `reprogramarReserva`, `empezarSesion`, «Terminó», cancelar y ausente.

async function exigirSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  exigirIds(sedeId);
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(sedeId)) throw new AccesoDenegado();
}

const nombreDe = (p: { nombre: string; apellido: string | null }) => [p.nombre, p.apellido].filter(Boolean).join(" ");
const comoFechas = (xs: readonly Intervalo[]) => xs.map(x => ({ desde: new Date(x.desde), hasta: new Date(x.hasta) }));

/** Estado del turno para la grilla: un poco más fino que el de la reserva (en sesión, por cobrar, cobrado). */
export type EstadoGrilla = "PENDIENTE_PAGO" | "CONFIRMADA" | "EN_SESION" | "POR_COBRAR" | "COBRADA" | "AUSENTE";

/**
 * Un día de la sede para la grilla: apertura, paso, profesionales (con jornada y ausencias), servicios,
 * cabinas y turnos, uno por servicio. Con `universo`, solo lo de ese universo:
 * - profesionales con la misma regla que el tablero (hace algún servicio suyo; sin servicios, en los dos),
 *   más cualquiera que tenga un turno ese día en la grilla, aunque ya no haga el servicio;
 * - servicios habilitados en la sede del universo, y las unidades activas de los tipos que piden;
 * - turnos de las reservas que tienen algún servicio del universo (con todos sus servicios).
 * Sin `universo`, todo. Cancelados y vencidos no se muestran.
 */
export async function agendaDia(db: Database, actorId: string, organizacionId: string, filtro: { sedeId: string; fecha: string; universo?: Universo | null }, ahora = new Date()) {
  if (!validarFecha(filtro.fecha)) throw new DatosInvalidos("Fecha inválida");
  if (filtro.universo && !UNIVERSOS.includes(filtro.universo)) throw new DatosInvalidos("Universo inválido");
  await exigirSede(db, actorId, organizacionId, filtro.sedeId);
  const { sedeId, fecha } = filtro;
  const universo = filtro.universo ?? null;
  const sede = await db.sede.findFirst({ where: { id: sedeId, organizacionId }, select: { timezone: true } });
  if (!sede) throw new AccesoDenegado();
  const tz = sede.timezone;
  const inicioDia = aUtc(fecha, 0, tz), finDia = aUtc(fecha, 1440, tz);
  const config = await configuracionEfectiva(db, organizacionId, sedeId);

  const horarioSede = await db.horarioSede.findMany({ where: { sedeId } });
  const excepciones = await db.excepcionHorario.findMany({ where: { organizacionId, fecha: new Date(`${fecha}T00:00:00Z`), OR: [{ sedeId }, { sedeId: null }] } });
  const apertura = aIntervalos(aperturaDelDia(horarioSede.map(semanal), excepciones.filter(e => e.sedeId), excepciones.filter(e => !e.sedeId), fecha), fecha, tz);

  const ofrecidos = await db.servicioSede.findMany({
    where: { organizacionId, sedeId, habilitado: true, servicio: { activo: true } },
    select: { duracionMinutos: true, servicio: { select: { id: true, nombre: true, duracionMinutos: true, skills: { select: { skillId: true } }, recursos: { select: { tipoRecursoId: true, cantidad: true } }, categoria: { select: { universo: true } } } } },
    orderBy: { servicio: { nombre: "asc" } },
  });
  const universoDe = new Map(ofrecidos.map(s => [s.servicio.id, s.servicio.categoria.universo as Universo]));
  const delUniverso = ofrecidos.filter(s => !universo || s.servicio.categoria.universo === universo);

  // Turnos del día: por el inicio de cada servicio, como la agenda de la sede (doc 17).
  const filas = await db.reservaItem.findMany({
    where: { organizacionId, inicio: { gte: inicioDia, lt: finDia }, reserva: { AND: [{ sedeId }, reservaActiva(ahora)] } },
    select: {
      id: true, reservaId: true, posicion: true, profesionalId: true, inicio: true, fin: true, ocupaDesde: true, ocupaHasta: true, terminadoEn: true, servicioId: true,
      servicio: { select: { nombre: true, categoria: { select: { universo: true } } } },
      recursos: { select: { recursoId: true }, orderBy: { recursoId: "asc" } },
      reserva: { select: {
        estado: true, canal: true, expiraEn: true, notas: true, iniciadaEn: true,
        cliente: { select: { id: true, nombre: true, apellido: true, telefono: true } },
        _count: { select: { items: true, ventas: { where: { estado: { not: "ANULADA" } } } } },
      } },
    },
    orderBy: [{ inicio: "asc" }, { posicion: "asc" }],
  });
  const reservasDelUniverso = new Set(filas.filter(f => !universo || f.servicio.categoria.universo === universo).map(f => f.reservaId));
  const turnos = filas.filter(f => reservasDelUniverso.has(f.reservaId)).map(f => {
    const r = f.reserva;
    const estado: EstadoGrilla =
      r.estado === "AUSENTE" ? "AUSENTE"
      : r.estado === "ATENDIDA" ? (r._count.ventas ? "COBRADA" : "POR_COBRAR")
      : r.estado === "CONFIRMADA" ? (r.iniciadaEn && !f.terminadoEn ? "EN_SESION" : "CONFIRMADA")
      : "PENDIENTE_PAGO";
    return {
      reservaId: f.reservaId, itemId: f.id, posicion: f.posicion, itemsDeLaReserva: r._count.items, profesionalId: f.profesionalId,
      recursoIds: f.recursos.map(x => x.recursoId), inicio: f.inicio, fin: f.fin, ocupaDesde: f.ocupaDesde, ocupaHasta: f.ocupaHasta,
      servicioId: f.servicioId, servicio: f.servicio.nombre, cliente: r.cliente, notas: r.notas, canal: r.canal, expiraEn: r.expiraEn, estado,
      // Además del contrato: para distinguir un servicio ya terminado de un turno que todavía no empezó.
      iniciadaEn: r.iniciadaEn, terminadoEn: f.terminadoEn,
    };
  });

  // Profesionales: activas de la sede del universo, más las que tienen un turno en la grilla.
  const conTurno = [...new Set(turnos.map(t => t.profesionalId))];
  const candidatas = await db.profesional.findMany({
    where: { organizacionId, OR: [{ activo: true, sedes: { some: { sedeId, activo: true } } }, { id: { in: conTurno } }] },
    select: { id: true, nombre: true, apellido: true, activo: true, sedes: { where: { sedeId, activo: true }, select: { sedeId: true } }, servicios: { select: { servicioId: true } }, skills: { select: { skillId: true } } },
    orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
  });
  // Mismo criterio que el motor y el tablero: habilitada para el servicio y con todas sus habilidades.
  const puede = (p: (typeof candidatas)[number], s: (typeof ofrecidos)[number]) =>
    p.servicios.some(x => x.servicioId === s.servicio.id) && s.servicio.skills.every(k => p.skills.some(x => x.skillId === k.skillId));
  const elegidas = candidatas.filter(p => {
    if (conTurno.includes(p.id)) return true;
    if (!p.activo || !p.sedes.length) return false;
    if (!universo) return true;
    // Regla del tablero (doc 31): está en un universo si hace algún servicio suyo; sin servicios, en los dos.
    const universos = new Set(ofrecidos.filter(s => puede(p, s)).map(s => universoDe.get(s.servicio.id)));
    return !universos.size || universos.has(universo);
  });
  const ids = elegidas.map(p => p.id);
  const horarios = await db.horarioProfesional.findMany({ where: { profesionalId: { in: ids }, sedeId } });
  const ausencias = await db.bloqueoAgenda.findMany({ where: { profesionalId: { in: ids }, inicio: { lt: finDia }, fin: { gt: inicioDia } }, select: { profesionalId: true, inicio: true, fin: true, motivo: true }, orderBy: { inicio: "asc" } });

  const tipos = [...new Set(delUniverso.flatMap(s => s.servicio.recursos.map(r => r.tipoRecursoId)))];
  const recursos = tipos.length ? await db.recurso.findMany({
    where: { organizacionId, sedeId, activo: true, tipoRecursoId: { in: tipos } },
    select: { id: true, nombre: true, tipoRecursoId: true, tipoRecurso: { select: { nombre: true } } },
    orderBy: [{ tipoRecurso: { nombre: "asc" } }, { nombre: "asc" }],
  }) : [];

  return {
    timezone: tz, fecha, esHoy: aLocal(ahora, tz).fecha === fecha, pasoMinutos: config.pasoGrillaMinutos.valor, apertura: comoFechas(apertura),
    profesionales: elegidas.map(p => ({
      id: p.id, nombre: nombreDe(p),
      jornada: comoFechas(aIntervalos(jornadaDelDia(horarios.filter(h => h.profesionalId === p.id).map(semanal), fecha), fecha, tz)),
      ausencias: ausencias.filter(a => a.profesionalId === p.id).map(a => ({ desde: a.inicio, hasta: a.fin, motivo: a.motivo })),
      servicioIds: delUniverso.filter(s => puede(p, s)).map(s => s.servicio.id),
    })),
    servicios: delUniverso.map(s => ({ id: s.servicio.id, nombre: s.servicio.nombre, duracionMinutos: s.duracionMinutos ?? s.servicio.duracionMinutos, recursos: s.servicio.recursos })),
    recursos: recursos.map(r => ({ id: r.id, nombre: r.nombre, tipoRecursoId: r.tipoRecursoId, tipo: r.tipoRecurso.nombre })),
    turnos,
  };
}

/**
 * A dónde se puede mover un turno confirmado en `fecha` (doc 31, etapa 4): por cada profesional que puede
 * hacer el servicio, los inicios que `reprogramarReserva` aceptaría, sin contar la ocupación del propio turno
 * (para poder correrlo media hora o cambiarle solo la cabina), y para cada inicio las unidades libres de cada
 * tipo que el servicio requiere. Un turno de varios servicios solo ofrece cambiar de horario con las mismas
 * profesionales. Es orientativo: `reprogramarReserva` revalida con locks.
 *
 * Las unidades libres se calculan por servicio: dos servicios a la vez del mismo turno pueden ver la misma
 * unidad libre, y el motor rechaza elegirla para los dos.
 */
export async function destinosDeTurno(db: Database, actorId: string, organizacionId: string, reservaId: string, fecha: string, ahora = new Date()) {
  exigirIds(reservaId);
  if (!validarFecha(fecha)) throw new DatosInvalidos("Fecha inválida");
  const r = await db.reserva.findFirst({ where: { id: reservaId, organizacionId }, select: { sedeId: true, estado: true, iniciadaEn: true, items: { orderBy: { posicion: "asc" }, select: { servicioId: true, profesionalId: true, inicio: true } } } });
  if (!r) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, r.sedeId);
  // Mismas reglas que reprogramarReserva: solo confirmados y sin la sesión empezada.
  if (r.estado !== "CONFIRMADA") throw new DatosInvalidos("Solo se mueven turnos confirmados");
  if (r.iniciadaEn) throw new DatosInvalidos("La sesión ya empezó: no se puede mover el turno");

  const unico = r.items.length === 1;
  const pedido: Pedido = { sedeId: r.sedeId, fecha, canal: "RECEPCION", items: r.items.map((it, i) => ({
    servicioId: it.servicioId, profesionalId: unico ? null : it.profesionalId, conAnterior: i > 0 && it.inicio.getTime() === r.items[i - 1]!.inicio.getTime(),
  })) };
  const { consulta } = await cargarConsulta(db, organizacionId, pedido, ahora, undefined, { ignorarReservaId: reservaId });
  const opciones = unico ? consulta.items[0]!.candidatos.map(id => [id]) : [r.items.map(i => i.profesionalId)];
  const cruza = (a: Intervalo, b: Intervalo) => a.desde < b.hasta && b.desde < a.hasta;

  return {
    reservaId, fecha, timezone: consulta.tz,
    destinos: opciones.map(profesionalIds => {
      const items = consulta.items.map((it, i) => ({ ...it, candidatos: it.candidatos.filter(c => c === profesionalIds[i]) }));
      return {
        profesionalIds,
        inicios: buscarTurnos({ ...consulta, items }).map(t => ({
          inicio: new Date(t.inicio), fin: new Date(t.fin),
          items: t.items.map((asignado, i) => {
            const ocupa = { desde: asignado.ocupaDesde, hasta: asignado.ocupaHasta };
            return { recursos: items[i]!.requisitos.map(q => ({
              tipoRecursoId: q.tipoRecursoId, cantidad: q.cantidad,
              libres: consulta.recursos.filter(x => x.tipoRecursoId === q.tipoRecursoId && !x.ocupado.some(o => cruza(o, ocupa))).map(x => x.id).sort(),
            })) };
          }),
        })),
      };
    }),
  };
}
