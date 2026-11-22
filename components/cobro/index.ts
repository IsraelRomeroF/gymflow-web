/*
 * LA PIEZA DE COBRO (fase 1.4), una sola para todo el mostrador:
 *
 *   campos            método, caja (cualquiera que cobre la elige) y referencia
 *   cambio            «Paga con / Cambio»
 *   resolver-rechazo  la puerta dijo que no: cobrar y abrir, renovar y abrir,
 *                     dejar pasar con motivo, no pasa. Se importa por su ruta
 *                     (`@/components/cobro/resolver-rechazo`) porque usa la venta.
 */
export { CobroFields, cobroListo, cuerpoDelCobro, COBRO_INICIAL, type Cobro, type Metodo } from './campos';
export { CambioEfectivo } from './cambio';
