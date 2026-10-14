"use client";
type Opcion = { id: string; nombre: string };

/**
 * Organización y sede activas, en la barra superior. Es el único filtro de sede del panel: aplica al
 * elegir (sin JavaScript queda el botón). No hay opción «todas»: siempre hay una sede elegida.
 */
export function SelectorContexto({ accion, organizaciones, organizacion, sedes, sede }: {
  accion: (form: FormData) => Promise<void>; organizaciones: Opcion[]; organizacion: Opcion; sedes: Opcion[]; sede: Opcion | null;
}) {
  const enviar = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const form = e.currentTarget.form;
    // Al cambiar de organización la sede anterior no corresponde: se omite y el servidor usa la primera.
    if (e.currentTarget.name === "organizacionId") form?.querySelectorAll<HTMLSelectElement>("select[name=sedeId]").forEach(s => { s.disabled = true; });
    form?.requestSubmit();
  };
  return <form action={accion} className="contexto">
    {organizaciones.length > 1
      ? <select name="organizacionId" defaultValue={organizacion.id} aria-label="Organización" onChange={enviar}>{organizaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
      : <strong>{organizacion.nombre}</strong>}
    {sede && <><span className="separador" aria-hidden="true">/</span>
      {sedes.length > 1
        ? <label className="contexto-sede">Sede<select key={sede.id} name="sedeId" defaultValue={sede.id} onChange={enviar}>{sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
        : <span className="contexto-sede">Sede <strong>{sede.nombre}</strong></span>}
    </>}
    {(sedes.length > 1 || organizaciones.length > 1) && <noscript><button className="secundario">Aplicar</button></noscript>}
  </form>;
}
