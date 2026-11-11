"use client";
import { useEffect } from "react";
import { COOKIE_UNIVERSO } from "@/lib/etiquetas";

/**
 * Recuerda en este navegador qué universo de recepción está mirando la recepcionista (doc 31), para que
 * al volver al tablero sin `?u=` (desde el menú, o después de «Atender ahora») caiga en el mismo. Es solo
 * una preferencia de pantalla: el servidor la compara contra los universos válidos y no decide permisos.
 */
export function RecordarUniverso({ valor }: { valor: string }) {
  useEffect(() => {
    document.cookie = `${COOKIE_UNIVERSO}=${valor}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  }, [valor]);
  return null;
}
