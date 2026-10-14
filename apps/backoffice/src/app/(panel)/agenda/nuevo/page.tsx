import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { aLocal, validarFecha } from "@nailnet/domain/agenda";
import { aCentavos } from "@nailnet/domain/catalogo";
import { DatosInvalidos } from "@nailnet/database/access";
import { catalogoSede } from "@nailnet/database/catalogo";
import { listarClientes, obtenerCliente } from "@nailnet/database/clientes";
import { ConfiguracionIncompleta, consultarDisponibilidad } from "@nailnet/database/disponibilidad";
import { listarProfesionales } from "@nailnet/database/profesionales";
import { resumenReserva } from "@nailnet/database/reservas";
import { Formulario } from "@/components/formulario";
import { FormularioVivo } from "@/components/formulario-vivo";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { CamposCliente } from "../../clientes/campos";
import { accionCrearCliente, accionReprogramar, accionReservar } from "../../acciones";

export const metadata: Metadata = { title: "Nuevo turno · Sicurella" };
type Params = { fecha?: string; s?: string | string[]; p?: string | string[]; inicio?: string; cliente?: string; buscar?: string; reprogramar?: string };
const lista = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const sumar = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diaLargo = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "short" }).replace(".", "");
const pesos = (c: bigint) => `$ ${(c / 100n).toLocaleString("es-AR")}${c % 100n ? `,${(c % 100n).toString().padStart(2, "0")}` : ""}`;
const MAX_SERVICIOS = 3;
/** Si el día elegido no tiene lugar, se busca el próximo que sí dentro de este margen. */
const DIAS_BUSQUEDA = 14;
const FRANJAS = [{ nombre: "Mañana", hasta: 12 }, { nombre: "Tarde", hasta: 19 }, { nombre: "Noche", hasta: 24 }];

