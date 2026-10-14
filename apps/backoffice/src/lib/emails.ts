/**
 * Si el backoffice ofrece «Recuperar acceso» (P03). En desarrollo siempre (el worker usa el transporte
 * falso y muestra el email en la consola). En producción y staging (`next start`, NODE_ENV=production)
 * solo con RECUPERACION_POR_EMAIL=true, que se activa cuando el worker ya tiene RESEND_API_KEY y el
 * dominio del remitente está verificado: si no, se emitirían enlaces que nadie recibe.
 */
export const recuperacionPorEmail = () => process.env.NODE_ENV !== "production" || process.env.RECUPERACION_POR_EMAIL === "true";
