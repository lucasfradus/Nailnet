"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Svg, type Icono } from "./iconos";
import { Marca } from "./marca";

export type GrupoMenu = { titulo?: string; items: { href: string; etiqueta: string; icono: Icono }[] };

const activo = (ruta: string, href: string) => href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(href + "/");

/** Barra lateral del panel. En pantallas chicas se pliega detrás de un botón y se cierra al navegar. */
export function Lateral({ grupos, children }: { grupos: GrupoMenu[]; children: React.ReactNode }) {
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(false);
  useEffect(() => setAbierta(false), [ruta]);
  return <aside className={abierta ? "lateral abierta" : "lateral"}>
    <div className="lateral-cabecera">
      <Link href="/" className="lateral-marca"><Marca /></Link>
      <button type="button" className="menu-boton secundario" aria-expanded={abierta} aria-controls="menu-principal" aria-label="Menú" onClick={() => setAbierta(a => !a)}>
        <Svg icono={abierta ? "cerrar" : "menu"} />
      </button>
    </div>
    <div className="lateral-cuerpo">
      <nav id="menu-principal" className="menu" aria-label="Principal">
        {grupos.filter(g => g.items.length > 0).map((g, i) => <div key={g.titulo ?? i} className="menu-grupo">
          {g.titulo && <p className="menu-titulo">{g.titulo}</p>}
          {g.items.map(it => <Link key={it.href} href={it.href} aria-current={activo(ruta, it.href) ? "page" : undefined}>
            <Svg icono={it.icono} />{it.etiqueta}
          </Link>)}
        </div>)}
      </nav>
      {children}
    </div>
  </aside>;
}
