/**
 * ENTREGA DE UNA CONTRASEÑA TEMPORAL (22-03, A4-N1).
 *
 * Cada temporal va a su dueño y a nadie más: por WhatsApp a SU celular con
 * SOLO su clave, copiada o en su hoja. La usan Personal (la gerencia a su
 * gente) y la consola de plataforma (los accesos de arranque).
 */

/** Días que vale una temporal: la misma regla que aplica la API (`auth.service.ts`). */
export const TEMPORAL_DIAS = 7;

/** El número para `wa.me`: el celular en E.164 sin «+»; a 10 dígitos se le antepone el 52. */
export function whatsappDe(tel: string | null | undefined): string | null {
  const d = (tel ?? '').replace(/\D/g, '');
  if (d.length === 10) return `52${d}`;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

/** Lo que recibe UNA persona: su correo y su clave, nada de nadie más. */
export function mensajeDeAcceso(gimnasio: string, entrada: string, p: { fullName: string; email: string; password: string }): string {
  return `${gimnasio} · tu acceso a GymFlow\n\nHola, ${p.fullName}. Entra en ${entrada} con:\n  Correo: ${p.email}\n  Contraseña temporal: ${p.password}\n\n`
    + `Al entrar eliges la tuya: la temporal solo sirve para eso y vence en ${TEMPORAL_DIAS} días. No la compartas.`;
}

/** El enlace de WhatsApp al celular de esa persona con su mensaje, o null si no hay número válido. */
export function enlaceWhatsapp(tel: string | null | undefined, mensaje: string): string | null {
  const numero = whatsappDe(tel);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}` : null;
}

/** La dirección del login de este panel, para el mensaje. */
export function direccionDeEntrada(): string {
  return typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
}
