# Universos de recepción · propuesta · 2026-11-11

Propuesta (D21). Sale de una segunda visita del usuario al local y del prototipo navegable que revisó el 2026-11-11. Extiende el tablero de recepción (29-tablero-recepcion.md, D20). **Etapas 1 y 5 implementadas el 2026-11-11.** De las etapas 2 y 4 está hecha la capa de datos y falta la pantalla. La etapa 3 está propuesta.

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
3. **Flexibilidad con los turnos de Manos y pies.** Cambiar de profesional un turno reservado. Turno que llega con su profesional ocupada: pasa primero a la espera. Pasar una atención en curso a otra profesional. Sentar aunque pise un turno cercano, con aviso. Sumar un servicio a una atención en curso, para que la visita sea una sola comanda.
4. **Tratamientos: agenda del día en grilla.** Columnas por profesional o por cabina (las cabinas rotan), bloques por duración y línea de la hora actual. Mover un turno a otro horario o a otra profesional de la misma especialidad. Reservar tocando un hueco. Huecos del día para ofrecer por teléfono.
5. **Reportes por universo** (hecha). Las secciones de 30-reportes.md, para toda la sede o para un universo.

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

## Respuestas del usuario · 2026-11-11

| Pregunta | Respuesta | Dónde pega |
|---|---|---|
| ¿Se puede sentar con solo el nombre? | Sí. La ficha se completa después. La tarjeta tiene que distinguir si la clienta ya tiene ficha o no | Etapa 2 |
| ¿Sentar aunque pise un turno cercano? | Sí, sentar igual, con aviso | Etapa 3 |
| ¿Las cabinas de Tratamientos son fijas por profesional? | No, van rotando | Etapa 4: la grilla necesita también la vista por cabina |
| ¿Quién elige la cabina? | Recepción, siempre | Etapa 4: al reservar y al mover se elige la cabina; el motor tiene que aceptar una unidad pedida |
| ¿Hay que marcar la llegada en Tratamientos? | No. Solo se marca cuando empieza la sesión | Etapa 4: «Empezó» en lugar de «Llegó» |

Siguen abiertas:

- **Profesionales compartidas:** ¿alguna trabaja en los dos universos? Hoy aparecería en las dos pestañas.
- **Recepción:** ¿cada recepcionista mira un universo, o todas alternan? Hoy cada navegador recuerda el suyo.
- **Cobrar sin ficha:** al cobrar, la pantalla pide completar la ficha. ¿Tiene que ser obligatorio, o se puede cobrar igual si la clienta no quiere dar sus datos? La etapa 2 lo deja pasar con un aviso.

## Etapa 2: diseño · 2026-11-11

Sentar desde el tablero de Manos y pies, sin pasar por «Atender ahora», y con solo el nombre.

**Modelo** (migración nueva)

- `EsperaRecepcion.clienteId`, opcional: la clienta anotada ya tiene ficha.
- `Reserva.clienteProvisional`, texto opcional: nombre de la clienta sentada sin ficha. Un CHECK impide tener a la vez cliente y nombre provisional, y limita el largo como el nombre de la espera.

**Repositorio**

- **`agregarEspera`** acepta `clienteId` (de la organización). El nombre y el teléfono se guardan igual, para mostrar.
- **`sentarEspera`** (nuevo): sienta ahora uno o varios servicios de una clienta en espera, cada uno con su profesional.
  - Los servicios tienen que ser de los que pidió, sin repetir. Con dos, empiezan a la vez con profesionales distintas (mismo motor que «a la vez», etapa 2 del doc 29).
  - Con ficha, el turno queda a nombre del cliente. Sin ficha, queda con `clienteProvisional` y sin cliente.
  - **Sin ficha no se sienta un servicio que exige consentimiento de práctica:** el mensaje pide elegir o cargar la ficha antes.
  - Si se sentaron todos los servicios que pidió, la espera se cierra con su turno, en la misma transacción (como hoy). Si quedó alguno, la espera sigue abierta solo con los que faltan y conserva la hora de llegada.
  - Límite conocido: lo que se sienta después es otro turno y otra comanda. La etapa 3 lo une («sumar a la atención en curso»).
  - Mismas garantías que `atenderAhora`: permisos, locks, y si otra recepcionista ya la sentó o se fue, no se crea nada.
- **`asignarClienteReserva`** (nuevo): le pone la ficha a un turno que no la tiene (cualquier estado menos cancelado o vencido). Borra el nombre provisional, vincula el cliente a la sede y queda en la auditoría. Si el turno ya tiene cliente, se rechaza.
- **`atenderAhora`** y la reserva manual no cambian: siguen exigiendo cliente.
- **`tableroSede`** suma lo que la pantalla necesita:
  - por profesional, `libreDesde` (desde cuándo está libre: lo último entre su entrada y su último «Terminó» de hoy; nulo si está atendiendo) y `agenda` (sus ocupaciones de las próximas dos horas, para la franja: la atención en curso y los turnos reservados);
  - en la atención en curso y en por cobrar, el nombre provisional cuando no hay cliente;
  - en cada espera, el cliente si tiene ficha.
