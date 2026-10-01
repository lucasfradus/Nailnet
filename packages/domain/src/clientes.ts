import { normalizarEmail } from "./credenciales.ts";

// Ficha mínima: contacto e identificación opcional. Sin datos de salud ni fotos (fuera del MVP).
export type Sexo = "FEMENINO" | "MASCULINO" | "OTRO" | "NO_INFORMA";
export type TipoDocumento = "DNI" | "CUIT" | "CUIL" | "PASAPORTE";
export type DatosCliente = {
  nombre: string; apellido?: string | null; email?: string | null; telefono?: string | null;
  sexo?: Sexo | null; tipoDocumento?: TipoDocumento | null; documento?: string | null;
};

const SEXOS: readonly Sexo[] = ["FEMENINO", "MASCULINO", "OTRO", "NO_INFORMA"];
const DOCUMENTOS: Record<TipoDocumento, RegExp> = { DNI: /^\d{7,8}$/, CUIT: /^\d{11}$/, CUIL: /^\d{11}$/, PASAPORTE: /^[A-Z0-9]{6,12}$/ };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Solo dígitos con + opcional; admite formatos locales («011 15-...») sin intentar reescribirlos. */
export function normalizarTelefono(telefono: string): string | null {
  const limpio = telefono.trim().replace(/[\s().-]/g, "");
  return /^\+?\d{8,15}$/.test(limpio) ? limpio : null;
}

const texto = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

export function validarCliente(d: DatosCliente): { error: string } | { datos: Required<DatosCliente> } {
  const nombre = texto(d.nombre, 80);
  if (!nombre) return { error: "El nombre es obligatorio" };
  const email = d.email?.trim() ? normalizarEmail(d.email) : null;
  if (email && (email.length > 254 || !EMAIL.test(email))) return { error: "Email inválido" };
  const telefono = d.telefono?.trim() ? normalizarTelefono(d.telefono) : null;
  if (d.telefono?.trim() && !telefono) return { error: "Teléfono inválido: entre 8 y 15 dígitos" };
  if (!email && !telefono) return { error: "Indicá al menos un email o un teléfono de contacto" };
  const sexo = d.sexo || null;
  if (sexo && !SEXOS.includes(sexo)) return { error: "Sexo inválido" };
  const tipoDocumento = d.tipoDocumento || null;
  const documento = d.documento?.trim() ? d.documento.trim().toUpperCase().replace(/[\s.-]/g, "") : null;
  if (!!tipoDocumento !== !!documento) return { error: "Indicá tipo y número de documento juntos" };
  if (tipoDocumento && (!DOCUMENTOS[tipoDocumento] || !DOCUMENTOS[tipoDocumento].test(documento!))) return { error: "Documento inválido" };
  return { datos: { nombre, apellido: texto(d.apellido, 80), email, telefono, sexo, tipoDocumento, documento } };
}

export type TipoConsentimiento = "PRACTICA" | "TERMINOS" | "MARKETING";
export type RegistroConsentimiento = { clave: string; version: number; accion: "ACEPTA" | "REVOCA"; registradoEn: Date };

/**
 * Estado de un consentimiento para un cliente. Vale solo la aceptación de la versión vigente que no
 * fue revocada después: una versión nueva del texto exige aceptar de nuevo.
 */
export function estadoConsentimiento(registros: readonly RegistroConsentimiento[], clave: string, versionVigente: number): "VIGENTE" | "DESACTUALIZADO" | "REVOCADO" | "NUNCA" {
  const propios = registros.filter(r => r.clave === clave).sort((a, b) => a.registradoEn.getTime() - b.registradoEn.getTime());
  const ultimo = propios.at(-1);
  if (!ultimo) return "NUNCA";
  if (ultimo.accion === "REVOCA") return "REVOCADO";
  return ultimo.version === versionVigente ? "VIGENTE" : "DESACTUALIZADO";
}

export function validarClaveConsentimiento(clave: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(clave) && clave.length <= 60;
}
