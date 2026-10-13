"use client";
import Form from "next/form";

/**
 * Formulario GET que se reenvía al cambiar un <select>, para que lo que muestra la página (horarios,
 * resumen) nunca quede desfasado de lo elegido. Sin JavaScript sigue funcionando con su botón.
 */
export function FormularioVivo({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  return <Form action={action} scroll={false} className={className} onChange={e => { if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit(); }}>
    {children}
  </Form>;
}