- La agenda y la pantalla de cobro muestran el nombre provisional donde hoy dicen «Sin cliente».

**Pantalla**

- **Manos y pies** (y las sedes con un solo universo) pasa a un tablero interactivo:
  - a la izquierda, «Llegó sin turno» (nombre, teléfono opcional, hasta 2 servicios con el buscador de «Atender ahora», profesional pedida opcional), la lista de espera y los turnos por llegar;
  - mientras se escribe el nombre o el teléfono, busca fichas existentes para elegir una;
  - al tocar una clienta en espera se resaltan las profesionales que pueden empezar ahora cada servicio, y un toque la sienta;
  - las que pisarían un turno cercano se muestran con el motivo y no se pueden elegir (la etapa 3 lo habilita);
  - libres ordenadas por quién espera hace más; ocupadas, por quién termina antes; cada tarjeta con la franja de sus próximas dos horas.
- **Con ficha o sin ficha:** la espera, la tarjeta de la profesional y por cobrar muestran «Sin ficha» cuando la clienta no la tiene; con ficha, el nombre enlaza a ella.
- **Cobro:** si el turno no tiene ficha, la pantalla de cobro pide primero buscarla o crearla (con el nombre y el teléfono de la espera ya cargados). Se puede cobrar sin ficha, con aviso.
- Tratamientos no cambia.

## Etapa 3: diseño · 2026-11-11

Flexibilidad en Manos y pies: que el sistema avise pero no trabe, y que la visita de una clienta sea una sola comanda. Va en dos entregas.

**3a · Sentar igual, cambiar de profesional y pasar una atención**

- **Sentar igual.** `sentarEspera` acepta `pisar`. Con eso, los turnos reservados que todavía no empezaron de esa profesional no cuentan como ocupación. Siguen contando una atención en curso, sus ausencias, su jornada y los recursos (un sillón ocupado no se pisa). El turno creado guarda en su evento qué turnos pisó.
- **Turno en riesgo.** `tableroSede` marca cada turno por llegar cuya profesional no va a estar libre a esa hora (atiende y su fin estimado pasa el inicio, o viene demorada), con el motivo.
- **Cambiar de profesional un turno por llegar.** Es `reprogramarReserva` a la misma hora con otra profesional. Las candidatas salen de `destinosDeTurno` (etapa 4): las que tienen ese mismo inicio libre.
- **Pasar una atención en curso** (`pasarAtencion`, nuevo): el servicio que está haciendo una profesional pasa a otra que lo hace y está libre ahora (o con `pisar`). Bajo los locks de las dos, y queda en la auditoría.
- **Pantalla:** las profesionales que pisarían un turno pasan a ser elegibles, con borde punteado y el aviso de qué turno pisan; el turno en riesgo se ve en «Turnos por llegar» con «Cambiar de profesional»; la tarjeta de quien atiende suma «Pasar».

**3b · Llegó con su profesional ocupada y una sola comanda por visita**

- **«Llegó» en Manos y pies.** Si su profesional está libre, la atención empieza (con `empezarSesion`, que además adelanta el turno si llegó antes). Si está ocupada, la clienta queda esperando: `Reserva.llegoEn` (columna nueva) y aparece primera en la lista de espera, con su turno y su profesional.
- **Sentar a la que llegó con turno** (`sentarTurno`, nuevo): con su profesional cuando se libera, o con otra. Mueve el turno a este minuto con las profesionales elegidas y empieza la atención, en una transacción.
- **Una comanda por visita.** `Reserva.esperaId` (columna nueva) enlaza el turno con la espera de la que salió; reemplaza el dato que hoy va en el evento de creación. Si la clienta ya tiene una atención en curso de esa espera, `sentarEspera` **suma** los servicios que faltaban a ese turno en vez de crear otro.
- **Sumar un servicio** (`sumarServicio`, nuevo): agrega a una atención en curso un servicio que empieza ahora con otra profesional. Lo usa `sentarEspera` y un «+ servicio» en la tarjeta.
- Tratamientos no usa nada de esto: ahí solo se marca el comienzo (etapa 4).

## Etapa 4: diseño · 2026-11-11

La pestaña Tratamientos pasa de listas a una grilla del día. Se apoya en lo que ya existe para operar el turno (doc 17): `tomarTurno`, `reprogramarReserva`, «Llegó», «Terminó», cancelar y ausente.

**Repositorio** (archivo nuevo `packages/database/src/agenda-dia.ts`)

- **`agendaDia`**: lo que la grilla necesita de una fecha y un universo.
  - Apertura de la sede ese día, paso de la grilla y si la fecha es hoy.
  - Profesionales del universo (misma regla que el tablero), con su jornada y sus ausencias del día.
  - Cabinas: las unidades activas de la sede de los tipos de recurso que piden los servicios del universo.
  - Turnos del día (sin cancelados ni vencidos), uno por servicio: profesional, cabinas asignadas, horario, servicio, clienta y estado para la grilla (pendiente de seña, confirmado, en sesión, por cobrar, cobrado o ausente).
