# Universos de recepción · propuesta · 2026-11-11

Propuesta (D21). Sale de una segunda visita del usuario al local y del prototipo navegable que revisó el 2026-11-11. Extiende el tablero de recepción (29-tablero-recepcion.md, D20). **Etapa 1 implementada el 2026-11-11** (ver «Etapa 1: implementación» abajo); las demás están propuestas.

## Qué se vio en el local

En la sede corren dos negocios a la vez:

| | Manos y pies | Tratamientos |
|---|---|---|
| Qué es | Manicuría y pedicuría | Masajes, depilación (varios tipos y zonas), cejas, tratamientos corporales y faciales |
| Cómo llega la clienta | Con turno y sin turno | Solo con turno previo |
| Volumen | El mayor: entre 15 y 20 profesionales por turno | Menor; sesiones de 60 o 90 minutos |
| Qué mira recepción | El salón: quién está libre ahora y para qué | La agenda del día: quién viene, a qué hora y con quién |

El tablero del doc 29 resuelve bien el primero. Para el segundo, una lista de profesionales libres dice poco: lo que importa es el horario.

## Modelo

- **El universo es de la categoría** (`CategoriaServicio.universo`: `MANOS_PIES` o `TRATAMIENTOS`). Sus servicios lo heredan. Lo define el master, como el resto del catálogo global (D12).
- **Una profesional está en un universo si hace algún servicio suyo.** Si hace de los dos, aparece en los dos. Si todavía no tiene servicios habilitados, aparece en los dos, para que recepción igual pueda marcarle la entrada y la salida.
- **La caja es una sola.** Una clienta puede pasar por los dos universos en la misma visita; lo que falta cobrar se ve desde cualquiera de los dos.
- **Con un solo universo en la sede no cambia nada.** El tablero se separa recién cuando la sede tiene habilitados servicios de los dos.
- Los nombres de los dos universos son fijos. No hay una entidad «universo» configurable: si otra organización necesita otra división, se revisa entonces.

## Etapas

1. **Universos en el catálogo y en Recepción** (hecha). Cada categoría tiene su universo y el tablero se separa en dos pestañas con los datos de cada uno.
2. **Manos y pies: sentar desde el tablero.** Elegir una clienta en espera y resaltar quién puede; sentarla con un toque, sin pasar por «Atender ahora». Alta rápida de la clienta sin turno. Libres ordenadas por quién espera hace más y ocupadas por quién termina antes. Franja con las próximas dos horas de cada profesional.
3. **Flexibilidad con los turnos de Manos y pies.** Cambiar de profesional un turno reservado. Turno que llega con su profesional ocupada: pasa primero a la espera. Pasar una atención en curso a otra profesional. Sentar aunque pise un turno cercano, con aviso (ver preguntas).
4. **Tratamientos: agenda del día en grilla.** Columnas por profesional, bloques por duración y línea de la hora actual. Mover un turno a otro horario o a otra profesional de la misma especialidad. Reservar tocando un hueco. Huecos del día para ofrecer por teléfono.
5. **Reportes por universo.** Las secciones de 30-reportes.md, separadas.

Cada etapa es un cambio que se puede usar solo.

## Etapa 1: implementación · 2026-11-11

Migración `202611110010_universos`. Dominio en `packages/domain/src/catalogo.ts` (`UNIVERSOS`), repositorio en `packages/database/src/catalogo.ts` y `packages/database/src/tablero.ts`. Pruebas en `packages/database/tests/catalogo.test.ts` y `packages/database/tests/tablero.test.ts`.

**Catálogo**

- Columna `universo` en la categoría, por defecto `MANOS_PIES`: las categorías que ya existen quedan ahí hasta que el master las cambie.
- Catálogo → Categorías muestra el universo de cada una y la ficha lo edita. Guardar sin indicarlo conserva el que tenía.
- `catalogoSede` devuelve el universo de cada servicio.

**Tablero** (`tableroSede`, opción `universo`)

- Con la opción, y si la sede ofrece servicios de los dos, devuelve solo ese universo:
  - sus servicios;
  - las profesionales que hacen alguno, con solo esos servicios;
  - la lista de espera de las que pidieron primero un servicio suyo;
  - los turnos por llegar que tienen algún servicio suyo.
