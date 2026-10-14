"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Svg, type Icono } from "./iconos";
import { Marca } from "./marca";

/** `aviso`: contador junto a la etiqueta (p. ej. incidencias sin revisar); 0 o ausente no se muestra. */
type Item = { href: string; etiqueta: string; icono: Icono; aviso?: number };
/** Un grupo con `icono` se muestra como ítem desplegable (submenú); sin icono, sus ítems van sueltos. */
export type GrupoMenu = { titulo?: string; icono?: Icono; items: Item[] };

const activo = (ruta: string, href: string) => href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(href + "/");

function Enlace({ item, ruta }: { item: Item; ruta: string }) {
  return <Link href={item.href} aria-current={activo(ruta, item.href) ? "page" : undefined}><Svg icono={item.icono} />{item.etiqueta}
    {!!item.aviso && <span className="aviso" aria-label={`${item.aviso} sin revisar`}>{item.aviso > 99 ? "99+" : item.aviso}</span>}</Link>;
}

/** Submenú plegable. Arranca abierto si la pantalla actual es una de sus secciones y se abre al entrar a una. */
function Submenu({ grupo, icono, ruta }: { grupo: GrupoMenu; icono: Icono; ruta: string }) {
  const id = useId();
  const contiene = grupo.items.some(it => activo(ruta, it.href));
  const [abierto, setAbierto] = useState(contiene);
  useEffect(() => { if (contiene) setAbierto(true); }, [contiene]);
  return <div className={abierto ? "submenu abierto" : "submenu"}>
    <button type="button" className="submenu-boton" aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto(a => !a)} data-contiene={contiene || undefined}>
      <Svg icono={icono} />{grupo.titulo}<span className="submenu-flecha"><Svg icono="flecha" /></span>
    </button>
    <div id={id} className="submenu-items" hidden={!abierto}>{grupo.items.map(it => <Enlace key={it.href} item={it} ruta={ruta} />)}</div>
  </div>;
}

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
        {grupos.filter(g => g.items.length > 0).map((g, i) => g.icono
          ? <Submenu key={g.titulo ?? i} grupo={g} icono={g.icono} ruta={ruta} />
          : <div key={g.titulo ?? i} className="menu-grupo">
            {g.titulo && <p className="menu-titulo">{g.titulo}</p>}
            {g.items.map(it => <Enlace key={it.href} item={it} ruta={ruta} />)}
          </div>)}
      </nav>
      {children}
    </div>
  </aside>;
}