- **`destinosDeTurno`**: a dónde se puede mover un turno confirmado en una fecha. Por cada profesional que hace el servicio, los inicios que el motor aceptaría, sin contar la ocupación del propio turno (para poder correrlo media hora). Un turno de varios servicios solo cambia de horario, con las mismas profesionales.
- **Cabina elegida por recepción.** El pedido al motor admite, por servicio, las unidades de recurso pedidas (`recursoIds`). Con una unidad pedida el motor usa esa o no hay turno; sin pedir, asigna cualquiera libre, como hoy (el portal sigue así). Es el «requisito de unidad específica» que el doc 14 dejó pendiente.
- **`destinosDeTurno`** informa, para cada inicio, qué cabinas están libres.
- **Mover** es `reprogramarReserva`, con profesional y cabina de destino: atómico, conserva precio y seña. También sirve para cambiar solo la cabina. Un turno pendiente de seña no se mueve.
- **Reservar en un hueco** es `tomarTurno` con profesional, cabina e inicio. Exige cliente: se busca o se crea con nombre y teléfono, como hoy.
- **«Empezó»** (`marcarLlegada` con otro nombre en pantalla): marca que la sesión empezó. Si la clienta llegó antes de su hora y la profesional y la cabina están libres hasta el turno, la ocupación se adelanta a este minuto. Así «Terminó» vale en cualquier momento después de empezar y desaparece el límite de la etapa 1. Si no están libres, se rechaza con el motivo.

**Pantalla**

- Navegación por fecha (hoy, anterior, siguiente), porque los tratamientos se reservan con anticipación. Las acciones del día («Empezó», «Terminó») solo valen hoy.
- Columnas por profesional o por cabina, y se opera desde cualquiera de las dos vistas. En la de cabina, tocar un hueco reserva en esa cabina y pide la profesional; en la de profesional, pide la cabina entre las libres.
- Bloques con la altura de su duración y el estado en color y en texto; línea de la hora actual; fuera de la jornada, sombreado.
- Tocar un turno abre su panel con las acciones que le corresponden. «Mover» resalta los destinos válidos en la grilla y un toque lo mueve, eligiendo la cabina si hay más de una libre; también se puede arrastrar.
- Tocar un inicio libre abre «Nuevo turno» con la profesional (o la cabina) y la hora ya puestas.
- Huecos del día de una hora o más, para ofrecer por teléfono.
- Debajo siguen «Por cobrar» y la entrada y salida de las profesionales.

## Etapa 5: reportes por universo · 2026-11-11

La pantalla Reportes se ve para toda la sede, como antes, o para un universo. Las definiciones están en 30-reportes.md, sección «Por universo».

- El selector aparece solo si la sede tiene servicios de los dos universos, y se conserva al cambiar el período. El CSV acepta `universo`.
- Con un universo: ventas y base comisionable solo con las líneas de sus servicios (el descuento se prorratea sobre la venta completa y después se filtra); turnos y clientes con algún servicio suyo; ocupación y presencia de sus profesionales.
- **Lo que es de la venta completa no se separa:** ticket promedio, cobros por medio de pago y señas. Tampoco los productos, que no tienen universo.
- El universo de un servicio es el de su categoría al momento del reporte: cambiar una categoría de universo mueve también su historia.

## Verificación

- `npm run test:database` (207 pruebas): el universo de la categoría (por defecto, edición, valor inválido, herencia al servicio) y el tablero separado (sede con un solo universo, profesional de los dos, profesional sin servicios, turnos de hoy, espera, por cobrar compartido, resumen de pestañas y atención de una profesional sin entrada marcada). El seed corre dos veces y agrega los tratamientos una sola.
- `npm run check` y `npm run test:domain`.
- Etapa 5, en un navegador real contra la demo, con una atención cobrada de cada universo y una mixta con descuento: los totales de cada universo dan lo esperado con el descuento prorrateado, los seis CSV bajan, el de cobros con un universo y un universo desconocido responden 400, y una sede de un solo universo no muestra el selector.
- Probado en un navegador real (Chromium) contra una base local con la demo:
  - las dos pestañas con su resumen, y cada una con sus profesionales, servicios, espera y turnos;
  - el orden de las secciones y los botones de Tratamientos;
  - la pestaña recordada al volver sin `?u=` y conservada al filtrar por servicio;
  - «Llegó» de una clienta con turno cuya profesional no tenía la entrada marcada: aparece en «En sesión»;
  - «Terminó» en Manos y pies: la comanda se ve por cobrar desde Tratamientos;
  - cambiar el universo de una categoría desde su ficha mueve sus servicios y profesionales de pestaña;
  - una sede con un solo universo (Norte) sigue sin pestañas.
