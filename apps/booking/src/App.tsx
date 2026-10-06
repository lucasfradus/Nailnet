import { useCallback, useState } from "react";
import type { ProfesionalPublico, SedePublica, ServicioPublico, TurnoPublico } from "@nailnet/contracts/publico";
import { fechaEn } from "./formato";
import { PasoDatos, PasoHorario, PasoProfesional, PasoSede, PasoServicio, Resumen, type Contacto } from "./pasos";
import { EstadoReserva, guardarReserva, leerReservaGuardada, type ReservaGuardada } from "./reserva";

type Seleccion = {
  sede?: SedePublica; sedeUnica?: boolean; servicio?: ServicioPublico;
  /** `null` es «cualquier profesional» (D16); `undefined`, todavía sin elegir. */
  profesional?: ProfesionalPublico | null;
  fecha?: string; turno?: TurnoPublico;
};
type NombrePaso = "sede" | "servicio" | "profesional" | "horario" | "datos";
const ORDEN: NombrePaso[] = ["sede", "servicio", "profesional", "horario", "datos"];
const CONTACTO_VACIO: Contacto = { nombre: "", apellido: "", email: "", telefono: "" };

/** Recorrido P01: sede → servicio → profesional → horario → datos → estado de la reserva. */
export function App() {
  const [reserva, setReserva] = useState<ReservaGuardada | null>(leerReservaGuardada);
  const [paso, setPaso] = useState<NombrePaso>("sede");
  const [sel, setSel] = useState<Seleccion>({});
  const [contacto, setContacto] = useState(CONTACTO_VACIO);
  const [aviso, setAviso] = useState<string | null>(null);

  const ir = (siguiente: NombrePaso, cambios: Seleccion) => { setSel(s => ({ ...s, ...cambios })); setAviso(null); setPaso(siguiente); };
  const elegirSede = useCallback((sede: SedePublica, sedeUnica: boolean) => {
    setSel({ sede, sedeUnica }); setPaso("servicio");
  }, []);
  const primerPaso = sel.sedeUnica ? "servicio" : "sede";
  const atras = () => { setAviso(null); setPaso(ORDEN[Math.max(ORDEN.indexOf(primerPaso), ORDEN.indexOf(paso) - 1)]!); };

  function terminar(nueva: ReservaGuardada | null) {
    guardarReserva(nueva); setReserva(nueva);
  }
  function reiniciar() {
    terminar(null); setSel(s => (s.sedeUnica ? { sede: s.sede, sedeUnica: true } : {})); setAviso(null);
    setPaso(sel.sedeUnica ? "servicio" : "sede");
  }

  let contenido;
  if (reserva) {
    // Tras una reserva vencida se puede volver a los horarios con la misma elección, si sigue en memoria.
    const puedeVolver = !!(sel.sede && sel.servicio && sel.profesional !== undefined);
    contenido = <EstadoReserva reserva={reserva} onNueva={reiniciar} onOtroHorario={puedeVolver ? () => { terminar(null); ir("horario", { turno: undefined }); } : null} />;
  } else if (paso === "sede" || !sel.sede) contenido = <PasoSede onElegir={elegirSede} />;
  else if (paso === "servicio" || !sel.servicio) contenido = <PasoServicio sede={sel.sede} onElegir={servicio => ir("profesional", { servicio, profesional: undefined, turno: undefined })} />;
  else if (paso === "profesional" || sel.profesional === undefined) contenido = <PasoProfesional sede={sel.sede} servicio={sel.servicio} onElegir={profesional => ir("horario", { profesional, turno: undefined })} />;
  else if (paso === "horario" || !sel.turno) {
    const { sede } = sel;
    contenido = <PasoHorario sede={sede} servicio={sel.servicio} profesional={sel.profesional} fecha={sel.fecha ?? fechaEn(sede.timezone)} aviso={aviso}
      onFecha={fecha => setSel(s => ({ ...s, fecha }))} onElegir={turno => ir("datos", { turno })} />;
  } else {
    const { sede } = sel;
    contenido = <PasoDatos sede={sede} servicio={sel.servicio} profesional={sel.profesional} turno={sel.turno} contacto={contacto} onContacto={setContacto}
      onReservada={r => terminar({ token: r.token, timezone: sede.timezone })}
      onNoDisponible={mensaje => { setSel(s => ({ ...s, turno: undefined })); setAviso(mensaje); setPaso("horario"); }} />;
  }

  // El resumen muestra solo lo elegido en pasos anteriores al actual.
  const antes = (p: NombrePaso) => ORDEN.indexOf(p) < ORDEN.indexOf(paso);
  const numero = ORDEN.indexOf(paso) - ORDEN.indexOf(primerPaso) + 1, total = ORDEN.length - ORDEN.indexOf(primerPaso);
  return <main>
    <header><span className="marca"><img src="/sicurella-logo-teal.svg" alt="Sicurella" width={153} height={28} /></span>{!reserva && sel.sede && <span className="progreso">Paso {numero} de {total}</span>}</header>
    {!reserva && paso !== primerPaso && <button type="button" className="volver" onClick={atras}>← Volver</button>}
    {!reserva && <Resumen sede={antes("sede") ? sel.sede : undefined} servicio={antes("servicio") ? sel.servicio : undefined}
      profesional={antes("profesional") ? sel.profesional : undefined} turno={antes("horario") ? sel.turno : undefined} />}
    {contenido}
    <footer>Reservá online en pocos pasos. Los horarios se muestran en la hora de la sede.</footer>
  </main>;
}