- **Por cobrar no se separa.**
- **Tratamientos muestra todos los turnos que quedan hoy**, no solo los de las próximas dos horas.
- `universos` trae el resumen de cada uno (libres, atendiendo, en espera y por llegar) para las pestañas. Es el mismo desde cualquiera de las dos.
- Sin la opción devuelve todo junto, como antes.

**Pantalla Recepción**

- Dos pestañas con su resumen: «3 libres · 2 en espera» y «1 en sesión · 4 por llegar».
- La pestaña elegida va en la URL (`?u=manos` o `?u=tratamientos`) y se recuerda en el navegador con la cookie `nailnet_universo`, así al volver desde el menú o desde «Atender ahora» se cae en la misma. Es una preferencia de pantalla, no un permiso.
- **Manos y pies:** igual que antes, con sus profesionales y servicios.
- **Tratamientos:**
  - primero «Turnos de hoy», después «En sesión», «Libres» y «Por cobrar»;
  - el botón principal es «Nuevo turno»; «Atender ahora» sigue disponible;
  - no ofrece anotar en espera. Si ya hay una clienta anotada para un tratamiento, la lista se muestra igual.
- En los turnos por llegar, «Llegó» aparece desde una hora antes (antes el servidor lo rechazaba) y un turno pasado de hora dice cuántos minutos lleva.
- **Quien atiende está en el local.** Una profesional con una atención en curso en la sede se muestra y se cuenta como atendiendo aunque recepción no le haya marcado la entrada. Antes, si la clienta con turno llegaba y a su profesional no le habían marcado la entrada, la atención no aparecía en el tablero y no había dónde tocar «Terminó». Vale para los dos universos.

**Demo**

- El seed agrega masajes y cejas en Centro, con dos profesionales, para ver las dos pestañas. También en una demo creada antes; si falla no frena el despliegue de staging.

**Fuera de la etapa 1**

- Atender sin turno un tratamiento no está bloqueado: «Atender ahora» lo sigue permitiendo.
- «Atender ahora» y «Nuevo turno» ofrecen todos los servicios, sin filtrar por universo.
- La agenda, los reportes y el portal no cambian.
- **Clienta que llega antes de su turno:** «Llegó» vale desde una hora antes, pero «Terminó» se rechaza hasta la hora del turno («marcalo atendido desde la agenda», doc 29). En Tratamientos va a pasar seguido; se resuelve con la grilla de la etapa 4, donde el turno se puede adelantar.

## Preguntas abiertas

- **Pisar turnos:** hoy el motor rechaza sentar a una clienta si choca con un turno de esa profesional. ¿Se permite con aviso (y el turno afectado queda marcado para pasarlo a otra), o sigue bloqueando? Define la etapa 3.
- **Cabinas:** ¿cada profesional de Tratamientos trabaja el día en un lugar fijo, o rotan? Si rotan, la grilla de la etapa 4 necesita también una vista por cabina.
- **Profesionales compartidas:** ¿alguna trabaja en los dos universos?
- **Recepción:** ¿cada recepcionista mira un universo, o todas alternan?
- **Clienta sin ficha:** el prototipo sienta con solo el nombre. Hoy «Atender ahora» exige elegir o crear el cliente. ¿Se puede sentar con el nombre y completar la ficha al cobrar? Define la etapa 2.

## Verificación

- `npm run test:database` (207 pruebas): el universo de la categoría (por defecto, edición, valor inválido, herencia al servicio) y el tablero separado (sede con un solo universo, profesional de los dos, profesional sin servicios, turnos de hoy, espera, por cobrar compartido, resumen de pestañas y atención de una profesional sin entrada marcada). El seed corre dos veces y agrega los tratamientos una sola.
- `npm run check` y `npm run test:domain`.
- Probado en un navegador real (Chromium) contra una base local con la demo:
  - las dos pestañas con su resumen, y cada una con sus profesionales, servicios, espera y turnos;
  - el orden de las secciones y los botones de Tratamientos;
  - la pestaña recordada al volver sin `?u=` y conservada al filtrar por servicio;
  - «Llegó» de una clienta con turno cuya profesional no tenía la entrada marcada: aparece en «En sesión»;
  - «Terminó» en Manos y pies: la comanda se ve por cobrar desde Tratamientos;
  - cambiar el universo de una categoría desde su ficha mueve sus servicios y profesionales de pestaña;
  - una sede con un solo universo (Norte) sigue sin pestañas.
