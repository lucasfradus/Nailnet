import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/client.ts";
import type { Prisma } from "../generated/client/client.ts";

// Turnos sintéticos para una sede de la demo: clientas dummy y la agenda de las próximas semanas llena,
// dentro de la jornada de cada profesional y con los servicios que tiene habilitados, sin pisar nada.
//   npm run demo:turnos -w @nailnet/database -- --sede Lomada            (simulación: rollback)
//   npm run demo:turnos -w @nailnet/database -- --sede Lomada --aplicar  (commit)
// Opcionales: --dias 13 (hoy + N), --ocupacion 0.65.
// El historial de reservas es inmutable: lo que se aplica no se borra, solo se puede cancelar.
// Las clientas se reconocen por el email demo.<sede>.N@example.invalid.

const ambiente = process.env.NAILNET_AMBIENTE;
const permitido = process.env.ALLOW_DEMO_SEED === "true" && ambiente !== "produccion" && (process.env.NODE_ENV !== "production" || ambiente === "staging");
if (!permitido) throw new Error("Turnos demo deshabilitados: requiere ALLOW_DEMO_SEED=true y, si NODE_ENV=production, NAILNET_AMBIENTE=staging. Nunca en NAILNET_AMBIENTE=produccion.");

const arg = (nombre: string) => { const i = process.argv.indexOf(`--${nombre}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const APLICAR = process.argv.includes("--aplicar");
const NOMBRE_SEDE = arg("sede");
const DIAS = Number(arg("dias") ?? 13);
const OCUPACION = Number(arg("ocupacion") ?? 0.65);
if (!NOMBRE_SEDE) throw new Error("Falta --sede <nombre>");

// mulberry32: pseudoaleatorio con semilla fija, para que dos corridas iguales den lo mismo.
let semilla = 20261116;
const rnd = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;

const NOMBRES = ["Sofía","Valeria","Lucía","Martina","Paula","Carolina","Micaela","Florencia","Agustina","Rocío","Belén","Luciana","Gabriela","Daniela","Romina","Natalia","Victoria","Milagros","Antonella","Camila","Celeste","Jimena","Lorena","Mariana","Pilar","Guadalupe","Malena","Brenda","Josefina","Abril","Silvina","Andrea","Verónica","Noelia","Melina","Candela","Julia","Eugenia","Marcela","Lara"];
const APELLIDOS = ["García","Fernández","González","Rodríguez","López","Martínez","Pérez","Gómez","Sánchez","Romero","Díaz","Álvarez","Torres","Ruiz","Ramírez","Flores","Benítez","Acosta","Medina","Herrera","Suárez","Aguirre","Giménez","Molina","Castro","Ortiz","Silva","Rojas","Núñez","Luna"];
const NOTAS = ["Prefiere tonos nude", "Primera vez en la sede", "Trae su propio esmalte", "Pidió que le avisen si se libera antes", "Alérgica al látex", "Viene con la hija"];
// Las uñas son lo más pedido.
const peso = (categoria: string) => /nails|manos|pies/i.test(categoria) ? 6 : /cejas|depil/i.test(categoria) ? 2 : 1;

// Minutos desde la medianoche local de una fecha (YYYY-MM-DD) en la zona de la sede → instante UTC.
function instanteLocal(fecha: string, minutos: number, timezone: string) {
  const base = new Date(`${fecha}T12:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(base).map(x => [x.type, x.value]));
  const offset = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - base.getTime();
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - offset + minutos * 60e3);
}
const fechaLocal = (d: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);

type Servicio = { id: string; categoria: string; dur: number; ba: number; bd: number; precio: Prisma.Decimal };
type Sede = { id: string; organizacionId: string; nombre: string; timezone: string };
type Resumen = { totales: Record<string, number>; porDia: Record<string, number> };
class Simulacion extends Error { constructor(readonly resumen: Resumen) { super("simulación"); } }

const db = createDatabase();
try {
  const sedes = await db.sede.findMany({ where: { nombre: { equals: NOMBRE_SEDE, mode: "insensitive" }, activo: true } });
  if (sedes.length !== 1) throw new Error(`Se esperaba una sede activa llamada «${NOMBRE_SEDE}» y hay ${sedes.length}.`);
  const sede = sedes[0]!;
  let resumen: Resumen;
  try {
    resumen = await db.$transaction(async tx => {
      const r = await generar(tx, sede);
      if (!APLICAR) throw new Simulacion(r);
      return r;
    }, { timeout: 120_000 });
  } catch (e) {
    if (!(e instanceof Simulacion)) throw e;
    resumen = e.resumen;
  }
  console.info({ sede: sede.nombre, ...resumen.totales });
  console.table(resumen.porDia);
  console.info(APLICAR ? "Aplicado." : "Simulación: no se guardó nada. Agregar --aplicar para confirmarlo.");
} finally { await db.$disconnect(); }

