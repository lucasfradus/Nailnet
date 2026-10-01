"use client";
import { useActionState, useEffect, useState } from "react";
import { ingresar, recuperar, restablecer, type EstadoFormulario } from "./actions";

function Mensaje({ estado }: { estado: EstadoFormulario }) {
  if (estado?.error) return <p className="alerta error" role="alert">{estado.error}</p>;
  if (estado?.ok) return <p className="alerta ok" role="status">{estado.ok}</p>;
  return null;
}

export function FormularioIngreso() {
  const [estado, accion, pendiente] = useActionState(ingresar, undefined);
  return <form action={accion} className="formulario">
    <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} autoFocus /></label>
    <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
    <Mensaje estado={estado} />
    <button disabled={pendiente}>{pendiente ? "Ingresando…" : "Ingresar"}</button>
  </form>;
}

export function FormularioRecuperacion() {
  const [estado, accion, pendiente] = useActionState(recuperar, undefined);
  return <form action={accion} className="formulario">
    <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} autoFocus /></label>
    <Mensaje estado={estado} />
    <button disabled={pendiente}>{pendiente ? "Enviando…" : "Enviar enlace"}</button>
  </form>;
}

export function FormularioRestablecer() {
  const [estado, accion, pendiente] = useActionState(restablecer, undefined);
  // El token viaja en el fragmento (#): el navegador no lo envía en requests ni en Referer.
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    history.replaceState(null, "", window.location.pathname);
  }, []);
  if (estado?.ok) return <><Mensaje estado={estado} /><a className="boton" href="/login">Ir al ingreso</a></>;
  return <form action={accion} className="formulario">
    <input type="hidden" name="token" value={token} />
    <label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
    <label>Repetir contraseña<input name="confirmacion" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
    <small className="ayuda">Mínimo 12 caracteres. Una frase fácil de recordar funciona bien.</small>
    <Mensaje estado={estado} />
    <button disabled={pendiente || !token}>{pendiente ? "Guardando…" : "Guardar contraseña"}</button>
  </form>;
}
