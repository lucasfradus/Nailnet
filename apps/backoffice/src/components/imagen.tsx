import { Formulario, type Estado } from "@/components/formulario";

/**
 * Imagen pública con subida y quitar. `ocultos` identifica el objetivo; el servidor vuelve a autorizar.
 * La vista previa usa la misma ruta pública que el portal.
 */
export function EditorImagen({ accion, ocultos, imagenId, titulo, retrato = false }: {
  accion: (estado: Estado, form: FormData) => Promise<Estado>; ocultos: Record<string, string>; imagenId: string | null; titulo: string; retrato?: boolean;
}) {
  const campos = Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return <div className="editor-imagen">
    {imagenId
      // <img> y no next/image: la imagen ya viene procesada y con caché propia.
      ? <img src={`/api/public/v1/imagenes/${imagenId}`} alt={titulo} className={retrato ? "miniatura retrato" : "miniatura"} />
      : <div className={retrato ? "miniatura retrato vacia" : "miniatura vacia"}>Sin imagen</div>}
    <div>
      <Formulario accion={accion} boton={imagenId ? "Reemplazar" : "Subir"} className="en-linea">
        {campos}
        <input type="file" name="imagen" accept="image/jpeg,image/png,image/webp,image/avif" required aria-label={titulo} />
      </Formulario>
      {imagenId && <Formulario accion={accion} boton="Quitar" className="en-linea" secundario confirmar="¿Quitar la imagen? Deja de verse en el portal.">
        {campos}<input type="hidden" name="quitar" value="1" />
      </Formulario>}
      <p className="ayuda">JPG, PNG, WebP o AVIF de hasta 8 MB. {retrato ? "Se recorta en cuadrado desde arriba: conviene una foto con la cara en la parte superior." : "Se reduce a 1200 px; el portal la encuadra."} Se eliminan los datos de ubicación del archivo.</p>
    </div>
  </div>;
}
