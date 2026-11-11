import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, aUtc } from "@nailnet/domain/agenda";
import { UNIVERSOS, type Universo } from "@nailnet/domain/catalogo";
import type { Database } from "./client.ts";
import { Prisma } from "../generated/client/client.ts";
import { DatosInvalidos, exigirIds, sedesConPermiso } from "./access.ts";
import { ConfiguracionIncompleta, reservaActiva } from "./disponibilidad.ts";
import { PROFESIONAL_OCUPADA, TurnoNoDisponible, sumarEnAtencion, tomarTurno, type TurnoTomado } from "./reservas.ts";

// Tablero de recepción (doc 29, D20): quién está en el local, quién está libre y para qué, quién atiende a
// quién y qué falta cobrar. Las profesionales no usan el celular en el salón: todo lo marca recepción.

async function exigirSede(db: Database, actorId: string, organizacionId: string, sedeId: string) {
  exigirIds(sedeId);
  const { ids } = await sedesConPermiso(db, actorId, organizacionId, "reserva:gestionar");
  if (!ids.has(sedeId)) throw new AccesoDenegado();
}

const YA_PRESENTE = "Ya está marcada como presente";

/** La profesional llegó al local. Una sola presencia abierta por profesional, en cualquier sede. */
export async function registrarEntrada(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; profesionalId: string }, ahora = new Date()) {
  exigirIds(datos.profesionalId);
  await exigirSede(db, actorId, organizacionId, datos.sedeId);
  const vinculo = await db.profesionalSede.count({ where: { organizacionId, sedeId: datos.sedeId, profesionalId: datos.profesionalId, activo: true, profesional: { activo: true } } });
  if (!vinculo) throw new DatosInvalidos("La profesional no trabaja en esta sede");
  const abierta = await db.presenciaProfesional.findFirst({ where: { organizacionId, profesionalId: datos.profesionalId, salida: null }, select: { sedeId: true, sede: { select: { nombre: true } } } });
  if (abierta) throw new DatosInvalidos(abierta.sedeId === datos.sedeId ? YA_PRESENTE : `Está marcada como presente en ${abierta.sede.nombre}: marcá primero la salida allá`);
  try {
    return await db.presenciaProfesional.create({ data: { organizacionId, sedeId: datos.sedeId, profesionalId: datos.profesionalId, entrada: ahora, entradaPorId: actorId }, select: { id: true } });
  } catch (e) {
    // Dos recepcionistas a la vez: el índice parcial deja pasar una sola.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DatosInvalidos(YA_PRESENTE);
    throw e;
  }
}

/** La profesional se fue (fin de su turno o del día). No se puede con una clienta en atención. */
export async function registrarSalida(db: Database, actorId: string, organizacionId: string, presenciaId: string, ahora = new Date()) {
  exigirIds(presenciaId);
  const p = await db.presenciaProfesional.findFirst({ where: { id: presenciaId, organizacionId }, select: { sedeId: true, profesionalId: true, salida: true, entrada: true } });
  if (!p) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, p.sedeId);
  if (p.salida) throw new DatosInvalidos("La salida ya está marcada");
  const atendiendo = await db.reserva.count({ where: { organizacionId, estado: "CONFIRMADA", iniciadaEn: { not: null }, items: { some: { profesionalId: p.profesionalId, terminadoEn: null } } } });
  if (atendiendo) throw new DatosInvalidos("Tiene una clienta en atención: marcá «Terminó» antes de la salida");
  const { count } = await db.presenciaProfesional.updateMany({ where: { id: presenciaId, salida: null }, data: { salida: ahora < p.entrada ? p.entrada : ahora, salidaPorId: actorId } });
  if (count !== 1) throw new DatosInvalidos("La salida ya está marcada");
}

