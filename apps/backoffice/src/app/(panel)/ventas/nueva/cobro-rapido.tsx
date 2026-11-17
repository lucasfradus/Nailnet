"use client";
import { useActionState, useMemo, useState } from "react";
import { aCentavos, importe } from "@nailnet/domain/catalogo";
import { totalesConMedio, preciosConMedio, textoAjuste, type LineaPrecio, type Redondeo } from "@nailnet/domain/medios-pago";
import { aMilesimas } from "@nailnet/domain/stock";
import type { Estado } from "@/components/formulario";

/**
 * Cobro rápido (D22, doc 32, etapa 2). Arriba la comanda; abajo «¿Cómo paga?»: un botón por medio de la
 * sede con el total a cobrar ya calculado (ajuste del medio por ítem, redondeo, descuento manual y seña).
 * El caso normal son dos toques: el medio y «Cobrar». «Dividir pago» reparte el total entre dos medios con
 * el precio que elija el mostrador (por defecto, la lista). Los números salen de las mismas funciones de
 * dominio que usa el servidor, así que lo que se ve es lo que se registra.
 */

export type MedioCobroRapido = { id: string; nombre: string; tipo: string; ajuste: string };
type ItemTurno = { reservaItemId: string; servicioId: string; profesionalId: string; precio: string };
type Props = {
  accion: (estado: Estado, form: FormData) => Promise<Estado>;
  sedeId: string; reservaId: string | null; clave: string;
  turnoItems: ItemTurno[];
  servicios: { id: string; nombre: string; precioLista: string | null }[];
  profesionales: { id: string; nombre: string }[];
  productos: { id: string; nombre: string; precio: string; stock: string }[];
  medios: MedioCobroRapido[]; redondeo: Redondeo; anticipo: string; cajaAbierta: boolean;
  maxServicios: number; maxProductos: number;
};
type FilaServicio = { servicioId: string; profesionalId: string; reservaItemId: string | null; precio: string };
type FilaProducto = { productoId: string; cantidad: string };

const $ = (c: bigint) => `$${(c / 100n).toLocaleString("es-AR")}${c % 100n ? `,${(c % 100n).toString().padStart(2, "0")}` : ""}`;
const centavos = (s: string) => aCentavos(s) ?? 0n;
const PATRON_IMPORTE = "\\d{1,10}([.,]\\d{1,2})?";

