"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type Pestana = { ruta: string; etiqueta: string };

/** Pestañas de una ficha con sub-rutas. `ruta` vacía = la página base (activa solo en coincidencia exacta). */
export function Pestanas({ base, items, etiqueta }: { base: string; items: Pestana[]; etiqueta: string }) {
  const actual = usePathname();
  return <nav className="pestanas" aria-label={etiqueta}>{items.map(it => {
    const href = it.ruta ? `${base}/${it.ruta}` : base;
    const activa = it.ruta ? actual === href || actual.startsWith(href + "/") : actual === base;
    return <Link key={href} href={href} aria-current={activa ? "page" : undefined}>{it.etiqueta}</Link>;
  })}</nav>;
}
