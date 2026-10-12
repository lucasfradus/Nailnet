import { useEffect, useState } from "react";
import type { EstadoPagoPublico, EstadoReservaPublico } from "@nailnet/contracts/publico";
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
  PENDIENTE_PAGO: { titulo: "Tu turno está reservado", detalle: "Lo retenemos mientras pagás la seña con Mercado Pago. Si vence la retención, el horario se libera." },
  PAGO_EN_REVISION: { titulo: "Estamos verificando tu pago", detalle: "Te avisamos apenas se acredite. No hace falta que pagues de nuevo." },
  CONFIRMADA: { titulo: "¡Listo! Tu turno está confirmado", detalle: "Te esperamos." },
  ATENDIDA: { titulo: "Turno realizado", detalle: "Gracias por elegirnos." },
  AUSENTE: { titulo: "El turno figura como ausente", detalle: "Si fue un error, comunicate con la sede." },
  CANCELADA: { titulo: "La reserva fue cancelada", detalle: "Si querés, podés reservar otro turno." },
  EXPIRADA: { titulo: "La reserva venció", detalle: "No se acreditó la seña a tiempo y el horario se liberó. Podés elegir otro." },
};

/** Situaciones del pago que cambian el mensaje aunque la reserva no cambie de estado. */
const AVISO_PAGO: Partial<Record<EstadoPagoPublico, string>> = {
  RECHAZADO: "Mercado Pago rechazó el pago. Podés intentar de nuevo, con otro medio si hace falta, mientras dure la retención.",
  EN_PROCESO: "Mercado Pago está procesando el pago. Te avisamos apenas se acredite; no hace falta que pagues de nuevo.",
};
const A_DEVOLVER = { titulo: "Recibimos tu pago, pero no pudimos confirmar el turno", detalle: "El horario ya no estaba disponible cuando se acreditó la seña. La sede se va a comunicar con vos para devolvértela o acordar otro horario." };

/**
 * Vuelta desde Mercado Pago (`?pago=retorno&payment_id=…`). Pide al backend que consulte ese pago y
 * limpia la URL. El estado que se muestra sigue saliendo del backend: los parámetros del retorno se
 * pueden manipular y no confirman nada.
 */
function useRetornoDePago(token: string) {
  const [retorno] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("pago") !== "retorno") return null;
    return { pagoId: q.get("payment_id") ?? q.get("collection_id") };
  });
  useEffect(() => {
    if (!retorno) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (retorno.pagoId && /^\d{1,30}$/.test(retorno.pagoId)) api.verificarPago(token, retorno.pagoId).catch(() => { /* la notificación de Mercado Pago llega igual */ });
  }, [retorno, token]);
  return retorno !== null;
}

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

  // Al volver de Mercado Pago la acreditación tarda unos segundos: consultar seguido durante un minuto
  // mientras la reserva siga esperando la seña.
  const volvioDePago = useRetornoDePago(reserva.token);
  const [consultas, setConsultas] = useState(0);
  const esperando = volvioDePago && consultas < 20 && (estado?.estado === "PENDIENTE_PAGO" || estado?.estado === "PAGO_EN_REVISION") && estado.pago !== "RECHAZADO";
  useEffect(() => {
    if (!esperando || carga.cargando) return;
    const id = setTimeout(() => { setConsultas(c => c + 1); recargar(); }, 3000);
    return () => clearTimeout(id);
  }, [esperando, carga.cargando, consultas]);

  const [pagando, setPagando] = useState<{ error?: string; enCurso?: boolean }>({});
  async function pagar() {
    setPagando({ enCurso: true });
    try { window.location.assign((await api.pagarSena(reserva.token)).url); }
    catch (e) { setPagando({ error: e instanceof Error ? e.message : "No pudimos iniciar el pago. Probá de nuevo." }); }
  }

  if (carga.cargando && !estado) return <Paso titulo="Consultando tu reserva…"><p className="cargando" role="status">Un momento…</p></Paso>;
  if (carga.error || !estado) {
    const noEsta = carga.error?.codigo === "NO_ENCONTRADO";
    return <Paso titulo={noEsta ? "No encontramos la reserva" : "No pudimos consultar la reserva"}>
      <p className="ayuda">{noEsta ? "El acceso venció o fue reemplazado por uno más nuevo." : carga.error?.message}</p>
      <div className="acciones">{!noEsta && <button type="button" className="principal" onClick={carga.recargar}>Reintentar</button>}<button type="button" className="secundario" onClick={onNueva}>Hacer otra reserva</button></div>
    </Paso>;
  }
  const texto = estado.pago === "A_DEVOLVER" && estado.estado !== "CONFIRMADA" ? A_DEVOLVER : TEXTOS[estado.estado];
  const avisoPago = estado.estado === "PENDIENTE_PAGO" && estado.pago ? AVISO_PAGO[estado.pago] : undefined;
  const puedePagar = estado.estado === "PENDIENTE_PAGO" && restante !== null && restante > 0 && estado.pago !== "EN_PROCESO";
  const tz = reserva.timezone;
  return <Paso titulo={texto.titulo}>
    <p className={`estado estado-${estado.estado.toLowerCase()}`} role="status">{texto.detalle}</p>
    {esperando && <p className="cargando" role="status">Verificando el pago con Mercado Pago…</p>}
    {avisoPago && !esperando && <p className="ayuda" role="status">{avisoPago}</p>}
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
    {pagando.error && <p className="error" role="alert">{pagando.error}</p>}
    <div className="acciones">
      {puedePagar && <button type="button" className="principal" onClick={pagar} disabled={pagando.enCurso}>{pagando.enCurso ? "Abriendo Mercado Pago…" : `Pagar seña de ${dinero(estado.sena)}`}</button>}
      {estado.estado === "EXPIRADA" && estado.pago !== "A_DEVOLVER" && onOtroHorario &&<button type="button" className="principal" onClick={onOtroHorario}>Elegir otro horario</button>}
      {estado.estado === "PENDIENTE_PAGO" && <button type="button" className="secundario" onClick={carga.recargar} disabled={carga.cargando}>Actualizar estado</button>}
      <button type="button" className="secundario" onClick={onNueva}>Hacer otra reserva</button>
    </div>
  </Paso>;
}

function formatoRestante(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
