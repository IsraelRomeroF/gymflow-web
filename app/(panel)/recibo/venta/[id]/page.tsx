'use client';

import { use, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaHora, pesos } from '@/lib/format';
import { METODO } from '@/lib/caja';
import { useSession, errorText } from '@/components/session';
import { Button, Callout, Skeleton } from '@/components/ui';
import type { PosSale, Product } from '@gymflow/core/contracts';

/** Contratos del núcleo (8-19). */
type Venta = PosSale;
type Producto = Pick<Product, 'id' | 'name' | 'sku'>;

/**
 * TICKET DE VENTA del punto de venta (MC-06), tamaño ticket.
 *
 * Igual que el comprobante de pago: qué se llevó, cuánto y cómo pagó. No es
 * un CFDI y así lo dice.
 */
export default function ReciboVentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, branchName } = useSession();
  const [v, setV] = useState<Venta | null>(null);
  const [nombres, setNombres] = useState<Map<string, Producto>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<Venta>(`/pos/sales/${id}`), api<{ products: Producto[] }>('/products').catch(() => ({ products: [] as Producto[] }))])
      .then(([venta, p]) => { setV(venta); setNombres(new Map(p.products.map((x) => [x.id, x]))); })
      .catch((e) => setError(errorText(e, 'No se pudo cargar el ticket')));
  }, [id]);

  if (error) return <Callout tone="danger" title="Sin ticket">{error}</Callout>;
  if (!v) return <div className="recibo"><Skeleton h={360} r={12} /></div>;

  return (
    <div className="stack items-center">
      <div className="no-print"><Button icon={<Printer />} onClick={() => window.print()}>Imprimir</Button></div>
      <article className="recibo">
        <header>
          <p className="recibo-org">{org.tradeName}</p>
          <p>{branchName(v.branchId)}</p>
          <p>{fechaHora(v.soldAt)}</p>
          {v.folio && <p className="recibo-folio">Folio {v.folio}</p>}
        </header>
        {v.status === 'VOIDED' && <p className="recibo-aviso">VENTA ANULADA{v.voidReason ? ` · ${v.voidReason}` : ''}</p>}
        <table>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.quantity}× {nombres.get(l.productId)?.name ?? 'Producto'}<br /><span className="tiny muted">{pesos(l.unitPriceCents)} c/u{l.priceKind === 'MEMBER' ? ' · precio de socio' : ''}</span></td>
                <td>{pesos(l.lineTotalCents)}</td>
              </tr>
            ))}
            <tr className="total"><td>Total</td><td>{pesos(v.totalCents)}</td></tr>
          </tbody>
        </table>
        <p>{v.method ? METODO[v.method] ?? v.method : 'Sin cobro'}</p>
        <footer>
          Ticket de venta. No es un comprobante fiscal (CFDI); si necesitas factura, pídela en recepción.
        </footer>
      </article>
    </div>
  );
}
