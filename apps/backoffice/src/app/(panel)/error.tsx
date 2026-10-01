"use client";
import Link from "next/link";

// Errores de servidor no muestran detalles internos; Next solo expone el digest para correlacionar logs.
export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel">
    <h1>No pudimos completar la operación</h1>
    <p className="intro">Puede que no tengas permiso sobre lo que pediste o que haya cambiado mientras tanto.{error.digest ? ` Código: ${error.digest}.` : ""}</p>
    <p className="en-linea"><button onClick={reset}>Reintentar</button><Link href="/">Volver al inicio</Link></p>
  </section>;
}
