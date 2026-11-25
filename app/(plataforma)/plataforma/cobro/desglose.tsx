import type { ReactNode } from 'react';
import { pesos } from '@gymflow/ui/format';
import { etiquetaDeIva, type Desglose, type Linea } from './textos';

/**
 * SUBTOTAL, IVA Y TOTAL (D-39, bloque 4.9), como filas de una tabla de dos
 * columnas. Sin IVA sale solo el total, como siempre. Con IVA: subtotal, IVA
 * con su tasa y total. `totalCents` es siempre lo que se paga.
 */
export function FilasDeDesglose({ d, total = 'Total', testidTotal }: { d: Desglose; total?: ReactNode; testidTotal?: string }) {
  const conIva = d.taxRateBps > 0 && d.taxCents !== '0';
  return (
    <>
      {conIva && <tr data-desglose="subtotal"><td>{d.taxIncluded ? 'Subtotal sin IVA' : 'Subtotal'}</td><td className="right num">{pesos(d.subtotalCents)}</td></tr>}
      {conIva && <tr data-desglose="iva"><td>{etiquetaDeIva(d)}</td><td className="right num">{pesos(d.taxCents)}</td></tr>}
      <tr data-desglose="total"><th>{total}</th><th className="right num" data-testid={testidTotal}>{pesos(d.totalCents)}</th></tr>
    </>
  );
}

/** Un renglón de factura o de mensualidad: el descuento va en negativo y se distingue. */
export function FilaDeLinea({ l, chica }: { l: Linea; chica?: boolean }) {
  const clase = chica ? 'small' : undefined;
  return (
    <tr data-linea={l.key} data-clase={l.kind ?? 'CHARGE'}>
      <td className={clase}>{l.name}{l.kind === 'PRORATED' || l.kind === 'CATCH_UP' ? <div className="tiny muted">El mes completo cuesta {pesos(l.listCents ?? l.monthlyCents)}; se cobra por días.</div> : null}</td>
      <td className={`right num${chica ? ' small' : ''}`}>{pesos(l.monthlyCents)}</td>
    </tr>
  );
}
