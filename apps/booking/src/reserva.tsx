import { useEffect, useState } from "react";
import type { EstadoReservaPublico } from "@nailnet/contracts/publico";
import { api, useCarga } from "./api";
import { dinero, fechaLarga, hora } from "./formato";
import { Foto, Paso } from "./pasos";

/** Lo que el portal guarda de una reserva: el token (se muestra una sola vez) y la zona de la sede para mostrar horas. */
export type ReservaGuardada = { token: string; timezone: string };

// sessionStorage y no localStorage: el token es una credencial y no debe sobrevivir a la pestaña.
// El acceso posterior llega con el enlace por email (P03).
const CLAVE = "nailnet.reserva";
export function leerReservaGuardada(): ReservaGuardada | null {
  try { const v = JSON.parse(sessionStorage.getItem(CLAVE) ?? "null") as ReservaGuardada | null; return v?.token && v.timezone ? v : null; }
  catch { return null; }
}
export function guardarReserva(r: ReservaGuardada | null) {
  try { if (r) sessionStorage.setItem(CLAVE, JSON.stringify(r)); else sessionStorage.removeItem(CLAVE); }
  catch { /* sin almacenamiento la reserva se ve igual; solo no sobrevive a recargar */ }
}

const TEXTOS: Record<EstadoReservaPublico, { titulo: string; detalle: string }> = {
  PENDIENTE_PAGO: { titulo: "Tu turno está reservado", detalle: "Lo retenemos mientras se acredita la seña. El pago online de la seña va a estar disponible muy pronto; si vence la retención, el horario se libera." },
  PAGO_EN_REVISION: { titulo: "Estamos verificando tu pago", detalle: "Te avisamos apenas se acredite. No hace falta que pagues de nuevo." },
  CONFIRMADA: { titulo: "¡Listo! Tu turno está confirmado", detalle: "Te esperamos." },
  ATENDIDA: { titulo: "Turno realizado", detalle: "Gracias por elegirnos." },
  AUSENTE: { titulo: "El turno figura como ausente", detalle: "Si fue un error, comunicate con la sede." },
  CANCELADA: { titulo: "La reserva fue cancelada", detalle: "Si querés, podés reservar otro turno." },
  EXPIRADA: { titulo: "La reserva venció", detalle: "No se acreditó la seña a tiempo y el horario se liberó. Podés elegir otro." },
};

function useCuentaRegresiva(hasta: string | null) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!hasta) return;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasta]);
  return hasta ? Math.max(0, new Date(hasta).getTime() - ahora) : null;
}

/**
 * Estado real de la reserva, siempre consultado al backend: el portal nunca confirma por su cuenta.
 * Al vencer la retención vuelve a consultar (el backend informa EXPIRADA aunque el worker no haya pasado).
 */
export function EstadoReserva({ reserva, onNueva, onOtroHorario }: { reserva: ReservaGuardada; onNueva: () => void; onOtroHorario: (() => void) | null }) {
  const carga = useCarga(s => api.reservaActual(reserva.token, s), [reserva.token]);
  const estado = carga.datos;
  const pendiente = estado?.estado === "PENDIENTE_PAGO" ? estado.expiraEn : null;
  const restante = useCuentaRegresiva(pendiente);
  const vencida = restante === 0;
  const { recargar } = carga;
  // Solo al llegar a cero; `recargar` cambia en cada render.
  useEffect(() => { if (vencida) recargar(); }, [vencida]);

  if (carga.cargando && !estado) return <Paso titulo="Consultando tu reserva…"><p className="cargando" role="status">Un momento…</p></Paso>;
  if (carga.error || !estado) {
    const noEsta = carga.error?.codigo === "NO_ENCONTRADO";
    return <Paso titulo={noEsta ? "No encontramos la reserva" : "No pudimos consultar la reserva"}>
      <p className="ayuda">{noEsta ? "El acceso venció o fue reemplazado por uno más nuevo." : carga.error?.message}</p>
      <div className="acciones">{!noEsta && <button type="button" className="principal" onClick={carga.recargar}>Reintentar</button>}<button type="button" className="secundario" onClick={onNueva}>Hacer otra reserva</button></div>
    </Paso>;
  }
  const texto = TEXTOS[estado.estado];
  const tz = reserva.timezone;
  return <Paso titulo={texto.titulo}>
    <p className={`estado estado-${estado.estado.toLowerCase()}`} role="status">{texto.detalle}</p>
    {restante !== null && restante > 0 && <p className="retencion">Retenido por <strong>{formatoRestante(restante)}</strong> (hasta las {hora(pendiente!, tz)} h)</p>}
    <div className="ticket">
      {estado.items.map((i, n) => <div key={n} className="ticket-item">
        <Foto ruta={i.imagenUrl} nombre={i.servicio} className="ticket-foto" />
        <div className="ticket-cuerpo">
          <strong>{i.servicio}</strong>
          <span className="ticket-cuando">{fechaLarga(i.inicio, tz)} · {hora(i.inicio, tz)} h</span>
          <span className="con-avatar"><Foto ruta={i.fotoUrl} nombre={i.profesional} className="avatar mini" />con {i.profesional}</span>
        </div>
      </div>)}
      <dl>
        <div><dt>Sede</dt><dd>{estado.sede}</dd></div>
        <div><dt>Seña</dt><dd>{dinero(estado.sena)}</dd></div>
      </dl>
    </div>
    <div className="acciones">
      {estado.estado === "EXPIRADA" && onOtroHorario && <button type="button" className="principal" onClick={onOtroHorario}>Elegir otro horario</button>}
      {estado.estado === "PENDIENTE_PAGO" && <button type="button" className="secundario" onClick={carga.recargar} disabled={carga.cargando}>Actualizar estado</button>}
      <button type="button" className="secundario" onClick={onNueva}>Hacer otra reserva</button>
    </div>
  </Paso>;
}

function formatoRestante(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
