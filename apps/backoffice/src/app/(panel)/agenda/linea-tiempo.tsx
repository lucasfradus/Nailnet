import { aUtc } from "@nailnet/domain/agenda";
import type { agendaDia } from "@nailnet/database/agenda-dia";

type Dia = Awaited<ReturnType<typeof agendaDia>>;
type Turno = Dia["turnos"][number];

// Agenda del día en línea de tiempo: una fila por profesional, las horas de izquierda a derecha y cada
// servicio como un bloque del largo de su duración. Es para mirar el día de un vistazo; las acciones de
// cada turno siguen en la lista de abajo (tocar un bloque lleva a su fila).

/** Clase y texto del bloque según el estado del servicio. */
function estadoDe(t: Turno, ahora: number | null, fin: number) {
  if (t.estado === "AUSENTE") return { clase: "lt-ausente", texto: "Ausente" };
  if (t.estado === "COBRADA") return { clase: "lt-cobrada", texto: "Cobrado" };
  if (t.estado === "POR_COBRAR" || t.terminadoEn) return { clase: "lt-cobrar", texto: "Terminó, por cobrar" };
  if (t.estado === "EN_SESION") return ahora !== null && ahora > fin
    ? { clase: "lt-curso", texto: `En atención · demorada ${ahora - fin} min` }
    : { clase: "lt-curso", texto: "En atención" };
  if (t.estado === "PENDIENTE_PAGO") return { clase: "lt-pendiente", texto: "Pendiente de seña" };
  return { clase: "lt-reservado", texto: "Turno reservado" };
}

export function LineaDeTiempo({ dia, ahora, profesionalId }: { dia: Dia; ahora: Date; profesionalId?: string | null }) {
  const tz = dia.timezone;
  const cero = aUtc(dia.fecha, 0, tz).getTime();
  const min = (d: Date) => Math.round((d.getTime() - cero) / 60_000);
  const reloj = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const ahoraMin = dia.esHoy ? min(ahora) : null;

  // Rango: de la apertura de la sede al cierre, estirado si hay turnos fuera; redondeado a horas enteras.
  const bordes = [...dia.apertura.flatMap(a => [min(a.desde), min(a.hasta)]), ...dia.turnos.flatMap(t => [min(t.inicio), min(t.terminadoEn ?? t.fin)])];
  const D = bordes.length ? Math.floor(Math.min(...bordes) / 60) * 60 : 9 * 60;
  const F = bordes.length ? Math.max(D + 60, Math.ceil(Math.max(...bordes) / 60) * 60) : 20 * 60;
  const pct = (m: number) => ((Math.min(Math.max(m, D), F) - D) / (F - D)) * 100;
  const tramo = (desde: number, hasta: number) => ({ left: `${pct(desde)}%`, width: `${Math.max(0, pct(hasta) - pct(desde))}%` });
  const horas = Array.from({ length: (F - D) / 60 }, (_, k) => D + k * 60);

  const profesionales = dia.profesionales
    .filter(p => !profesionalId || p.id === profesionalId)
    .map(p => ({ ...p, jornada: p.jornada.map(j => ({ desde: min(j.desde), hasta: min(j.hasta) })), turnos: dia.turnos.filter(t => t.profesionalId === p.id) }))
    // Primero las que trabajan ese día; las que no tienen jornada ni turnos, al final.
    .sort((a, b) => Number(!a.jornada.length && !a.turnos.length) - Number(!b.jornada.length && !b.turnos.length));

  if (!profesionales.length) return null;

  return <div className="lt">
    <div className="lt-scroll" role="region" aria-label="Agenda del día por profesional" tabIndex={0}>
      <div className="lt-lienzo">
        <div className="lt-fila lt-cabecera" aria-hidden>
          <div className="lt-nombre" />
          <div className="lt-pista">{horas.map(h => <span key={h} className="lt-hora" style={{ left: `${pct(h)}%` }}>{reloj(h)}</span>)}</div>
        </div>
        {profesionales.map(p => {
          const enSesion = ahoraMin !== null && p.turnos.some(t => t.estado === "EN_SESION" && !t.terminadoEn);
          const estado = !p.jornada.length ? "no trabaja hoy" : enSesion ? "atendiendo" : p.jornada.map(j => `${reloj(j.desde)}–${reloj(j.hasta)}`).join(" · ");
          // Fuera de su horario: lo que queda del rango sacando la jornada.
          const fuera: { desde: number; hasta: number }[] = [];
          let cursor = D;
          for (const j of [...p.jornada].sort((a, b) => a.desde - b.desde)) { if (j.desde > cursor) fuera.push({ desde: cursor, hasta: j.desde }); cursor = Math.max(cursor, j.hasta); }
          if (cursor < F) fuera.push({ desde: cursor, hasta: F });
          return <div key={p.id} className={`lt-fila${p.jornada.length || p.turnos.length ? "" : " lt-libre-dia"}`}>
            <div className="lt-nombre"><strong>{p.nombre}</strong><small>{estado}</small></div>
            <div className="lt-pista">
              {horas.map(h => <span key={h} className="lt-linea" style={{ left: `${pct(h)}%` }} />)}
              {fuera.map(f => <span key={f.desde} className="lt-fuera" style={tramo(f.desde, f.hasta)} />)}
              {p.ausencias.map(a => <span key={a.desde.toISOString()} className="lt-bloqueo" style={tramo(min(a.desde), min(a.hasta))} title={`Ausencia ${reloj(min(a.desde))}–${reloj(min(a.hasta))}${a.motivo ? ` · ${a.motivo}` : ""}`} />)}
              {p.turnos.map(t => {
                const ini = min(t.inicio), fin = min(t.terminadoEn ?? t.fin);
                const { clase, texto } = estadoDe(t, ahoraMin, fin);
                const cliente = t.cliente ? [t.cliente.nombre, t.cliente.apellido].filter(Boolean).join(" ") : "Clienta sin ficha";
                const demora = clase === "lt-curso" && ahoraMin !== null && ahoraMin > fin;
                const titulo = `${reloj(ini)}–${reloj(fin)} · ${cliente} · ${t.servicio} · ${texto}${t.canal === "ONLINE" ? " · online" : ""}`;
                return [
                  <a key={t.itemId} href={`#t-${t.itemId}`} className={`lt-bloque ${clase}`} style={tramo(ini, fin)} title={titulo} aria-label={titulo}>
                    <b>{t.cliente?.nombre ?? "Sin ficha"}</b><span>{t.servicio}</span>
                  </a>,
                  demora && <span key={`${t.itemId}-demora`} className="lt-demora" style={tramo(fin, ahoraMin!)} title={`Demorada ${ahoraMin! - fin} min`} />,
                ];
              })}
            </div>
          </div>;
        })}
        {ahoraMin !== null && ahoraMin >= D && ahoraMin <= F && <div className="lt-ahora" style={{ left: `calc(var(--lt-nombre) + (100% - var(--lt-nombre)) * ${pct(ahoraMin) / 100})` }}><span>{reloj(ahoraMin)}</span></div>}
      </div>
    </div>
    <div className="lt-leyenda" aria-label="Referencias">
      <span><i className="lt-reservado" />Turno reservado</span>
      <span><i className="lt-pendiente" />Pendiente de seña</span>
      <span><i className="lt-curso" />En atención</span>
      <span><i className="lt-demora" />Demorada (pasó el estimado)</span>
      <span><i className="lt-cobrar" />Terminó, por cobrar</span>
      <span><i className="lt-cobrada" />Cobrado</span>
      <span><i className="lt-fuera" />Fuera de su horario</span>
    </div>
  </div>;
}
