import type { Sena } from "@nailnet/domain/catalogo";
import type { catalogoSede } from "@nailnet/database/catalogo";
import { Formulario } from "./formulario";
import { accionServicioSede } from "@/app/(panel)/acciones";

export const pesos = (v: string | null) => v === null ? "—" : `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const textoSena = (s: Sena) => !s ? "sin definir" : s.tipo === "NINGUNA" ? "sin seña" : s.tipo === "FIJA" ? pesos(s.valor) : `${s.valor}%`;

export function CamposSena({ sena, heredar }: { sena: Sena; heredar: string }) {
  return <>
    <select name="senaTipo" defaultValue={sena?.tipo ?? ""} aria-label="Tipo de seña">
      <option value="">{heredar}</option><option value="NINGUNA">Sin seña</option><option value="FIJA">Monto fijo</option><option value="PORCENTAJE">Porcentaje</option>
    </select>
    <input name="senaValor" defaultValue={sena?.valor ?? ""} placeholder="Valor" aria-label="Valor de la seña" inputMode="decimal" size={8} />
  </>;
}

/** Servicios del catálogo con sus condiciones en una sede: precio, duración, seña y si se ofrece online. */
export function ServiciosSede({ sedeId, datos }: { sedeId: string; datos: Awaited<ReturnType<typeof catalogoSede>> }) {
  return <div className="tabla">
    {datos.servicios.map(s => <article key={s.id} className={s.efectivo.habilitado ? "fila" : "fila inactiva"}>
      <div className="fila-cabecera"><h2>{s.nombre}</h2><span className="tag">{s.efectivo.reservableOnline ? "Online" : s.efectivo.habilitado ? "Solo recepción" : "No disponible"}</span></div>
      <p>{s.categoria} · {s.efectivo.duracionMinutos} min · {pesos(s.efectivo.precio)} · seña {s.efectivo.sena === null ? "sin definir" : pesos(s.efectivo.sena)}
        {s.efectivo.motivosSinOnline.length > 0 && ` · ${s.efectivo.motivosSinOnline.join(", ")}`}</p>
      {datos.puedeEditar && s.activo && <details><summary>Condiciones en esta sede</summary>
        <Formulario accion={accionServicioSede} boton="Guardar" className="en-linea">
          <input type="hidden" name="sedeId" value={sedeId} /><input type="hidden" name="servicioId" value={s.id} />
          <label className="check"><input type="checkbox" name="habilitado" defaultChecked={s.enSede?.habilitado} />Habilitado</label>
          <input name="precio" defaultValue={s.enSede?.precio ?? ""} placeholder="Precio" aria-label="Precio" inputMode="decimal" size={10} />
          <input name="duracionMinutos" type="number" min={5} max={480} step={5} defaultValue={s.enSede?.duracionMinutos ?? ""} placeholder={`${s.duracionBase} min`} aria-label="Duración en esta sede" className="corto" />
          <CamposSena sena={s.enSede?.sena ?? null} heredar={`Del servicio (${textoSena(s.senaBase)})`} />
          <label className="check"><input type="checkbox" name="reservableOnline" defaultChecked={s.enSede?.reservableOnline ?? true} />Reservable online</label>
        </Formulario>
      </details>}
    </article>)}
    {!datos.servicios.length && <p>La organización todavía no cargó servicios.</p>}
  </div>;
}