async function generar(tx: Prisma.TransactionClient, sede: Sede): Promise<Resumen> {
  const org = sede.organizacionId;
  const slug = sede.nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const recepcion = await tx.asignacionRol.findFirst({ where: { organizacionId: org, rol: "RECEPCIONISTA", sedeId: sede.id } });
  const recepId = recepcion?.usuarioId ?? null;

  const clientes: string[] = [];
  let nuevas = 0;
  for (const [i, nombre] of NOMBRES.entries()) {
    const email = `demo.${slug}.${i + 1}@example.invalid`;
    let cliente = await tx.cliente.findUnique({ where: { organizacionId_email: { organizacionId: org, email } } });
    if (!cliente) {
      const telefono = `+54 9 351 ${300 + Math.floor(rnd() * 600)}-${String(Math.floor(rnd() * 10000)).padStart(4, "0")}`;
      cliente = await tx.cliente.create({ data: { organizacionId: org, nombre, apellido: pick(APELLIDOS), email, telefono, sexo: "FEMENINO" } });
      nuevas++;
    }
    await tx.clienteSede.upsert({ where: { clienteId_sedeId: { clienteId: cliente.id, sedeId: sede.id } }, create: { organizacionId: org, clienteId: cliente.id, sedeId: sede.id }, update: {} });
    clientes.push(cliente.id);
  }

  const ahora = new Date();
  const hoy = fechaLocal(ahora, sede.timezone);
  const desdeFecha = new Date(`${hoy}T00:00:00Z`);
  const hastaFecha = new Date(desdeFecha.getTime() + DIAS * 86400e3);
  const horarios = await tx.horarioProfesional.findMany({
    where: { sedeId: sede.id, profesional: { activo: true, sedes: { some: { sedeId: sede.id, activo: true } } },
      AND: [{ OR: [{ vigenteDesde: null }, { vigenteDesde: { lte: hastaFecha } }] }, { OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: desdeFecha } }] }] },
    orderBy: [{ profesionalId: "asc" }, { diaSemana: "asc" }, { inicioMinutos: "asc" }],
  });
  const habilitados = await tx.profesionalServicio.findMany({
    where: { organizacionId: org, servicio: { activo: true, nombre: { not: "Prueba de cobro" }, categoria: { activo: true }, sedes: { some: { sedeId: sede.id, habilitado: true, precio: { not: null } } } } },
    include: { servicio: { include: { categoria: true, sedes: { where: { sedeId: sede.id } } } } },
  });
  const porProf = new Map<string, Servicio[]>();
  for (const h of habilitados) {
    const ss = h.servicio.sedes[0]!;
    const lista = porProf.get(h.profesionalId) ?? [];
    lista.push({ id: h.servicioId, categoria: h.servicio.categoria.nombre, dur: ss.duracionMinutos ?? h.servicio.duracionMinutos, ba: h.servicio.bufferAntesMinutos, bd: h.servicio.bufferDespuesMinutos, precio: ss.precio! });
    porProf.set(h.profesionalId, lista);
  }
  const elegir = (lista: Servicio[]) => {
    let r = rnd() * lista.reduce((a, s) => a + peso(s.categoria), 0);
    for (const s of lista) if ((r -= peso(s.categoria)) <= 0) return s;
    return lista.at(-1)!;
  };

  // Lo que ya ocupa agenda (en cualquier sede) y las ausencias: no se pisan.
  const ocupado = (await tx.reservaItem.findMany({
    where: { ocupaHasta: { gt: ahora }, reserva: { OR: [{ estado: { in: ["CONFIRMADA", "ATENDIDA", "AUSENTE"] } }, { estado: { in: ["PENDIENTE_PAGO", "PAGO_EN_REVISION"] }, expiraEn: { gt: ahora } }] } },
    select: { profesionalId: true, ocupaDesde: true, ocupaHasta: true },
  })).map(o => ({ pid: o.profesionalId, a: o.ocupaDesde, b: o.ocupaHasta }));
  for (const b of await tx.bloqueoAgenda.findMany({ where: { fin: { gt: ahora } } })) ocupado.push({ pid: b.profesionalId, a: b.inicio, b: b.fin });
  const choca = (pid: string, a: Date, b: Date) => ocupado.some(o => o.pid === pid && o.a < b && a < o.b);
  const cerrados = new Set((await tx.excepcionHorario.findMany({ where: { organizacionId: org, cerrado: true, OR: [{ sedeId: sede.id }, { sedeId: null }], fecha: { gte: desdeFecha } } }))
    .map(e => e.fecha.toISOString().slice(0, 10)));

  const reservas: Prisma.ReservaCreateManyInput[] = [], items: Prisma.ReservaItemCreateManyInput[] = [], eventos: Prisma.ReservaEventoCreateManyInput[] = [];
  const porDia: Record<string, number> = {};
  let canceladas = 0;
  for (let k = 0; k <= DIAS; k++) {
    const fecha = new Date(desdeFecha.getTime() + k * 86400e3).toISOString().slice(0, 10);
    if (cerrados.has(fecha)) continue;
    const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    const instante = (min: number) => instanteLocal(fecha, min, sede.timezone);
    for (const h of horarios.filter(h => h.diaSemana === dia)) {
      const lista = porProf.get(h.profesionalId);
      if (!lista?.length) continue;
      let m = h.inicioMinutos;
      while (m < h.finMinutos) {
        const s1 = elegir(lista);
        if (rnd() > OCUPACION || m + s1.dur > h.finMinutos || instante(m) < ahora) { m += 30; continue; }
        const servicios = [s1];
        let fin = m + s1.dur;
        if (rnd() < 0.15) {
          const s2 = elegir(lista);
          if (s2.id !== s1.id && fin + s2.dur <= h.finMinutos) { servicios.push(s2); fin += s2.dur; }
        }
        const desde = instante(m - s1.ba), hasta = instante(fin + servicios.at(-1)!.bd);
        if (choca(h.profesionalId, desde, hasta)) { m += 30; continue; }
        const cancelada = rnd() < 0.05;
        const canal = rnd() < 0.55 ? "ONLINE" as const : "RECEPCION" as const;
        const creada = new Date(Math.min(ahora.getTime() - 60e3, instante(m).getTime() - Math.floor(rnd() * 10 * 86400e3) - 3600e3));
        const id = randomUUID();
        reservas.push({ id, organizacionId: org, sedeId: sede.id, clienteId: pick(clientes), canal, estado: cancelada ? "CANCELADA" : "CONFIRMADA",
          notas: rnd() < 0.15 ? pick(NOTAS) : null, creadoPor: canal === "RECEPCION" ? recepId : null, createdAt: creada });
        let t = m;
        for (const [posicion, s] of servicios.entries()) {
          items.push({ organizacionId: org, reservaId: id, posicion, servicioId: s.id, profesionalId: h.profesionalId,
            inicio: instante(t), fin: instante(t + s.dur), ocupaDesde: instante(t - s.ba), ocupaHasta: instante(t + s.dur + s.bd),
            duracionMinutos: s.dur, bufferAntesMinutos: s.ba, bufferDespuesMinutos: s.bd, precio: s.precio });
          t += s.dur;
        }
        eventos.push({ organizacionId: org, reservaId: id, tipo: "CREADA", estadoNuevo: "CONFIRMADA", actorId: canal === "RECEPCION" ? recepId : null, detalle: { canal, exigeSena: false }, createdAt: creada });
        if (cancelada) {
          eventos.push({ organizacionId: org, reservaId: id, tipo: "CANCELADA", estadoAnterior: "CONFIRMADA", estadoNuevo: "CANCELADA", detalle: { motivo: "La clienta avisó que no puede venir" } });
          canceladas++;
        } else ocupado.push({ pid: h.profesionalId, a: desde, b: hasta });
        porDia[fecha] = (porDia[fecha] ?? 0) + 1;
        m = fin + (rnd() < 0.3 ? 15 : 0);
      }
    }
  }
  await tx.reserva.createMany({ data: reservas });
  await tx.reservaItem.createMany({ data: items });
  await tx.reservaEvento.createMany({ data: eventos });
  return { totales: { clientas: clientes.length, clientasNuevas: nuevas, turnos: reservas.length, servicios: items.length, canceladas }, porDia };
}
