import type { CashRegister, CashSession, ShiftReport } from '@gymflow/core/contracts';

/**
 * Contratos y etiquetas de la caja, compartidos por la pantalla y el corte.
 * Los tipos son los contratos del núcleo y las palabras, su vocabulario
 * (fase 1.1): antes vivían copiados aquí y el portal decía otra cosa.
 */

export type Caja = CashRegister;
/** Un turno de caja (`GET /cash-sessions`). */
export type Turno = CashSession;
/** El corte de un turno (`GET /cash-sessions/:id`); ciego para quien cuenta. */
export type Corte = ShiftReport;

/**
 * Cómo se pagó, el turno, los movimientos del cajón y de dónde viene lo
 * cobrado: el vocabulario del núcleo. «Tarjeta en mostrador» y no «Tarjeta
 * (terminal)»: el socio ve la misma palabra en el portal (27-07).
 */
export {
  METODO_DE_PAGO as METODO, TURNO_DE_CAJA as TURNO, MOVIMIENTO_DE_CAJA as MOVIMIENTO, ORIGEN_DEL_COBRO as ORIGEN,
} from '@gymflow/core/vocabulario';

/** Billetes y monedas en circulación, en centavos: así se cuenta un cajón en México. */
export const DENOMINACIONES: Array<{ cents: number; label: string; tipo: 'billete' | 'moneda' }> = [
  { cents: 100_000, label: '$1,000', tipo: 'billete' },
  { cents: 50_000, label: '$500', tipo: 'billete' },
  { cents: 20_000, label: '$200', tipo: 'billete' },
  { cents: 10_000, label: '$100', tipo: 'billete' },
  { cents: 5_000, label: '$50', tipo: 'billete' },
  { cents: 2_000, label: '$20', tipo: 'billete' },
  { cents: 2_000, label: '$20', tipo: 'moneda' },
  { cents: 1_000, label: '$10', tipo: 'moneda' },
  { cents: 500, label: '$5', tipo: 'moneda' },
  { cents: 200, label: '$2', tipo: 'moneda' },
  { cents: 100, label: '$1', tipo: 'moneda' },
  { cents: 50, label: '50¢', tipo: 'moneda' },
];

/** "1,250.50" → 125050n. Acepta comas de miles y hasta dos decimales. */
export function aCentavos(texto: string): bigint | null {
  const limpio = texto.replace(/[\s,$]/g, '');
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(limpio)) return null;
  const [ent, dec = ''] = limpio.split('.');
  return BigInt(ent!) * 100n + BigInt(dec.padEnd(2, '0'));
}
