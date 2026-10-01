"use client";
import { useActionState } from "react";

export type Estado = { error?: string; ok?: string } | undefined;
type Accion = (estado: Estado, form: FormData) => Promise<Estado>;

/** Formulario de Server Action con mensaje de resultado. Funciona también sin JavaScript. */
export function Formulario({ accion, boton, children, className = "formulario", secundario = false, confirmar }: {
  accion: Accion; boton: string; children?: React.ReactNode; className?: string; secundario?: boolean; confirmar?: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, undefined);
  return <form action={ejecutar} className={className} onSubmit={e => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }}>
    {children}
    <button className={secundario ? "secundario" : undefined} disabled={pendiente}>{pendiente ? "…" : boton}</button>
    {estado?.error && <p className="alerta error" role="alert">{estado.error}</p>}
    {estado?.ok && <p className="alerta ok" role="status">{estado.ok}</p>}
  </form>;
}
