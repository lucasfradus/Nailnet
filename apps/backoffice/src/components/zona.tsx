import { ZONAS } from "@/lib/etiquetas";

/** Zonas sugeridas; una zona IANA válida que no esté en la lista se conserva como opción. */
export function SelectorZona({ valor }: { valor?: string }) {
  const zonas = valor && !ZONAS.includes(valor) ? [valor, ...ZONAS] : ZONAS;
  return <select name="timezone" defaultValue={valor ?? ZONAS[0]} aria-label="Zona horaria">{zonas.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select>;
}
