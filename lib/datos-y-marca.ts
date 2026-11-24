import { DATO_DEL_GIMNASIO } from '@gymflow/core/vocabulario';
import { telefono } from './format';

/**
 * DATOS Y MARCA DEL GIMNASIO (D-27, bloque 4.6): lo que comparten «Mi
 * gimnasio» (el panel los muestra y pide cambios) y la consola de plataforma
 * (los administra). Las reglas de cada dato las aplica la API; aquí solo se
 * decide cómo se escriben y cómo se muestran.
 */
export const DATOS: readonly string[] = Object.keys(DATO_DEL_GIMNASIO);
export const esDeSucursal = (dato: string): boolean => dato === 'BRANCH_PHONE' || dato === 'BRANCH_HOURS';
export const esTelefono = (dato: string): boolean => dato === 'PHONE' || dato === 'WHATSAPP' || dato === 'BRANCH_PHONE';
/** Los datos que se pueden dejar vacíos (quitar); los nombres no. */
export const sePuedeQuitar = (dato: string): boolean => !['TRADE_NAME', 'LEGAL_NAME', 'OTHER'].includes(dato);

/** Un valor como se lee en pantalla: los teléfonos con espacios; lo vacío, dicho. */
export function valorDeDato(dato: string, valor: string | null | undefined): string {
  if (!valor) return 'Sin registrar';
  return esTelefono(dato) ? telefono(valor) : valor;
}

/** Qué escribir en «Valor nuevo» de cada dato. */
export const AYUDA_DE_DATO: Readonly<Record<string, string>> = {
  TRADE_NAME: 'Como lo conocen tus socios: sale en el panel, en el recibo y en su teléfono.',
  LEGAL_NAME: 'Como aparece en tu constancia de situación fiscal.',
  RFC: '12 caracteres si es una empresa, 13 si es una persona.',
  PHONE: 'Los 10 dígitos. Sale en el recibo.',
  WHATSAPP: 'Los 10 dígitos del número que atiende por WhatsApp.',
  RECEIPT_LEGEND: 'Hasta 300 caracteres. Se imprime al pie de cada recibo.',
  BRANCH_PHONE: 'Los 10 dígitos del teléfono de esa sucursal.',
  BRANCH_HOURS: 'Como lo dirías en un letrero: «Lunes a viernes de 6:00 a 22:00; sábado de 8:00 a 14:00».',
  OTHER: 'Di qué dato es y cómo debe quedar: zona horaria, correo de cobro, contratar un módulo…',
};

export const LOGO_MAX_KB = 200;
const TIPOS_DE_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

/** Lee el archivo del logo como `data:` URL. Rechaza aquí lo que la API rechazaría: otro formato o más de 200 KB. */
export function leerLogo(archivo: File): Promise<string> {
  if (!TIPOS_DE_LOGO.includes(archivo.type)) return Promise.reject(new Error('El logo debe ser una imagen PNG, JPG o WebP.'));
  if (archivo.size > LOGO_MAX_KB * 1024) return Promise.reject(new Error(`El logo pesa ${Math.ceil(archivo.size / 1024)} KB: usa una imagen de hasta ${LOGO_MAX_KB} KB.`));
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(archivo);
  });
}
