import type { EstadoIncidencia, FuenteIncidencia, TipoAccion, TipoIncidencia } from "@nailnet/domain/incidencias";

export const FUENTES_ETIQUETA: Record<FuenteIncidencia, string> = { TRABAJO: "Cola de trabajos", PAGO: "Pagos", EMAIL: "Emails" };
// Ruta de la ficha: /incidencias/{fuente en minúsculas}/{id}.
export const RUTA_FUENTE: Record<FuenteIncidencia, string> = { TRABAJO: "trabajo", PAGO: "pago", EMAIL: "email" };
export const FUENTE_DE_RUTA: Record<string, FuenteIncidencia> = { trabajo: "TRABAJO", pago: "PAGO", email: "EMAIL" };

export const TIPOS: Record<TipoIncidencia, { titulo: string; ayuda: string }> = {
  TRABAJO_FALLIDO: { titulo: "Trabajo fallido", ayuda: "Agotó los intentos o tuvo un error que no se arregla reintentando. Si la causa ya se corrigió (credenciales, dominio, datos), se puede reintentar: es el mismo trabajo y no duplica efectos." },
  TRABAJO_ATRASADO: { titulo: "Trabajo atrasado", ayuda: "Lleva más de 5 minutos esperando turno: el worker está caído, trabado o no sabe manejar ese tipo (por ejemplo, emails sin clave de Resend). Se retoma solo cuando el worker vuelve." },
  TRABAJO_TRABADO: { titulo: "Trabajo trabado", ayuda: "Un worker lo tomó y no lo cerró: su lease venció hace más de 5 minutos. Otro worker lo retoma solo con un intento más." },
  PAGO_A_DEVOLVER: { titulo: "Pago a devolver", ayuda: "Se cobró, pero no había turno que confirmar (horario ocupado, reserva cancelada, pago duplicado o monto distinto). La devolución se hace desde Mercado Pago: el sistema todavía no reembolsa." },
  PAGO_SIN_IMPUTAR: { titulo: "Seña sin imputar", ayuda: "La seña está aprobada pero el turno se canceló o se reprogramó. Hay que devolverla o pasarla al turno nuevo a mano." },
  PAGO_AMBIGUO: { titulo: "Pago en estado ambiguo", ayuda: "Mercado Pago lo informó en proceso y no se resolvió en 30 minutos. Consultalo en el panel de Mercado Pago antes de tocar el turno." },
  PAGO_REEMBOLSADO_CON_TURNO: { titulo: "Seña reembolsada con turno vigente", ayuda: "Mercado Pago informó un reembolso o contracargo de la seña y el turno sigue en pie. Decidí con la clienta si se mantiene." },
  EMAIL_FALLIDO: { titulo: "Email no enviado", ayuda: "El proveedor lo rechazó o informó una falla. La clienta no recibió el aviso: conviene contactarla por otro medio." },
  EMAIL_REBOTADO: { titulo: "Email rebotado", ayuda: "La dirección no existe o no acepta correo. Corregí el email en la ficha de la clienta." },
  EMAIL_QUEJA: { titulo: "Email marcado como spam", ayuda: "La destinataria lo marcó como spam. Evitá mandarle más emails hasta hablar con ella." },
};

export const ESTADOS: Record<EstadoIncidencia, { etiqueta: string; clase: string }> = {
  ABIERTA: { etiqueta: "Sin revisar", clase: "tag estado-cancelada" },
  EN_SEGUIMIENTO: { etiqueta: "En seguimiento", clase: "tag estado-pendiente_pago" },
  RESUELTA: { etiqueta: "Resuelta", clase: "tag estado-confirmada" },
};

export const ACCIONES: Record<TipoAccion, { etiqueta: string; boton: string; ayuda: string }> = {
  REVISADA: { etiqueta: "Revisada", boton: "Marcar revisada", ayuda: "Queda en seguimiento: alguien ya la vio." },
  RESUELTA: { etiqueta: "Resuelta", boton: "Marcar resuelta", ayuda: "Cierra la incidencia. Si la fuente vuelve a fallar, reaparece." },
  REABIERTA: { etiqueta: "Reabierta", boton: "Reabrir", ayuda: "Vuelve a «sin revisar»." },
  REINTENTADA: { etiqueta: "Reintentada", boton: "Reintentar trabajo", ayuda: "El mismo trabajo vuelve a la cola con los intentos en cero." },
  DEVOLUCION_GESTIONADA: { etiqueta: "Devolución gestionada", boton: "Registrar devolución gestionada", ayuda: "Deja constancia de que la devolución se pidió o se hizo fuera del sistema (con qué operación). No la da por completa: se cierra cuando Mercado Pago la informa o al marcarla resuelta." },
};
export const EXITO: Record<TipoAccion, string> = {
  REVISADA: "Incidencia marcada como revisada", RESUELTA: "Incidencia resuelta", REABIERTA: "Incidencia reabierta",
  REINTENTADA: "Trabajo devuelto a la cola", DEVOLUCION_GESTIONADA: "Devolución registrada como gestionada",
};

export const fechaHora = (d: Date) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }).format(d);
export const pesos = (v: string) => `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
