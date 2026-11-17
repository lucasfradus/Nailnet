import type { Metadata } from "next";
import { datosCuenta } from "@nailnet/database/cuenta";
import { Formulario } from "@/components/formulario";
import { db } from "@/lib/db";
import { requerirSesion } from "@/lib/sesion";
import { fechaHora } from "@/lib/etiquetas";
import { accionCerrarOtrasSesiones, accionMiEmail, accionMiNombre, accionMiPassword } from "./acciones";

export const metadata: Metadata = { title: "Mi cuenta · Sicurella", referrer: "no-referrer" };

export default async function MiCuenta() {
  const sesion = await requerirSesion();
  const cuenta = await datosCuenta(db(), sesion.usuario.id, sesion.sesionId);

  return <section className="panel ficha-form">
    <p className="eyebrow">CONFIGURACIÓN</p><h1>Mi cuenta</h1>
    <p className="intro">{cuenta.email}</p>

    <h2 className="subtitulo">Nombre</h2>
    <Formulario accion={accionMiNombre} boton="Guardar nombre">
      <label>Nombre y apellido<input name="nombre" defaultValue={cuenta.nombre} required maxLength={120} autoComplete="name" /></label>
    </Formulario>

    <h2 className="subtitulo">Contraseña</h2>
    {/* La fecha va al final: «12:06 p. m.» ya termina en punto. */}
    <p className="ayuda">Al cambiarla se cierran tus sesiones en otros dispositivos.{cuenta.passwordActualizadaEn && ` Último cambio: ${fechaHora(cuenta.passwordActualizadaEn)}`}</p>
    <Formulario accion={accionMiPassword} boton="Cambiar contraseña">
      <label>Contraseña actual<input name="actual" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <label>Nueva contraseña<input name="nueva" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <label>Repetir nueva contraseña<input name="confirmacion" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <small className="ayuda">Mínimo 12 caracteres. Una frase fácil de recordar funciona bien.</small>
    </Formulario>

    <h2 className="subtitulo">Email de ingreso</h2>
    <p className="ayuda">Es con el que entrás al sistema y donde te llegan los enlaces para recuperar el acceso. Para cambiarlo, confirmá tu contraseña.</p>
    <Formulario accion={accionMiEmail} boton="Cambiar email">
      <label>Nuevo email<input name="email" type="email" defaultValue={cuenta.email} required maxLength={254} autoComplete="email" /></label>
      <label>Contraseña actual<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
    </Formulario>

    <h2 className="subtitulo">Sesiones</h2>
    <p className="ayuda">{cuenta.otrasSesiones ? `Tenés ${cuenta.otrasSesiones === 1 ? "1 sesión abierta" : `${cuenta.otrasSesiones} sesiones abiertas`} en otros dispositivos.` : "Solo tenés abierta esta sesión."} Si dejaste la cuenta abierta en una compu compartida, cerralas desde acá.</p>
    {cuenta.otrasSesiones > 0 && <Formulario accion={accionCerrarOtrasSesiones} boton="Cerrar las demás sesiones" className="en-linea" secundario
      confirmar="¿Cerrar tus sesiones en todos los demás dispositivos? Esta sigue abierta." />}
  </section>;
}