/**
 * Etapa 3 (doc 29): la clienta espera porque no hay nadie libre. Datos mínimos para no frenar la cola: el
 * cliente se busca o se crea al atenderla. Los servicios tienen que estar habilitados en la sede y la
 * profesional pedida, trabajar en ella.
 *
 * Universos, etapa 2 (doc 31): si recepción ya encontró la ficha, se anota con `clienteId` (de la
 * organización) y al sentarla el turno queda a su nombre. El nombre y el teléfono se guardan igual, para
 * mostrar.
 */
export async function agregarEspera(db: Database, actorId: string, organizacionId: string, datos: { sedeId: string; nombre: string; telefono?: string | null; servicioIds: string[]; profesionalId?: string | null; notas?: string | null; clienteId?: string | null }, ahora = new Date()) {
  const servicioIds = [...new Set(datos.servicioIds.filter(Boolean))];
  exigirIds(datos.profesionalId, datos.clienteId, ...servicioIds);
  await exigirSede(db, actorId, organizacionId, datos.sedeId);
  if (datos.clienteId && !await db.cliente.count({ where: { id: datos.clienteId, organizacionId } })) throw new AccesoDenegado();
  const nombre = datos.nombre.trim().slice(0, 80);
  if (!nombre) throw new DatosInvalidos("Indicá el nombre de la clienta");
  if (!servicioIds.length || servicioIds.length > 3) throw new DatosInvalidos("Elegí entre 1 y 3 servicios");
  const habilitados = await db.servicioSede.count({ where: { organizacionId, sedeId: datos.sedeId, servicioId: { in: servicioIds }, habilitado: true, servicio: { activo: true } } });
  if (habilitados !== servicioIds.length) throw new DatosInvalidos("Hay un servicio que no está disponible en esta sede");
  if (datos.profesionalId && !await db.profesionalSede.count({ where: { organizacionId, sedeId: datos.sedeId, profesionalId: datos.profesionalId, activo: true } })) throw new DatosInvalidos("La profesional no trabaja en esta sede");
  return db.esperaRecepcion.create({ data: {
    organizacionId, sedeId: datos.sedeId, nombre, telefono: datos.telefono?.trim().slice(0, 40) || null, clienteId: datos.clienteId || null, servicioIds, profesionalId: datos.profesionalId || null,
    notas: datos.notas?.trim().slice(0, 300) || null, llegada: ahora, estado: "ESPERANDO", registradaPorId: actorId,
  }, select: { id: true } });
}

/** La clienta se fue sin ser atendida. */
export async function esperaSeFue(db: Database, actorId: string, organizacionId: string, esperaId: string, ahora = new Date()) {
  exigirIds(esperaId);
  const e = await db.esperaRecepcion.findFirst({ where: { id: esperaId, organizacionId }, select: { sedeId: true, llegada: true } });
  if (!e) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, e.sedeId);
  const { count } = await db.esperaRecepcion.updateMany({ where: { id: esperaId, estado: "ESPERANDO" }, data: { estado: "SE_FUE", cerradaEn: ahora < e.llegada ? e.llegada : ahora, cerradaPorId: actorId } });
  if (count !== 1) throw new DatosInvalidos("Esa clienta ya no está en la lista de espera");
}

const YA_NO_ESPERA = "Esa clienta ya no está en la lista de espera (la atendió otra recepcionista o se fue)";

