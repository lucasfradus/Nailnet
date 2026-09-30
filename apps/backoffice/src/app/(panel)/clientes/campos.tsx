type Valores = { nombre?: string; apellido?: string | null; email?: string | null; telefono?: string | null; sexo?: string | null; tipoDocumento?: string | null; documento?: string | null };

/** Campos de la ficha. Sin datos de salud: las observaciones se cargan aparte, por sede. */
export function CamposCliente({ valores = {} }: { valores?: Valores }) {
  return <div className="grilla">
    <label>Nombre<input name="nombre" required maxLength={80} defaultValue={valores.nombre} autoComplete="off" /></label>
    <label>Apellido<input name="apellido" maxLength={80} defaultValue={valores.apellido ?? ""} autoComplete="off" /></label>
    <label>Email<input name="email" type="email" maxLength={254} defaultValue={valores.email ?? ""} autoComplete="off" /></label>
    <label>Teléfono<input name="telefono" type="tel" maxLength={30} defaultValue={valores.telefono ?? ""} autoComplete="off" /></label>
    <label>Sexo (opcional)<select name="sexo" defaultValue={valores.sexo ?? ""}>
      <option value="">—</option><option value="FEMENINO">Femenino</option><option value="MASCULINO">Masculino</option><option value="OTRO">Otro</option><option value="NO_INFORMA">Prefiere no informar</option>
    </select></label>
    <label>Documento (opcional)<span className="en-linea sin-margen">
      <select name="tipoDocumento" defaultValue={valores.tipoDocumento ?? ""} aria-label="Tipo de documento"><option value="">—</option><option>DNI</option><option>CUIT</option><option>CUIL</option><option>PASAPORTE</option></select>
      <input name="documento" maxLength={20} defaultValue={valores.documento ?? ""} aria-label="Número de documento" autoComplete="off" />
    </span></label>
    <p className="ayuda">Email o teléfono: al menos uno.</p>
  </div>;
}
