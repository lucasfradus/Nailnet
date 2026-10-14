import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccesoDenegado } from "@nailnet/domain";
import { listarCategoriasGasto } from "@nailnet/database/gastos";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirOrganizacion } from "@/lib/contexto";
import { accionCrearCategoriaGasto, accionEstadoCategoriaGasto, accionRenombrarCategoriaGasto } from "../acciones";
import { Pestanas } from "../comun";

export const metadata: Metadata = { title: "Categorías de gasto · Sicurella" };

/**
 * Categorías de gasto de la sede elegida: las globales de la organización (las administra el master)
 * y las propias de la sede (las administra quien la gestiona). Se desactivan, no se borran.
 */
export default async function CategoriasGasto() {
  const { sesion, organizacion, sede, puede } = await requerirOrganizacion();
  if (!puede.verGastos) notFound();
  if (!sede) return <section className="panel"><h1>Categorías de gasto</h1><p className="intro">No tenés sedes asignadas.</p></section>;
  const cats = await listarCategoriasGasto(db(), sesion.usuario.id, organizacion.id, sede.id).catch(e => { if (e instanceof AccesoDenegado) return null; throw e; });
  if (!cats) notFound();
  const grupos = [
    { titulo: "De toda la organización", items: cats.categorias.filter(c => c.global) },
    { titulo: `Solo de ${sede.nombre}`, items: cats.categorias.filter(c => !c.global) },
  ];

  return <section className="panel">
    <p className="eyebrow">GASTOS · {sede.nombre.toUpperCase()}</p>
    <h1>Categorías de gasto</h1>
    <Pestanas actual="categorias" />
    <p className="ayuda">Las categorías de la organización valen en todas las sedes y solo las define el master. Cada sede puede sumar las suyas. Una categoría con gastos no se borra: se desactiva y deja de ofrecerse al cargar.</p>

    {grupos.map(g => <div key={g.titulo}>
      <h2 className="subtitulo">{g.titulo}</h2>
      <div className="tabla">
        {g.items.map(c => <article key={c.id} className={c.activo ? "fila" : "fila inactiva"}>
          <div className="fila-cabecera"><h2>{c.nombre}</h2>{!c.activo && <span className="tag">Inactiva</span>}</div>
          {c.puedeEditar && <div className="en-linea">
            <Formulario accion={accionRenombrarCategoriaGasto} boton="Renombrar" className="en-linea" secundario>
              <input type="hidden" name="categoriaId" value={c.id} />
              <input name="nombre" defaultValue={c.nombre} required maxLength={60} aria-label={`Nuevo nombre de ${c.nombre}`} />
            </Formulario>
            <Formulario accion={accionEstadoCategoriaGasto} boton={c.activo ? "Desactivar" : "Reactivar"} className="en-linea" secundario>
              <input type="hidden" name="categoriaId" value={c.id} /><input type="hidden" name="activo" value={String(!c.activo)} />
            </Formulario>
          </div>}
        </article>)}
        {!g.items.length && <p>Sin categorías.</p>}
      </div>
    </div>)}

    {(cats.puedeCrearGlobal || cats.puedeCrearLocal) && <Formulario accion={accionCrearCategoriaGasto} boton="Agregar categoría" className="en-linea">
      <input type="hidden" name="sedeId" value={sede.id} />
      <input name="nombre" required maxLength={60} placeholder="Alquiler, limpieza, insumos…" aria-label="Nueva categoría" />
      {cats.puedeCrearGlobal && cats.puedeCrearLocal
        ? <select name="alcance" defaultValue="global" aria-label="Alcance"><option value="global">Para toda la organización</option><option value="sede">Solo para {sede.nombre}</option></select>
        : <input type="hidden" name="alcance" value={cats.puedeCrearGlobal ? "global" : "sede"} />}
    </Formulario>}
  </section>;
}