/**
 * Universos, etapa 2 (doc 31): sienta ahora a una clienta de la lista de espera, sin pasar por «Atender
 * ahora». Uno o varios de los servicios que pidió, cada uno con su profesional:
 * - sin repetir y solo de los que pidió; con varios, empiezan a la vez con profesionales distintas (mismo
 *   motor que «a la vez», etapa 2 del doc 29);
 * - con ficha, el turno queda a nombre del cliente; sin ficha, con el nombre de la espera como
 *   `clienteProvisional`, y no se sienta un servicio que exige consentimiento de práctica (se verifica al
 *   terminar contra la ficha, que no hay);
 * - si quedan servicios sin sentar, la espera sigue abierta solo con esos y conserva la llegada; si no
 *   queda ninguno, se cierra con su turno. Todo en la transacción del turno.
 *
 * Mismas garantías que `atenderAhora` (es `tomarTurno` con los mismos locks): la fila de la espera se
 * bloquea después de las profesionales y se relee, así que si otra recepcionista ya la sentó (o sentó una
 * parte) o se fue, no se crea nada. El evento de creación del turno guarda `esperaId`: un sentado parcial no
 * cierra la espera, y el cobro igual encuentra de dónde vino para precargar la ficha.
 *
 * Etapa 3a (doc 31): con `pisar`, «sentar igual» aunque pise un turno cercano de esas profesionales. El
 * sistema avisa, no traba: sus turnos reservados que todavía no empezaron no cuentan como ocupación, y el
 * evento de creación guarda en `pisadas` cuáles pisó. Siguen contando las atenciones en curso, las ausencias,
 * la jornada y los recursos (ver `OpcionesConsulta`).
 *
 * Etapa 3b (doc 31), una sola comanda por visita: el turno guarda `esperaId`. Si esa espera ya tiene un turno
 * con la atención en curso (un sentado parcial), lo que se sienta después se suma a ese turno
 * (`sumarEnAtencion`, con los mismos locks y la espera bloqueada en la misma transacción) y se devuelve ese
 * turno. Si no, se crea uno como siempre. El cierre de la espera no cambia.
 */
