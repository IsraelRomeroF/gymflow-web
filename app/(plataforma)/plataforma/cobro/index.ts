/**
 * COBRO DE PLATAFORMA (bloque 1.13). Antes era un solo archivo con cuatro
 * componentes y tres catálogos; ahora cada pieza vive en el suyo:
 * `textos` (tipos y palabras), `tarjeta` (la de la ficha), `emitir` (un solo
 * diálogo para una marca o todas), `pagar` (pago, abono y deshacer),
 * `anular` y `mes` (el campo de mes propio).
 */
export { Cobro } from './tarjeta';
export { Emitir } from './emitir';
export { Pagar, DeshacerPago } from './pagar';
export { Anular } from './anular';
export { CampoMes } from './mes';
// Bloque 3.11 (D-37): la escalera de cobranza.
export { AvisosDeMarca, EntregaDeAviso, MandarAviso, Prorroga, RenglonDeCobranza, claseDeAviso, fraseDeCobranza, type Aviso, type Cobranza, type Dueno } from './cobranza';
export * from './textos';
