"use client";
import { useState } from "react";
import type { Sena, TipoSena } from "@nailnet/domain/catalogo";

/**
 * Tipo y valor de la seña. El valor solo se habilita (y se envía) con monto fijo o porcentaje,
 * así no queda un importe cargado que el servidor descarte.
 */
export function CamposSena({ sena, heredar }: { sena: Sena; heredar: string }) {
  const [tipo, setTipo] = useState<TipoSena | "">(sena?.tipo ?? "");
  const conValor = tipo === "FIJA" || tipo === "PORCENTAJE";
  return <>
    <label className="campo">Seña
      <select name="senaTipo" value={tipo} onChange={e => setTipo(e.target.value as TipoSena | "")}>
        <option value="">{heredar}</option><option value="NINGUNA">Sin seña</option><option value="FIJA">Monto fijo ($)</option><option value="PORCENTAJE">Porcentaje del precio (%)</option>
      </select>
    </label>
    <label className="campo">{tipo === "PORCENTAJE" ? "Porcentaje" : "Monto"}
      <span className={`con-unidad${tipo === "PORCENTAJE" ? " sufijo" : ""}`} data-unidad={tipo === "PORCENTAJE" ? "%" : "$"}>
        <input name="senaValor" defaultValue={sena?.valor ?? ""} disabled={!conValor} required={conValor} inputMode="decimal"
          placeholder={tipo === "PORCENTAJE" ? "30" : conValor ? "5000" : "Elegí monto fijo o porcentaje"} />
      </span>
    </label>
  </>;
}