export async function sentarEspera(db: Database, actorId: string, organizacionId: string, datos: { esperaId: string; items: { servicioId: string; profesionalId: string }[]; pisar?: boolean }, ahora = new Date()): Promise<TurnoTomado> {
  if (!datos.items.length) throw new DatosInvalidos("Elegí al menos un servicio");
  if (datos.items.some(i => !i.servicioId || !i.profesionalId)) throw new DatosInvalidos("Elegí la profesional de cada servicio");
  exigirIds(datos.esperaId, ...datos.items.flatMap(i => [i.servicioId, i.profesionalId]));
  const e = await db.esperaRecepcion.findFirst({ where: { id: datos.esperaId, organizacionId }, select: { sedeId: true, nombre: true, clienteId: true, servicioIds: true, estado: true, llegada: true, sede: { select: { timezone: true } } } });
  if (!e) throw new AccesoDenegado();
  await exigirSede(db, actorId, organizacionId, e.sedeId);
  if (e.estado !== "ESPERANDO") throw new DatosInvalidos(YA_NO_ESPERA);
  const servicioIds = datos.items.map(i => i.servicioId);
  if (new Set(servicioIds).size !== servicioIds.length) throw new DatosInvalidos("Elegiste dos veces el mismo servicio");
  if (servicioIds.some(id => !e.servicioIds.includes(id))) throw new DatosInvalidos("Elegí servicios de los que pidió la clienta");
  if (new Set(datos.items.map(i => i.profesionalId)).size !== datos.items.length) throw new DatosInvalidos("Los servicios a la vez van con profesionales distintas");
  const restantes = e.servicioIds.filter(id => !servicioIds.includes(id));
  const mismos = (a: string[]) => a.length === e.servicioIds.length && a.every((id, n) => id === e.servicioIds[n]);

  const bloquearEspera = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "EsperaRecepcion" WHERE id = ${datos.esperaId}::uuid FOR UPDATE`;
    const actual = await tx.esperaRecepcion.findUniqueOrThrow({ where: { id: datos.esperaId }, select: { estado: true, servicioIds: true } });
    if (actual.estado !== "ESPERANDO" || !mismos(actual.servicioIds)) throw new DatosInvalidos(YA_NO_ESPERA);
  };
  const antes = async (tx: Prisma.TransactionClient) => {
    await bloquearEspera(tx);
    if (!e.clienteId && await tx.servicioConsentimiento.count({ where: { organizacionId, servicioId: { in: servicioIds } } }))
      throw new DatosInvalidos("Ese servicio exige un consentimiento firmado: elegí o cargá la ficha de la clienta antes de sentarla");
  };
  const despues = async (tx: Prisma.TransactionClient, turno: TurnoTomado) => {
    const { count } = await tx.esperaRecepcion.updateMany({
      where: { id: datos.esperaId, estado: "ESPERANDO" },
      data: restantes.length ? { servicioIds: restantes } : { estado: "ATENDIDA", reservaId: turno.reservaId, cerradaEn: ahora < e.llegada ? e.llegada : ahora, cerradaPorId: actorId },
    });
    if (count !== 1) throw new DatosInvalidos(YA_NO_ESPERA);
  };
  // Una comanda por visita: la clienta ya se está atendiendo por esta espera. El consentimiento sin ficha lo
  // verifica `sumarEnAtencion` contra el turno (que pudo recibir la ficha después de sentarla).
  const enCurso = await db.reserva.findFirst({ where: { organizacionId, esperaId: datos.esperaId, estado: "CONFIRMADA", iniciadaEn: { not: null } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (enCurso) return sumarEnAtencion(db, actorId, organizacionId, enCurso.id, datos.items, ahora, { pisar: datos.pisar, antes: bloquearEspera, despues, evento: { esperaId: datos.esperaId } });
  // Al minuto, como «Atender ahora»: el turno empieza ahora y el motor lo valida con «ahora» como límite.
  const inicio = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
  try {
    return await tomarTurno(db, actorId, organizacionId, {
      sedeId: e.sedeId, fecha: aLocal(inicio, e.sede.timezone).fecha, canal: "RECEPCION", clienteId: e.clienteId, clienteProvisional: e.clienteId ? null : e.nombre,
      items: datos.items.map((i, n) => ({ servicioId: i.servicioId, profesionalId: i.profesionalId, conAnterior: n > 0 })), inicio, sinTurnoPrevio: true, esperaId: datos.esperaId,
    }, inicio, { antes, despues, evento: { esperaId: datos.esperaId }, ...(datos.pisar ? { consulta: { pisar: datos.items.map(i => i.profesionalId) } } : {}) });
  } catch (err) {
    if (err instanceof TurnoNoDisponible) throw new DatosInvalidos(PROFESIONAL_OCUPADA);
    if (err instanceof ConfiguracionIncompleta) throw new DatosInvalidos(`Falta definir en la sede: ${err.faltantes.join(", ")}`);
    throw err;
  }
}

const POR_LLEGAR_MS = 2 * 3_600_000;
const POR_COBRAR_DIAS = 7;
type ClienteBreve = { id: string; nombre: string; apellido: string | null } | null;

/**
 * Estado del local ahora. Por profesional activa de la sede: presencia, servicios que puede hacer,
 * atención en curso y próximo turno reservado (en cualquier sede, porque la ocupa igual). Además, los
 * turnos de la sede por llegar (dos horas antes y después, sin marcar la llegada) y las atenciones
 * terminadas sin venta (últimos siete días), que son las comandas por cobrar.
 *
 * Universos (doc 31, D21): con `opciones.universo`, y si la sede ofrece servicios de los dos, devuelve solo
 * ese universo: sus servicios, las profesionales que hacen alguno, su lista de espera y sus turnos por
 * llegar. Las comandas por cobrar no se separan, porque la caja es una sola. `universos` trae el resumen
 * de cada uno para las pestañas. Sin la opción, o con un solo universo en la sede, devuelve todo junto.
 *
 * Universos, etapa 2 (doc 31), para sentar desde el tablero: por profesional, `libreDesde` (lo último
 * entre su entrada y su último «Terminó» de hoy; nulo si está atendiendo) y `agenda` (sus ocupaciones
 * entre ahora y dos horas más, recortadas a esa ventana: la atención en curso y los turnos reservados).
 * Donde hay cliente, también `clienteProvisional` (el nombre de la clienta sentada sin ficha), y en cada
 * espera, su ficha si la tiene.
 *
 * Etapa 3 (doc 31): cada turno por llegar trae `riesgos` (sus profesionales que atienden a otra clienta y
 * terminan después de la hora de su servicio en ese turno, o vienen demoradas). `llegaron` trae los turnos de
 * hoy cuya clienta llegó y espera a su profesional (`registrarLlegada`), por orden de llegada; esos turnos ya
 * no están en `porLlegar`, y el resumen por universo los cuenta entre las esperas.
 */
export async function tableroSede(db: Database, actorId: string, organizacionId: string, sedeId: string, ahora = new Date(), opciones: { universo?: Universo | null } = {}) {
  await exigirSede(db, actorId, organizacionId, sedeId);
  const sede = await db.sede.findUniqueOrThrow({ where: { id: sedeId }, select: { timezone: true } });
  const tz = sede.timezone;
  const inicioDia = aUtc(aLocal(ahora, tz).fecha, 0, tz), finDia = aUtc(aLocal(ahora, tz).fecha, 1440, tz);
  // Ventana de la franja de cada profesional (doc 31, etapa 2) y de los turnos por llegar.
  const cerca = new Date(ahora.getTime() + POR_LLEGAR_MS);

  const profesionales = await db.profesional.findMany({
    where: { organizacionId, activo: true, sedes: { some: { sedeId, activo: true } } },
    select: { id: true, nombre: true, apellido: true, servicios: { select: { servicioId: true } }, skills: { select: { skillId: true } } },
    orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
  });
  const ids = profesionales.map(p => p.id);
  const servicios = await db.servicioSede.findMany({
    where: { organizacionId, sedeId, habilitado: true, servicio: { activo: true } },
    select: { duracionMinutos: true, servicio: { select: { id: true, nombre: true, duracionMinutos: true, skills: { select: { skillId: true } }, categoria: { select: { universo: true } } } } },
    orderBy: { servicio: { nombre: "asc" } },
  });
  const universoDe = new Map(servicios.map(s => [s.servicio.id, s.servicio.categoria.universo]));
  // Con un solo universo en la sede no hay nada que separar.
  const activos = UNIVERSOS.filter(x => servicios.some(s => s.servicio.categoria.universo === x));
  const universo = opciones.universo && activos.length > 1 ? opciones.universo : null;
  // Mismo criterio que el motor: habilitada para el servicio y con todas sus habilidades.
  const puede = (p: (typeof profesionales)[number], s: (typeof servicios)[number]) =>
    p.servicios.some(x => x.servicioId === s.servicio.id) && s.servicio.skills.every(k => p.skills.some(x => x.skillId === k.skillId));

  // Secuencial a propósito, como en la disponibilidad: comparten conexión.
  const presencias = await db.presenciaProfesional.findMany({ where: { organizacionId, profesionalId: { in: ids }, salida: null }, select: { id: true, sedeId: true, profesionalId: true, entrada: true, sede: { select: { nombre: true } } } });
  // Turnos que todavía no empezaron y la ocupan hoy (o en las próximas dos horas, para la franja): el
  // primero de hoy dice hasta cuándo está libre.
  const reservados = await db.reservaItem.findMany({
    where: { organizacionId, profesionalId: { in: ids }, ocupaHasta: { gt: ahora }, ocupaDesde: { lt: finDia > cerca ? finDia : cerca }, reserva: { AND: [reservaActiva(ahora), { estado: { notIn: ["ATENDIDA", "AUSENTE"] }, iniciadaEn: null }] } },
    select: { profesionalId: true, inicio: true, ocupaDesde: true, ocupaHasta: true, servicio: { select: { nombre: true } }, reserva: { select: { id: true, sedeId: true, cliente: { select: { id: true, nombre: true, apellido: true } } } } },
    orderBy: { ocupaDesde: "asc" },
  });
  // Una atención en curso sigue ocupando a la profesional aunque se haya pasado del horario estimado.
  const enCurso = await db.reservaItem.findMany({
    where: { organizacionId, profesionalId: { in: ids }, terminadoEn: null, reserva: { estado: "CONFIRMADA", iniciadaEn: { not: null } } },
    select: { profesionalId: true, fin: true, ocupaDesde: true, ocupaHasta: true, servicio: { select: { nombre: true } }, reserva: { select: { id: true, sedeId: true, iniciadaEn: true, clienteProvisional: true, cliente: { select: { id: true, nombre: true, apellido: true } } } } },
    orderBy: { inicio: "asc" },
  });
  // Último «Terminó» de hoy de cada una, para saber desde cuándo está libre.
  const terminados = await db.reservaItem.groupBy({
    by: ["profesionalId"], where: { organizacionId, profesionalId: { in: ids }, terminadoEn: { gte: inicioDia, lte: ahora } }, _max: { terminadoEn: true },
  });
  const ultimoTermino = new Map(terminados.map(t => [t.profesionalId, t._max.terminadoEn]));
  // Recorta una ocupación a la ventana [ahora, ahora + 2 h]. Una atención pasada del estimado sigue
  // ocupando: queda como un tramo vacío en «ahora» (la pantalla la ve igual en `atencion`).
  const enVentana = (desde: Date, hasta: Date, tipo: "atencion" | "turno") => {
    const d = desde < ahora ? ahora : desde > cerca ? cerca : desde;
    const h = hasta > cerca ? cerca : hasta < d ? d : hasta;
    return { desde: d, hasta: h, tipo };
  };

  const filas = profesionales.map(p => {
    const presencia = presencias.find(x => x.profesionalId === p.id);
    const propios = enCurso.filter(i => i.profesionalId === p.id);
    const reservaId = propios[0]?.reserva.id;
    const atencion = propios.filter(i => i.reserva.id === reservaId);
    const proximo = reservados.find(i => i.profesionalId === p.id && i.ocupaDesde < finDia);
    const servicioIds = servicios.filter(s => puede(p, s)).map(s => s.servicio.id);
    const desdes = [presencia?.entrada, ultimoTermino.get(p.id)].filter((x): x is Date => !!x && x <= ahora);
    const agenda = [
      ...propios.filter(i => i.ocupaDesde < cerca).map(i => enVentana(i.ocupaDesde, i.ocupaHasta, "atencion" as const)),
      ...reservados.filter(i => i.profesionalId === p.id && i.ocupaDesde < cerca).map(i => enVentana(i.ocupaDesde, i.ocupaHasta, "turno" as const)),
    ].sort((a, b) => a.desde.getTime() - b.desde.getTime());
    return {
      id: p.id, nombre: [p.nombre, p.apellido].filter(Boolean).join(" "),
      servicioIds, universos: UNIVERSOS.filter(x => servicioIds.some(id => universoDe.get(id) === x)),
      presencia: presencia ? { id: presencia.id, entrada: presencia.entrada, otraSede: presencia.sedeId === sedeId ? null : presencia.sede.nombre } : null,
      atencion: reservaId ? {
        reservaId, enOtraSede: atencion[0]!.reserva.sedeId !== sedeId, cliente: atencion[0]!.reserva.cliente as ClienteBreve, clienteProvisional: atencion[0]!.reserva.clienteProvisional,
        servicios: atencion.map(i => i.servicio.nombre), desde: atencion[0]!.reserva.iniciadaEn!, finEstimado: atencion.at(-1)!.fin,
      } : null,
      // Desde cuándo deja de estar libre: el próximo turno reservado, con su preparación.
      proximo: proximo ? { reservaId: proximo.reserva.id, inicio: proximo.inicio, ocupaDesde: proximo.ocupaDesde, servicio: proximo.servicio.nombre, cliente: proximo.reserva.cliente as ClienteBreve, otraSede: proximo.reserva.sedeId !== sedeId } : null,
      libreDesde: reservaId ? null : desdes.length ? new Date(Math.max(...desdes.map(d => d.getTime()))) : null,
      agenda,
    };
  });

  // Se traen los turnos hasta el fin del día: Tratamientos los muestra todos; el resto, solo los cercanos.
  const porLlegar = await db.reserva.findMany({
    where: { organizacionId, sedeId, estado: "CONFIRMADA", iniciadaEn: null, llegoEn: null, items: { some: { posicion: 0, inicio: { lt: finDia > cerca ? finDia : cerca, gte: new Date(ahora.getTime() - POR_LLEGAR_MS) } } } },
    select: { id: true, clienteProvisional: true, cliente: { select: { id: true, nombre: true, apellido: true } }, items: { orderBy: { posicion: "asc" }, select: { inicio: true, fin: true, profesionalId: true, servicio: { select: { nombre: true, categoria: { select: { universo: true } } } }, profesional: { select: { nombre: true, apellido: true } } } } },
  });
  // Etapa 3b (doc 31): las clientas con turno de hoy que llegaron y esperan a su profesional, por orden de
  // llegada. Salen de los turnos por llegar.
  const llegados = await db.reserva.findMany({
    where: { organizacionId, sedeId, estado: "CONFIRMADA", iniciadaEn: null, llegoEn: { not: null }, items: { some: { posicion: 0, inicio: { gte: inicioDia, lt: finDia } } } },
    select: { id: true, llegoEn: true, clienteProvisional: true, cliente: { select: { id: true, nombre: true, apellido: true } }, items: { orderBy: { posicion: "asc" }, select: { inicio: true, servicioId: true, profesionalId: true, servicio: { select: { nombre: true, categoria: { select: { universo: true } } } }, profesional: { select: { nombre: true, apellido: true } } } } },
    orderBy: [{ llegoEn: "asc" }, { id: "asc" }],
  });
  const porCobrar = await db.reserva.findMany({
    where: { organizacionId, sedeId, estado: "ATENDIDA", ventas: { none: { estado: { not: "ANULADA" } } }, items: { some: { posicion: 0, inicio: { gte: new Date(ahora.getTime() - POR_COBRAR_DIAS * 86_400_000) } } } },
    select: { id: true, terminadaEn: true, clienteProvisional: true, cliente: { select: { id: true, nombre: true, apellido: true } }, items: { orderBy: { posicion: "asc" }, select: { inicio: true, fin: true, profesionalId: true, servicio: { select: { nombre: true, categoria: { select: { universo: true } } } }, profesional: { select: { nombre: true, apellido: true } } } } },
    take: 100,
  });
  // Etapa 3: la lista de espera de hoy, por orden de llegada. Una espera olvidada de otro día no se muestra.
  const esperas = await db.esperaRecepcion.findMany({
    where: { organizacionId, sedeId, estado: "ESPERANDO", llegada: { gte: inicioDia } },
    select: { id: true, nombre: true, telefono: true, servicioIds: true, profesionalId: true, notas: true, llegada: true, cliente: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { llegada: "asc" },
  });
  const nombre = (p: { nombre: string; apellido: string | null }) => [p.nombre, p.apellido].filter(Boolean).join(" ");
  const resumen = (r: (typeof porLlegar)[number]) => ({
    reservaId: r.id, cliente: r.cliente as ClienteBreve, clienteProvisional: r.clienteProvisional, inicio: r.items[0]!.inicio,
    servicios: r.items.map(i => `${i.servicio.nombre} · ${nombre(i.profesional)}`),
    universos: UNIVERSOS.filter(x => r.items.some(i => i.servicio.categoria.universo === x)),
  });
  // Etapa 3a (doc 31): turno en riesgo. Una profesional del turno atiende a otra clienta y su fin estimado
  // pasa la hora de su servicio en este turno, o ya se pasó del estimado (`demorada`, sin hora para dar).
  const finAtencion = new Map<string, Date>();
  for (const i of enCurso) {
    const previo = finAtencion.get(i.profesionalId);
    if (!previo || previo < i.fin) finAtencion.set(i.profesionalId, i.fin);
  }
  const riesgos = (r: (typeof porLlegar)[number]) => [...new Set(r.items.map(i => i.profesionalId))].flatMap(profesionalId => {
    const fin = finAtencion.get(profesionalId);
    const it = r.items.find(i => i.profesionalId === profesionalId)!;
    if (!fin) return [];
    const demorada = fin <= ahora;
    if (!demorada && fin <= it.inicio) return [];
    return [{ profesionalId, profesional: nombre(it.profesional), demorada, libreEstimado: demorada ? null : fin }];
  });
  const llegan = porLlegar.map(r => ({ ...resumen(r), riesgos: riesgos(r) })).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const llegaron = llegados.map(r => ({
    reservaId: r.id, cliente: r.cliente as ClienteBreve, clienteProvisional: r.clienteProvisional, llegoEn: r.llegoEn!, inicio: r.items[0]!.inicio,
    items: r.items.map(i => ({ servicioId: i.servicioId, servicio: i.servicio.nombre, profesionalId: i.profesionalId, profesional: nombre(i.profesional) })),
  }));
  // Como los turnos por llegar: es del universo si tiene algún servicio suyo. Ya están en el local, así que sin ventana de horario.
  const llegoEn = (r: (typeof llegados)[number], x: Universo) => r.items.some(i => i.servicio.categoria.universo === x);

  // Una profesional está en un universo si hace algún servicio suyo. Sin servicios habilitados aparece en
  // los dos, para que recepción igual pueda marcarle la entrada y la salida.
  const proEn = (f: { universos: Universo[] }, x: Universo) => !f.universos.length || f.universos.includes(x);
  // La espera es del universo de lo primero que pidió; si ese servicio ya no se ofrece, se ve en los dos.
  const esperaEn = (e: { servicioIds: string[] }, x: Universo) => (universoDe.get(e.servicioIds[0]!) ?? x) === x;
  // Tratamientos trabaja con turno previo: muestra todos los turnos que quedan hoy, no solo los cercanos.
  const llegaEn = (r: { inicio: Date; universos: Universo[] }, x: Universo) => r.universos.includes(x) && (x === "TRATAMIENTOS" || r.inicio < cerca);

  return {
    timezone: tz,
    universo,
    universos: activos.length > 1 ? UNIVERSOS.map(x => {
      // En el local: con la entrada marcada acá, o atendiendo acá aunque no se la hayan marcado.
      const enLocal = filas.filter(f => proEn(f, x) && ((f.presencia && !f.presencia.otraSede) || (f.atencion && !f.atencion.enOtraSede)));
      return { universo: x, libres: enLocal.filter(f => !f.atencion).length, atendiendo: enLocal.filter(f => f.atencion).length, esperas: esperas.filter(e => esperaEn(e, x)).length + llegados.filter(r => llegoEn(r, x)).length, porLlegar: llegan.filter(r => llegaEn(r, x)).length };
    }) : [],
    servicios: servicios.filter(s => !universo || s.servicio.categoria.universo === universo).map(s => ({ id: s.servicio.id, nombre: s.servicio.nombre, duracionMinutos: s.duracionMinutos ?? s.servicio.duracionMinutos })),
    profesionales: universo ? filas.filter(f => proEn(f, universo)).map(f => ({ ...f, servicioIds: f.servicioIds.filter(id => universoDe.get(id) === universo) })) : filas,
    porLlegar: llegan.filter(r => universo ? llegaEn(r, universo) : r.inicio < cerca),
    esperas: universo ? esperas.filter(e => esperaEn(e, universo)) : esperas,
    llegaron: universo ? llegaron.filter((_, n) => llegoEn(llegados[n]!, universo)) : llegaron,
    porCobrar: porCobrar.map(r => ({ ...resumen(r), terminadaEn: r.terminadaEn ?? r.items.at(-1)!.fin }))
      .sort((a, b) => a.terminadaEn.getTime() - b.terminadaEn.getTime()),
  };
}