export function CobroRapido(p: Props) {
  const [estado, enviar, pendiente] = useActionState(p.accion, undefined);
  const [servicios, setServicios] = useState<FilaServicio[]>(p.turnoItems.map(i => ({ servicioId: i.servicioId, profesionalId: i.profesionalId, reservaItemId: i.reservaItemId, precio: "" })));
  const [productos, setProductos] = useState<FilaProducto[]>(p.reservaId ? [] : [{ productoId: "", cantidad: "1" }]);
  const [descuento, setDescuento] = useState("");
  const [medioId, setMedioId] = useState<string | null>(null);
  const [dividir, setDividir] = useState(false);
  const [precioDividir, setPrecioDividir] = useState("");
  const [partes, setPartes] = useState([
    { medio: p.medios.find(m => m.tipo === "EFECTIVO")?.id ?? p.medios[0]?.id ?? "", monto: "" },
    { medio: p.medios.find(m => m.tipo === "TARJETA_DEBITO")?.id ?? p.medios[1]?.id ?? p.medios[0]?.id ?? "", monto: "" },
  ]);
  const [referencia, setReferencia] = useState("");

  const anticipo = centavos(p.anticipo);
  const servicioPorId = useMemo(() => new Map(p.servicios.map(s => [s.id, s])), [p.servicios]);
  const productoPorId = useMemo(() => new Map(p.productos.map(x => [x.id, x])), [p.productos]);
  const itemTurno = useMemo(() => new Map(p.turnoItems.map(i => [i.reservaItemId, i])), [p.turnoItems]);

  // Líneas antes de elegir el medio, con el mismo criterio que el repositorio: el ítem del turno con el
  // mismo servicio va al precio pactado; un servicio agregado, a la lista de la sede.
  const filasServicio = servicios.filter(f => f.servicioId);
  const filasProducto = productos.filter(f => f.productoId);
  const listaServicio = (f: FilaServicio) => {
    const t = f.reservaItemId ? itemTurno.get(f.reservaItemId) : undefined;
    if (t && t.servicioId === f.servicioId) return centavos(t.precio);
    const lista = servicioPorId.get(f.servicioId)?.precioLista;
    return lista ? centavos(lista) : null;
  };
  const lineas: LineaPrecio[] = [
    ...filasServicio.map(f => ({ cantidad: 1000n, lista: listaServicio(f), editado: f.precio.trim() ? aCentavos(f.precio) : null })),
    ...filasProducto.map(f => ({ cantidad: aMilesimas(f.cantidad || "1") ?? 1000n, lista: centavos(productoPorId.get(f.productoId)?.precio ?? "0"), editado: null })),
  ];
  const desc = descuento.trim() ? aCentavos(descuento) : 0n;
  const ajusteDe = (id: string) => BigInt(p.medios.find(m => m.id === id)?.ajuste ?? "0");
  const totales = (ajuste: bigint) => lineas.length && desc !== null ? totalesConMedio(lineas, ajuste, p.redondeo, desc, anticipo) : null;

  const elegido = p.medios.find(m => m.id === medioId) ?? null;
  // Precio aplicado: el del medio elegido; al dividir, el que elija el mostrador (vacío = lista).
  const medioPrecio = dividir ? precioDividir : medioId ?? "";
  const ajusteAplicado = ajusteDe(medioPrecio);
  const t = totales(ajusteAplicado);
  const precios = lineas.length ? preciosConMedio(lineas, ajusteAplicado, p.redondeo) : null;
  const aCobrar = t && !("error" in t) ? t.aCobrar : null;
  const primera = centavos(partes[0]!.monto);
  const parte1 = aCobrar === null ? 0n : primera > aCobrar ? aCobrar : primera;
  const resto = aCobrar === null ? 0n : aCobrar - parte1;
  const tipoDe = (id: string) => p.medios.find(m => m.id === id)?.tipo;
  const efectivoSinCaja = !p.cajaAbierta && (dividir
    ? (tipoDe(partes[0]!.medio) === "EFECTIVO" && parte1 > 0n) || (tipoDe(partes[1]!.medio) === "EFECTIVO" && resto > 0n)
    : elegido?.tipo === "EFECTIVO");

  const cambiarServicio = (i: number, cambio: Partial<FilaServicio>) => setServicios(s => s.map((f, j) => j === i ? { ...f, ...cambio } : f));
  const cambiarProducto = (i: number, cambio: Partial<FilaProducto>) => setProductos(s => s.map((f, j) => j === i ? { ...f, ...cambio } : f));
  const textoBoton = pendiente ? "…" : aCobrar === 0n ? "Registrar venta" : aCobrar === null ? "Cobrar" : dividir || elegido ? `Cobrar ${$(aCobrar)}` : "Elegí cómo paga";

  return <form action={enviar} className="formulario cobro-rapido">
    <input type="hidden" name="sedeId" value={p.sedeId} />
    {p.reservaId && <input type="hidden" name="reservaId" value={p.reservaId} />}
    <input type="hidden" name="clave" value={p.clave} />
    <input type="hidden" name="medioPrecio" value={medioPrecio} />

    {p.reservaId && <fieldset className="servicios"><legend>Comanda: servicios realizados</legend>
      {servicios.map((f, i) => {
        const n = filasServicio.indexOf(f);
        const lista = n >= 0 ? lineas[n]!.lista : null;
        const precioMedio = n >= 0 && precios && !("error" in precios) ? precios.medio[n] ?? null : null;
        return <div key={i} className="grilla fila-comanda">
          {f.reservaItemId && <input type="hidden" name={`reservaItem_${i}`} value={f.reservaItemId} />}
          <select name={`servicio_${i}`} aria-label={`Servicio ${i + 1}`} value={f.servicioId} onChange={e => cambiarServicio(i, { servicioId: e.target.value })}>
            <option value="">{f.reservaItemId ? "— no se hizo (quitar)" : "— elegí el servicio"}</option>
            {p.servicios.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <select name={`profesional_${i}`} aria-label={`Profesional del servicio ${i + 1}`} value={f.profesionalId} onChange={e => cambiarServicio(i, { profesionalId: e.target.value })}>
            <option value="">Profesional</option>
            {p.profesionales.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
          <label className="precio-comanda">
            <input name={`precio_${i}`} inputMode="decimal" value={f.precio} onChange={e => cambiarServicio(i, { precio: e.target.value })} pattern={PATRON_IMPORTE}
              placeholder={precioMedio !== null ? $(precioMedio) : "Precio"} aria-label={`Precio cobrado del servicio ${i + 1}`} />
            {f.servicioId && <small>{f.precio.trim() ? "precio editado" : lista === null ? "sin lista: indicá el precio" : precioMedio !== null && precioMedio !== lista ? <>lista <s>{$(lista)}</s></> : "lista"}</small>}
          </label>
        </div>;
      })}
      {servicios.length < p.maxServicios && <button type="button" className="enlace" onClick={() => setServicios(s => [...s, { servicioId: "", profesionalId: "", reservaItemId: null, precio: "" }])}>+ Agregar servicio</button>}
      <p className="ayuda">El precio se propone según cómo paga. Escribilo solo si cobrás otro: queda como excepción y no se ajusta. Agregar un servicio no ocupa agenda.</p>
    </fieldset>}

    <fieldset className="servicios"><legend>Productos {p.reservaId ? "(opcional)" : ""}</legend>
      {p.productos.length ? <>
        {productos.map((f, i) => <div key={i} className="grilla">
          <select name={`producto_${i}`} aria-label={`Producto ${i + 1}`} value={f.productoId} onChange={e => cambiarProducto(i, { productoId: e.target.value })}>
            <option value="">Elegí un producto</option>
            {p.productos.map(x => <option key={x.id} value={x.id}>{x.nombre} · lista {$(centavos(x.precio))} (hay {x.stock})</option>)}
          </select>
          <input name={`cantidad_${i}`} inputMode="decimal" value={f.cantidad} onChange={e => cambiarProducto(i, { cantidad: e.target.value })} placeholder="Cantidad (1)" aria-label={`Cantidad ${i + 1}`} />
        </div>)}
        {productos.length < p.maxProductos && <button type="button" className="enlace" onClick={() => setProductos(s => [...s, { productoId: "", cantidad: "1" }])}>+ Agregar producto</button>}
      </> : <p className="ayuda">No hay productos vendibles con precio en esta sede.</p>}
    </fieldset>

    <div className="en-linea">
      <label className="campo">Descuento manual ($, opcional)
        <input name="descuento" inputMode="decimal" value={descuento} onChange={e => setDescuento(e.target.value)} placeholder="0" pattern={PATRON_IMPORTE} title="Pesos, con hasta 2 decimales y sin separador de miles" />
      </label>
      {anticipo > 0n && <p className="ayuda">Seña cobrada por Mercado Pago: {$(anticipo)}, calculada sobre la lista. Ya está descontada de cada total.</p>}
    </div>

    <h2 className="subtitulo">¿Cómo paga?</h2>
    {!dividir && <div className="cobro-medios" role="radiogroup" aria-label="Medio de pago">
      {p.medios.map(m => {
        const tm = totales(BigInt(m.ajuste));
        return <button key={m.id} type="button" role="radio" aria-checked={medioId === m.id} className={`cobro-medio${medioId === m.id ? " elegido" : ""}`} onClick={() => setMedioId(m.id)}>
          <span className="cobro-medio-nombre">{m.nombre} <small>{BigInt(m.ajuste) === 0n ? "lista" : textoAjuste(BigInt(m.ajuste))}</small></span>
          <span className="cobro-medio-total">{!tm ? "—" : "error" in tm ? "revisar" : $(tm.aCobrar)}</span>
        </button>;
      })}
    </div>}

    {dividir && <div className="dividir">
      <label className="campo">Precio que se aplica
        <select value={precioDividir} onChange={e => setPrecioDividir(e.target.value)}>
          <option value="">Lista</option>
          {p.medios.filter(m => BigInt(m.ajuste) !== 0n).map(m => <option key={m.id} value={m.id}>El de {m.nombre} ({textoAjuste(BigInt(m.ajuste))})</option>)}
        </select>
      </label>
      {partes.map((x, i) => <div key={i} className="grilla">
        <select name={`medio_${i}`} aria-label={`Medio ${i + 1}`} value={x.medio} onChange={e => setPartes(s => s.map((y, j) => j === i ? { ...y, medio: e.target.value } : y))}>
          {p.medios.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        {i === 0
          ? <input name="monto_0" inputMode="decimal" value={x.monto} onChange={e => setPartes(s => s.map((y, j) => j === 0 ? { ...y, monto: e.target.value } : y))} placeholder="Monto $" pattern={PATRON_IMPORTE} aria-label="Monto del primer medio" />
          : <input name="monto_1" readOnly value={resto > 0n ? importe(resto) : ""} placeholder="El resto" aria-label="Monto del segundo medio (lo que falta)" />}
      </div>)}
      <p className="ayuda">Escribí cuánto paga con el primer medio: el segundo completa lo que falta.</p>
    </div>}

    {!dividir && elegido && aCobrar !== null && aCobrar > 0n && <>
      <input type="hidden" name="medio_0" value={elegido.id} />
      <input type="hidden" name="monto_0" value={importe(aCobrar)} />
    </>}
    <input type="hidden" name="referencia_0" value={referencia} />

    <div className="cobro-resumen">
      {t && "error" in t ? <p className="alerta error">{t.error}</p>
        : !t ? <p className="ayuda">{desc === null ? "Revisá el descuento: pesos con hasta 2 decimales." : p.reservaId ? "Elegí al menos un servicio." : "Elegí al menos un producto."}</p>
        : <dl>
          {t.descuento > 0n && <div><dt>Descuento</dt><dd>−{$(t.descuento)}</dd></div>}
          {anticipo > 0n && <div><dt>Seña</dt><dd>−{$(anticipo)}</dd></div>}
          <div className="total"><dt>A cobrar{!dividir && elegido ? ` con ${elegido.nombre}` : ""}</dt><dd>{$(t.aCobrar)}</dd></div>
        </dl>}
      {efectivoSinCaja && <p className="alerta aviso">La caja está cerrada: para cobrar en efectivo, abrila primero desde Caja.</p>}
      <input value={referencia} onChange={e => setReferencia(e.target.value)} maxLength={120} placeholder="Referencia (opcional: n.º de operación, cupón…)" aria-label="Referencia del cobro" />
    </div>

    <div className="acciones">
      <button name="enviar" value="cobrar" disabled={pendiente || aCobrar === null || (!dividir && !elegido && aCobrar > 0n)}>{textoBoton}</button>
      <button type="button" className="secundario" onClick={() => { setDividir(d => !d); setMedioId(null); }}>{dividir ? "Un solo medio" : "Dividir pago"}</button>
      <button name="enviar" value="pendiente" className="secundario" disabled={pendiente || aCobrar === null}>Registrar sin cobrar</button>
    </div>
    {estado?.error && <p className="alerta error" role="alert">{estado.error}</p>}
  </form>;
}
