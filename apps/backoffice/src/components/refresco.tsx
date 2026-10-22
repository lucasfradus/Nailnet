"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Vuelve a pedir la pantalla cada tantos segundos (el tablero lo usan dos o tres recepcionistas a la
 * vez). Se pausa con la pestaña oculta y no pisa lo que alguien está escribiendo en un campo.
 */
export function Refresco({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      const foco = document.activeElement;
      if (foco instanceof HTMLInputElement || foco instanceof HTMLSelectElement || foco instanceof HTMLTextAreaElement) return;
      router.refresh();
    }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos]);
  return null;
}
