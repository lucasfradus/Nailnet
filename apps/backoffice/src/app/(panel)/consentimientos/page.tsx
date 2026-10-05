import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { consentimientosVigentes } from "@nailnet/database/clientes";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionPublicarConsentimiento } from "../acciones";

export const metadata: Metadata = { title: "Consentimientos · Sicurella" };
const TIPOS = { PRACTICA: "Práctica", TERMINOS: "Términos", MARKETING: "Comunicaciones" } as const;

export default async function Consentimientos() {
  const { organizacion, puede } = await requerirOrganizacion();
  if (!puede.administrarConsentimientos) notFound();
  const vigentes = await consentimientosVigentes(db(), organizacion.id);
  return <section className="panel">
    <p className="eyebrow">ORGANIZACIÓN</p><h1>Consentimientos</h1>
    <p className="intro">Los textos son globales para la organización. Publicar un cambio crea una versión nueva: quienes aceptaron la anterior deberán aceptar otra vez. Las versiones publicadas no se editan ni se borran.</p>
    <div className="tabla">{vigentes.map(v => <article key={v.id} className="fila">
      <div className="fila-cabecera"><h2>{v.titulo}</h2><span className="tag">{TIPOS[v.tipo]} · v{v.version}</span></div>
      <p>Clave: {v.clave}</p>
      <details><summary>Texto y nueva versión</summary>
        <p className="texto-legal">{v.texto}</p>
        <Formulario accion={accionPublicarConsentimiento} boton="Publicar nueva versión" confirmar="Quienes aceptaron la versión actual deberán aceptar la nueva. ¿Publicar?">
          <input type="hidden" name="tipo" value={v.tipo} /><input type="hidden" name="clave" value={v.clave} />
          <label>Título<input name="titulo" defaultValue={v.titulo} required maxLength={120} /></label>
          <label>Texto<textarea name="texto" defaultValue={v.texto} required minLength={20} maxLength={20000} rows={8} /></label>
        </Formulario>
      </details>
    </article>)}</div>
    <h2 className="subtitulo">Nuevo consentimiento</h2>
    <Formulario accion={accionPublicarConsentimiento} boton="Publicar">
      <div className="grilla">
        <label>Tipo<select name="tipo"><option value="PRACTICA">Práctica</option><option value="TERMINOS">Términos</option><option value="MARKETING">Comunicaciones</option></select></label>
        <label>Clave<input name="clave" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={60} placeholder="depilacion-laser" /></label>
        <label>Título<input name="titulo" required maxLength={120} /></label>
      </div>
      <label>Texto<textarea name="texto" required minLength={20} maxLength={20000} rows={8} /></label>
      <p className="ayuda">El texto de práctica debe revisarlo el responsable legal del negocio. Asociarlo a servicios llega con el catálogo (C02).</p>
    </Formulario>
  </section>;
}
