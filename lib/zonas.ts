/** Zonas de México: la hora del corte, de los vencimientos y de las clases depende de esto. Una sola lista para el panel, la plataforma y la API (DP-09): la del núcleo. */
export { ZONAS_DE_MEXICO as ZONAS } from '@gymflow/core/calendario';

/**
 * HOY EN LA ZONA DEL GIMNASIO (13-12, 14-20, 26-06). `hoyEn` y `masDias`
 * viven en `lib/format.ts` (espejo con el portal, 1.5): los usan también los
 * campos de fecha. Aquí se reexportan para no cambiar importaciones.
 */
export { hoyEn, masDias } from './format';

/** La zona de una sucursal: la suya o, si no tiene, la del gimnasio (`null` = hereda). */
export function zonaDe(sede: { timezone: string | null } | null | undefined, gimnasio: { timezone: string }): string {
  return sede?.timezone ?? gimnasio.timezone;
}