export default async function NuevoTurno({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const { sesion, organizacion, sedes, sede: sedeContexto, puede } = await requerirOrganizacion();
  if (!puede.verSedes) notFound();
  const actorId = sesion.usuario.id;
  // Modo reprogramar: sede, servicios y cliente vienen del turno original; solo cambian horario y profesional.
  const original = q.reprogramar ? await resumenReserva(db(), actorId, organizacion.id, q.reprogramar).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  if (q.reprogramar && (!original || original.estado !== "CONFIRMADA")) notFound();
  const sedeActual = original ? sedes.find(s => s.id === original.sedeId) : sedeContexto;
  if (original && !sedeActual) notFound();
  if (!sedeActual) return <section className="panel"><h1>Nuevo turno</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const sedeId = sedeActual.id;

  const hoy = aLocal(new Date(), sedeActual.timezone).fecha;
  const fecha = q.fecha && validarFecha(q.fecha) && q.fecha > hoy ? q.fecha : hoy;
  const [catalogo, profesionales] = await Promise.all([
    catalogoSede(db(), actorId, organizacion.id, sedeId),
    listarProfesionales(db(), actorId, organizacion.id, { sedeId }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }),
  ]);
  const cliente = original?.clienteId ? await obtenerCliente(db(), actorId, organizacion.id, original.clienteId).catch(() => null) : q.cliente ? await obtenerCliente(db(), actorId, organizacion.id, q.cliente).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; }) : null;
  const candidatos = !cliente && q.buscar ? await listarClientes(db(), actorId, organizacion.id, { texto: q.buscar }).catch(e => { if (e instanceof AccesoDenegado) return []; throw e; }) : [];
  const habilitados = catalogo.servicios.filter(s => s.efectivo.habilitado);
  const servicio = new Map(catalogo.servicios.map(s => [s.id, s]));
  // Servicio y profesional viajan como pares posicionales (s, p): se filtran juntos para no desalinearlos.
  const pares = original
    ? original.items.map((i, k) => [i.servicioId, q.p ? lista(q.p)[k] ?? "" : i.profesionalId ?? ""] as const) // Al reprogramar se propone el mismo profesional.
    : lista(q.s).map((s, k) => [s, lista(q.p)[k] ?? ""] as const).filter(([s]) => s).slice(0, MAX_SERVICIOS);
  const elegidos = pares.map(([s]) => s), prefer = pares.map(([, p]) => p);
  const items = pares.map(([servicioId, p]) => ({ servicioId, profesionalId: p || null }));
  const activos = profesionales.filter(p => p.activo);
  const nombreProfesional = new Map(profesionales.map(p => [p.id, `${p.nombre} ${p.apellido ?? ""}`.trim()]));

  let turnos: Awaited<ReturnType<typeof consultarDisponibilidad>> = [], aviso = "", proximo: string | null = null;
  const consultar = (f: string) => consultarDisponibilidad(db(), actorId, organizacion.id, { sedeId, fecha: f, canal: "RECEPCION", items });
  if (items.length) {
    try {
      turnos = await consultar(fecha);
      // Día sin lugar: se ofrece el próximo con turnos en vez de dejar a recepción probando fecha por fecha.
      for (let n = 1; !turnos.length && !proximo && n <= DIAS_BUSQUEDA; n++) if ((await consultar(sumar(fecha, n))).length) proximo = sumar(fecha, n);
    } catch (e) {
      if (e instanceof ConfiguracionIncompleta) aviso = `Falta definir en la sede: ${e.faltantes.join(", ")}.`;
      else if (e instanceof DatosInvalidos) aviso = e.message;
      else if (e instanceof AccesoDenegado) aviso = "No tenés acceso a esa sede.";
      else throw e;
    }
  }
  const turno = turnos.find(t => t.inicio === q.inicio) ?? null;
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: sedeActual.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const precio = elegidos.reduce((t, id) => t + (aCentavos(servicio.get(id)?.efectivo.precio ?? "") ?? 0n), 0n);
  const minutos = elegidos.reduce((t, id) => t + (servicio.get(id)?.efectivo.duracionMinutos ?? 0), 0);

  // Todo el estado vive en la URL: cada paso conserva lo elegido en los demás.
  const estado = { fecha, inicio: turno?.inicio, cliente: original ? undefined : cliente?.id, buscar: cliente ? undefined : q.buscar, reprogramar: original?.id };
  const parametros = (cambios: Partial<typeof estado> = {}, conServicios = true) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...estado, ...cambios })) if (v) u.set(k, v);
    if (conServicios) pares.forEach(([s, p]) => { u.append("s", s); u.append("p", p); });
    return u;
  };
  const url = (cambios: Partial<typeof estado> = {}) => `/agenda/nuevo?${parametros(cambios)}`;
  const ocultos = (u: URLSearchParams) => [...u].map(([k, v], i) => <input key={i} type="hidden" name={k} value={v} />);

  const desde = sumar(fecha, -3) < hoy ? hoy : sumar(fecha, -3);
  const dias = Array.from({ length: 7 }, (_, i) => sumar(desde, i));
  const franja = (iso: string) => FRANJAS.findIndex(f => Number(hora(iso).slice(0, 2)) < f.hasta);
  const filas = original ? elegidos.length : Math.min(MAX_SERVICIOS, elegidos.length + 1);
  const faltan = [!elegidos.length && "servicio", !turno && "horario", !cliente && !original && "cliente"].filter(Boolean);
  const sugerido = q.buscar?.trim() ?? "";
  const valoresNuevo = sugerido.includes("@") ? { email: sugerido } : /^[\d\s+()-]+$/.test(sugerido) ? { telefono: sugerido } : { nombre: sugerido };

  return <section className="panel">
    <p className="eyebrow"><Link href={`/agenda?fecha=${fecha}`}>AGENDA</Link> · {sedeActual.nombre.toUpperCase()}</p>
    <h1>{original ? "Reprogramar turno" : "Nuevo turno"}</h1>
    {original && <p className="intro">{original.items.map(i => i.servicio).join(" + ")} de {[original.cliente?.nombre, original.cliente?.apellido].filter(Boolean).join(" ")}. Se conservan precio y seña pactados; el horario actual se libera solo si el nuevo se confirma.</p>}

    <div className="reserva">
      <div className="reserva-pasos">
        <article className={elegidos.length ? "paso hecho" : "paso"}>
          <h2><span className="paso-numero">1</span>{original ? "Servicios" : "¿Qué se hace?"}</h2>
          <FormularioVivo action="/agenda/nuevo" className="servicios">
            {ocultos(parametros({ inicio: undefined }, false))}
            {Array.from({ length: filas }, (_, i) => <div key={i} className="servicio-fila">
              {original ? <><input type="hidden" name="s" value={elegidos[i]} /><span className="servicio-fijo">{original.items[i]!.servicio}</span></>
                : <select name="s" defaultValue={elegidos[i] ?? ""} aria-label={`Servicio ${i + 1}`}>
                  <option value="">{i === 0 ? "Elegí un servicio" : "+ Agregar otro servicio a continuación"}</option>
                  {habilitados.map(s => <option key={s.id} value={s.id}>{s.nombre} · {s.efectivo.duracionMinutos} min</option>)}
                </select>}
              <select name="p" defaultValue={prefer[i] ?? ""} aria-label={`Profesional para el servicio ${i + 1}`}>
                <option value="">Cualquier profesional</option>
                {activos.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </select>
            </div>)}
            <noscript><button className="secundario">Ver horarios</button></noscript>
          </FormularioVivo>
          {!habilitados.length && <p className="ayuda">No hay servicios habilitados en esta sede. Configuralos en <Link href="/catalogo">Catálogo</Link>.</p>}
          {!original && elegidos.length > 0 && <p className="ayuda total">{minutos} min{precio > 0n ? ` · ${pesos(precio)}` : ""}{elegidos.length > 1 ? " · uno a continuación del otro" : ""}</p>}
        </article>

        <article className={turno ? "paso hecho" : "paso"}>
          <h2><span className="paso-numero">2</span>¿Cuándo?</h2>
          {!elegidos.length ? <p className="ayuda">Elegí un servicio para ver los horarios libres.</p> : <>
            <nav className="dias" aria-label="Día">
              {fecha > hoy ? <Link className="dia flecha" href={url({ fecha: sumar(fecha, -7) < hoy ? hoy : sumar(fecha, -7), inicio: undefined })} aria-label="Semana anterior">‹</Link> : <span className="dia flecha" aria-hidden>‹</span>}
              {dias.map(d => <Link key={d} className="dia" href={url({ fecha: d, inicio: undefined })} aria-current={d === fecha ? "date" : undefined}>
                <span>{d === hoy ? "hoy" : diaSemana(d)}</span><strong>{Number(d.slice(8))}</strong>
              </Link>)}
              <Link className="dia flecha" href={url({ fecha: sumar(fecha, 7), inicio: undefined })} aria-label="Semana siguiente">›</Link>
            </nav>
            <Form action="/agenda/nuevo" scroll={false} className="en-linea otra-fecha">
              {ocultos(parametros({ fecha: undefined, inicio: undefined }))}
              <label className="ayuda" htmlFor="otra-fecha">Otra fecha</label>
              <input key={fecha} id="otra-fecha" type="date" name="fecha" defaultValue={fecha} min={hoy} required />
              <button className="secundario">Ir</button>
            </Form>

            {aviso && <p className="alerta error">{aviso} {aviso.startsWith("Falta") && <Link href={`/sedes/${sedeId}?seccion=reservas`}>Configurar la sede</Link>}</p>}
            {q.inicio && !turno && !aviso && <p className="alerta error">El horario elegido ya no está libre. Elegí otro.</p>}
            {!aviso && !turnos.length && <p className="sin-turnos">Sin horarios libres el {diaLargo(fecha)}.{" "}
              {proximo ? <Link href={url({ fecha: proximo, inicio: undefined })}>Próximo día con lugar: {diaLargo(proximo)} →</Link> : `Tampoco en los ${DIAS_BUSQUEDA} días siguientes.`}
              {prefer.some(Boolean) && <> Probá con «Cualquier profesional».</>}</p>}
            {FRANJAS.map((f, n) => {
              const deFranja = turnos.filter(t => franja(t.inicio) === n);
              return deFranja.length > 0 && <div key={f.nombre} className="franja">
                <h3>{f.nombre}</h3>
                <div className="horarios">{deFranja.map(t => <Link key={t.inicio} className="horario" href={url({ inicio: t.inicio })} aria-current={t.inicio === turno?.inicio ? "true" : undefined}
                  title={t.items.map(i => `${servicio.get(i.servicioId)?.nombre} con ${i.profesional}`).join(" → ")}>{hora(t.inicio)}</Link>)}</div>
              </div>;
            })}
          </>}
        </article>
      </div>

      <aside className="resumen-turno">
        <article>
          <h2>Resumen</h2>
          <dl className="datos">
            <div><dt>Día</dt><dd>{diaLargo(fecha)}</dd></div>
            <div><dt>Horario</dt><dd>{turno ? `${hora(turno.inicio)} a ${hora(turno.fin)}` : <span className="falta">Elegí un horario</span>}</dd></div>
            <div><dt>{elegidos.length > 1 ? "Servicios" : "Servicio"}</dt><dd>{!elegidos.length ? <span className="falta">Elegí un servicio</span> : <ul>
              {elegidos.map((id, i) => { const asignado = turno?.items[i]; return <li key={i}>
                {servicio.get(id)?.nombre ?? original?.items[i]?.servicio}
                <small>{asignado ? `${hora(asignado.inicio)} · con ${asignado.profesional}` : prefer[i] ? `con ${nombreProfesional.get(prefer[i]!) ?? "—"}` : "cualquier profesional"}</small>
              </li>; })}
            </ul>}</dd></div>
            {!original && precio > 0n && <div><dt>Total</dt><dd>{pesos(precio)}</dd></div>}
          </dl>

          <h2 className={cliente ? "separado hecho" : "separado"}><span className="paso-numero">3</span>Cliente</h2>
          {cliente ? <div className="cliente-elegido">
            <div><strong>{cliente.nombre} {cliente.apellido}</strong><small>{[cliente.telefono, cliente.email].filter(Boolean).join(" · ")}</small></div>
            {!original && <Link href={url({ cliente: undefined })} scroll={false}>Cambiar</Link>}
          </div> : <>
            <Form action="/agenda/nuevo" scroll={false} className="en-linea sin-margen" role="search">
              {ocultos(parametros({ cliente: undefined, buscar: undefined }))}
              <input name="buscar" defaultValue={q.buscar} placeholder="Nombre, email o teléfono" aria-label="Buscar cliente" required />
              <button className="secundario">Buscar</button>
            </Form>
            {candidatos.length > 0 && <ul className="lista candidatos">{candidatos.map(c => <li key={c.id}>
              <Link href={url({ cliente: c.id, buscar: undefined })} scroll={false}>{c.nombre} {c.apellido}</Link>
              <small>{[c.telefono, c.email].filter(Boolean).join(" · ")}</small>
            </li>)}</ul>}
            {q.buscar && !candidatos.length && <p className="ayuda">Sin resultados en tus sedes. Si ya es cliente de otra sede, <Link href="/clientes">vinculala desde Clientes</Link>.</p>}
            {puede.editarClientes && <details open={!!q.buscar && !candidatos.length}>
              <summary>+ Cliente nuevo</summary>
              <Formulario accion={accionCrearCliente} boton="Crear y elegir">
                <input type="hidden" name="sedeId" value={sedeId} />
                <input type="hidden" name="volver" value={url({ cliente: undefined, buscar: undefined })} />
                <CamposCliente valores={valoresNuevo} />
              </Formulario>
            </details>}
          </>}

          <div className="confirmar">
            {turno && original ? <Formulario accion={accionReprogramar} boton={`Mover al ${diaLargo(fecha)}, ${hora(turno.inicio)}`}>
              <input type="hidden" name="reservaId" value={original.id} /><input type="hidden" name="fecha" value={fecha} /><input type="hidden" name="inicio" value={turno.inicio} />
              {turno.items.map((i, k) => <input key={k} type="hidden" name="p" value={prefer[k] || i.profesionalId} />)}
            </Formulario>
            : turno && cliente ? <Formulario accion={accionReservar} boton="Confirmar turno">
              <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="fecha" value={fecha} />
              <input type="hidden" name="clienteId" value={cliente.id} /><input type="hidden" name="inicio" value={turno.inicio} />
              {/* Se envía el profesional asignado: si «cualquiera» cambió mientras tanto, se revalida igual bajo lock. */}
              {turno.items.map((i, k) => <span key={k}><input type="hidden" name="s" value={i.servicioId} /><input type="hidden" name="p" value={prefer[k] || i.profesionalId} /></span>)}
              <label>Notas (opcional)<textarea name="notas" rows={2} maxLength={1000} /></label>
            </Formulario>
            : <><button className="bloqueado" disabled>{original ? "Mover turno" : "Confirmar turno"}</button><p className="ayuda">Falta elegir: {faltan.join(", ")}.</p></>}
          </div>
        </article>
      </aside>
    </div>
  </section>;
}
