import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { obtenerCliente } from "@nailnet/database/clientes";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionActualizarCliente, accionConsentimiento, accionObservaciones } from "../../acciones";
import { CamposCliente } from "../campos";

export const metadata: Metadata = { title: "Cliente · Sicurella" };
const ESTADOS = { VIGENTE: "Aceptado", DESACTUALIZADO: "Aceptó una versión anterior", REVOCADO: "Revocado", NUNCA: "Sin registrar" } as const;
const TIPOS = { PRACTICA: "Práctica", TERMINOS: "Términos", MARKETING: "Comunicaciones" } as const;

export default async function Cliente({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const { sesion, organizacion } = await requerirOrganizacion();
  const cliente = await obtenerCliente(db(), sesion.usuario.id, organizacion.id, clienteId).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!cliente) notFound();
  const editables = cliente.sedes.filter(s => s.editable);

  return <section className="panel">
    <p className="eyebrow"><Link href="/clientes">CLIENTES</Link></p>
    <h1>{cliente.nombre} {cliente.apellido}</h1>
    <p className="intro">{[cliente.email, cliente.telefono, cliente.documento && `${cliente.tipoDocumento} ${cliente.documento}`].filter(Boolean).join(" · ")}</p>

    {cliente.editable && <details><summary>Editar datos</summary>
      <Formulario accion={accionActualizarCliente} boton="Guardar datos">
        <input type="hidden" name="clienteId" value={cliente.id} /><CamposCliente valores={cliente} />
      </Formulario>
      <p className="ayuda">La ficha es compartida en la organización: los cambios se ven en todas las sedes vinculadas.</p>
    </details>}

    <h2 className="subtitulo">Sedes y observaciones</h2>
    <p className="ayuda">Cada sede ve solo sus observaciones. No registrar datos de salud.</p>
    <div className="tabla">{cliente.sedes.map(s => <article key={s.sedeId} className="fila">
      <div className="fila-cabecera"><h2>{s.sede}</h2></div>
      {s.editable ? <Formulario accion={accionObservaciones} boton="Guardar observaciones">
        <input type="hidden" name="clienteId" value={cliente.id} /><input type="hidden" name="sedeId" value={s.sedeId} />
        <textarea name="observaciones" defaultValue={s.observaciones ?? ""} maxLength={2000} rows={3} aria-label={`Observaciones en ${s.sede}`} />
      </Formulario> : <p>{s.observaciones || "Sin observaciones"}</p>}
    </article>)}</div>

    <h2 className="subtitulo">Consentimientos</h2>
    {!cliente.consentimientos.length && <p className="ayuda">La organización todavía no publicó textos de consentimiento.</p>}
    <div className="tabla">{cliente.consentimientos.map(c => <article key={c.clave} className="fila">
      <div className="fila-cabecera"><h2>{c.titulo}</h2><span className="tag">{ESTADOS[c.estado]}</span></div>
      <p>{TIPOS[c.tipo]} · versión {c.version}</p>
      <details><summary>Leer texto vigente</summary><p className="texto-legal">{c.texto}</p></details>
      {editables.length > 0 && <div className="acciones">
        {c.estado !== "VIGENTE" && <Formulario accion={accionConsentimiento} boton="Registrar aceptación" className="en-linea" secundario
          confirmar={`¿${cliente.nombre} leyó y aceptó «${c.titulo}» versión ${c.version}?`}>
          <input type="hidden" name="clienteId" value={cliente.id} /><input type="hidden" name="versionId" value={c.versionId} /><input type="hidden" name="accion" value="ACEPTA" />
          <SedeRegistro sedes={editables} />
        </Formulario>}
        {c.estado === "VIGENTE" && <Formulario accion={accionConsentimiento} boton="Registrar revocación" className="en-linea" secundario
          confirmar={`¿Registrar que ${cliente.nombre} revoca «${c.titulo}»?`}>
          <input type="hidden" name="clienteId" value={cliente.id} /><input type="hidden" name="versionId" value={c.versionId} /><input type="hidden" name="accion" value="REVOCA" />
          <SedeRegistro sedes={editables} />
        </Formulario>}
      </div>}
    </article>)}</div>
  </section>;
}

function SedeRegistro({ sedes }: { sedes: { sedeId: string; sede: string }[] }) {
  if (sedes.length === 1) return <input type="hidden" name="sedeId" value={sedes[0]!.sedeId} />;
  return <select name="sedeId" aria-label="Sede donde se registra">{sedes.map(s => <option key={s.sedeId} value={s.sedeId}>{s.sede}</option>)}</select>;
}
