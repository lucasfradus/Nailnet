"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BuscadorServicio, type ServicioBuscable } from "@/components/buscador-servicio";

export type ServicioAhora = ServicioBuscable;
export type ProfesionalAhora = { id: string; nombre: string; presente: boolean; estado: "libre" | "ocupada" | "fuera"; hasta: string | null; servicioIds: string[]; entranAhora: string[] };
type Fila = { servicio: string; profesional: string; juntos: boolean };

/**
 * Servicios y profesionales de «Atender ahora». Lo que empieza ya (el primero y los marcados «a la vez»)
 * solo ofrece a las profesionales que pueden empezarlo en este minuto; el resto aparece deshabilitado con
 * el motivo. Lo que va a continuación solo filtra por quién hace el servicio: el motor lo valida al tomar.
 */
export function ServiciosAhora({ servicios, profesionales, filas: cantidad, clienteId, inicial }: {
  servicios: ServicioAhora[]; profesionales: ProfesionalAhora[]; filas: number; clienteId: string; inicial: { servicio?: string; profesional?: string };
}) {
  const [filas, setFilas] = useState<Fila[]>(() => Array.from({ length: cantidad }, (_, i) => ({ servicio: i === 0 ? inicial.servicio ?? "" : "", profesional: i === 0 ? inicial.profesional ?? "" : "", juntos: false })));
  const cambiar = (i: number, cambio: Partial<Fila>) => setFilas(fs => fs.map((f, n) => n === i ? { ...f, ...cambio } : f));
  // Cuántas pueden empezar cada servicio ya: se muestra en el buscador del primero.
  const libres = useMemo(() => new Map(servicios.map(s => [s.id, profesionales.filter(p => p.entranAhora.includes(s.id)).length])), [servicios, profesionales]);
  const primero = servicios.find(s => s.id === filas[0]!.servicio);

  return <>
    {filas.map((f, i) => {
      const ahora = i === 0 || f.juntos;
      const opciones = profesionales.filter(p => !f.servicio || p.servicioIds.includes(f.servicio)).map(p => ({ ...p, ...disponibilidad(p, f.servicio, ahora) }))
        .sort((a, b) => Number(b.puede) - Number(a.puede) || Number(b.presente) - Number(a.presente));
      // Si cambió el servicio y la elegida ya no puede, se descarta en vez de mandar algo que el motor va a rechazar.
      const elegida = opciones.some(o => o.id === f.profesional && o.puede) ? f.profesional : "";
      return <div key={i} className="grilla">
        <BuscadorServicio id={`s_${i}`} servicios={servicios} valor={f.servicio} placeholder={i === 0 ? "Buscá un servicio…" : "+ Otro servicio (opcional)"}
          pista={i === 0 ? id => { const n = libres.get(id) ?? 0; return n ? `${n} libre${n > 1 ? "s" : ""}` : "nadie libre"; } : undefined}
          onElegir={servicio => { cambiar(i, { servicio }); if (servicio) requestAnimationFrame(() => document.getElementById(`p_${i}`)?.focus()); }} />
        <select id={`p_${i}`} name={`p_${i}`} value={elegida} onChange={e => cambiar(i, { profesional: e.target.value })} aria-label={`Profesional del servicio ${i + 1}`} required={i === 0 || !!f.servicio}>
          <option value="">{f.servicio && ahora && !opciones.some(o => o.puede) ? "Nadie puede empezarlo ahora" : "Profesional"}</option>
          {opciones.filter(o => o.puede).map(o => <option key={o.id} value={o.id}>{o.nombre}{o.detalle ? ` · ${o.detalle}` : ""}</option>)}
          {opciones.some(o => !o.puede) && <optgroup label="No disponibles ahora">
            {opciones.filter(o => !o.puede).map(o => <option key={o.id} value={o.id} disabled>{o.nombre} · {o.detalle}</option>)}
          </optgroup>}
        </select>
        {i > 0 && <label className="check"><input type="checkbox" name={`j_${i}`} value="1" checked={f.juntos} onChange={e => cambiar(i, { juntos: e.target.checked })} />A la vez con el anterior (otra profesional)</label>}
      </div>;
    })}
    {primero && !libres.get(primero.id) && <p className="alerta aviso">Nadie puede empezar {primero.nombre} ahora (ocupadas, fuera de horario o no les entra antes del próximo turno). <Link href={`/agenda/nuevo?${new URLSearchParams({ cliente: clienteId, s: primero.id })}`}>Reservar un turno para más tarde</Link></p>}
  </>;
}

/** Si la profesional puede tomar el servicio de esta fila y, si no, por qué. */
function disponibilidad(p: ProfesionalAhora, servicio: string, ahora: boolean): { puede: boolean; detalle: string | null } {
  if (!ahora) return { puede: true, detalle: null };
  if (p.estado === "ocupada") return { puede: false, detalle: p.hasta ? `ocupada hasta ${p.hasta}` : "ocupada" };
  if (p.estado === "fuera") return { puede: false, detalle: "fuera de su horario" };
  if (servicio && !p.entranAhora.includes(servicio)) return { puede: false, detalle: `libre hasta ${p.hasta}, no le entra` };
  return { puede: true, detalle: p.presente ? null : "no marcó entrada" };
}
