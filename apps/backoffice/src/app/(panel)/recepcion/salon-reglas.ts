import type { disponiblesAhora } from "@nailnet/database/disponibilidad";
import { nombreCompleto, type Tablero } from "./comun";

// Quién puede qué en el salón (doc 31, etapas 2 y 3). La pantalla no calcula la agenda: usa lo que dice el
// motor en `disponiblesAhora` (jornada, ausencias y turnos de cada profesional) y, para cambiar de profesional
// un turno, las candidatas de `destinosDeTurno`. Es orientativo: el servidor revalida con locks al operar.

export type Profesional = Tablero["profesionales"][number];
export type Disponible = Awaited<ReturnType<typeof disponiblesAhora>>["profesionales"][number];
export type TurnoPorLlegar = Tablero["porLlegar"][number];
/**
 * `puede`: elegible. `pisa`: elegible con aviso, pisando un turno suyo que todavía no empezó («sentar igual»:
 * el sistema avisa, no traba). `no`: no se puede saltar (atiende, no hace el servicio, fuera de su horario).
 */
export type Evaluacion = { nivel: "puede" } | { nivel: "pisa"; motivo: string } | { nivel: "no"; motivo: string | null };

export const MIN = 60_000;
const PUEDE: Evaluacion = { nivel: "puede" };
const no = (motivo: string | null): Evaluacion => ({ nivel: "no", motivo });

export function reglas({ tablero, disponibles, ahora, hora }: { tablero: Tablero; disponibles: Disponible[]; ahora: number; hora: (d: Date | number) => string }) {
  const servicios = new Map(tablero.servicios.map(s => [s.id, s]));
  const disp = new Map(disponibles.map(d => [d.id, d]));
  const nombreServicio = (id: string) => servicios.get(id)?.nombre ?? "este servicio";

  /** Qué turno pisaría: el próximo reservado de la profesional, con su hora y su clienta. */
  const pisaTexto = (p: Profesional) => {
    const t = p.proximo;
    if (!t) return "Pisa un turno suyo";
    const quien = t.cliente ? ` (${nombreCompleto(t.cliente)})` : "";
    const donde = t.otraSede ? " en otra sede" : "";
    return t.inicio.getTime() <= ahora ? `Pisa su turno de las ${hora(t.inicio)}${quien}${donde}, que todavía no llegó` : `Pisa su turno de las ${hora(t.inicio)}${quien}${donde}`;
  };
  /** Por qué no le entra aunque pise sus turnos: su horario o algo que no se pisa (una ausencia). */
  const fuera = (d: Disponible | undefined) => {
    if (!d || d.estado === "fuera" || !d.finJornada) return "fuera de su horario";
    if (!d.libreHasta) return "no está libre ahora";
    if (d.libreHasta.getTime() < d.finJornada.getTime()) return `solo está libre hasta las ${hora(d.libreHasta)}`;
    return `fuera de su horario: termina a las ${hora(d.finJornada)}`;
  };

  /**
   * Empezar ahora un servicio (sentar una espera, una clienta con turno, sumar un servicio). `propia`: el
   * turno que se está sentando; si lo único que pisa es ese mismo turno, no pisa nada.
   */
  const ahoraPara = (p: Profesional, servicioId: string, propia?: string): Evaluacion => {
    // La que atiende ya se ve en «Atendiendo»: no hace falta decir por qué no.
    if (p.atencion) return no(null);
    if (!p.servicioIds.includes(servicioId)) return no(`no hace ${nombreServicio(servicioId)}`);
    const d = disp.get(p.id);
    if (d?.entranAhora.includes(servicioId)) return PUEDE;
    if (d?.entranPisando.includes(servicioId)) return propia && p.proximo?.reservaId === propia ? PUEDE : { nivel: "pisa", motivo: pisaTexto(p) };
    return no(fuera(d));
  };

  /** Recibir lo que hace otra profesional en una atención en curso, hasta su fin estimado (`pasarAtencion`). */
  const pasarA = (p: Profesional, origen: Profesional): Evaluacion => {
    const a = origen.atencion;
    if (!a || p.id === origen.id) return no(null);
    if (p.atencion) return no(null);
    const falta = a.servicioIds.find(s => !p.servicioIds.includes(s));
    if (falta) return no(`no hace ${nombreServicio(falta)}`);
    const d = disp.get(p.id);
    const fin = Math.max(a.finEstimado.getTime(), ahora + MIN);
    if (d?.estado === "libre" && d.hasta && d.hasta.getTime() >= fin) return PUEDE;
    if (d?.libreHasta && d.libreHasta.getTime() >= fin) return { nivel: "pisa", motivo: pisaTexto(p) };
    return no(fuera(d));
  };

  /** Tomar un turno por llegar a la misma hora: las candidatas las dio el servidor (`null` mientras carga). */
  const turnoPara = (p: Profesional, turno: TurnoPorLlegar, candidatas: string[] | null): Evaluacion => {
    if (turno.items.some(i => i.profesionalId === p.id)) return no("ya tiene este turno");
    if (!candidatas) return no(null);
    if (candidatas.includes(p.id)) return PUEDE;
    const s = turno.items[0]?.servicioId;
    if (s && !p.servicioIds.includes(s)) return no(`no hace ${nombreServicio(s)}`);
    return no(`no tiene libre las ${hora(turno.inicio)}`);
  };

  /** Para la tarjeta de una libre: si está fuera de su horario o lo termina dentro de la franja (dos horas). */
  const jornada = (p: Profesional) => {
    const d = disp.get(p.id);
    if (!d || p.atencion) return null;
    if (d.estado === "fuera" || !d.finJornada) return "Fuera de su horario";
    return d.finJornada.getTime() - ahora <= 2 * 3_600_000 ? `Termina su horario a las ${hora(d.finJornada)}` : null;
  };

  return { nombreServicio, ahoraPara, pasarA, turnoPara, jornada };
}
