'use client';

import { use, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { concepto, fecha, fechaHora, pesos } from '@gymflow/ui/format';
import { METODO_DE_PAGO, etiqueta } from '@gymflow/core/vocabulario';
import type { PaymentReceipt } from '@gymflow/core/contracts';
import { useSession, errorText } from '@/components/session';
import { Button, Callout, Skeleton } from '@/components/ui';
import { LogoDeRecibo, PieDeRecibo } from '@/components/recibo-gimnasio';

/** Lo que se imprime: contrato del núcleo (`GET /payments/:id/receipt`), ya no un tipo a mano. */
type Recibo = PaymentReceipt;

/**
 * COMPROBANTE DE PAGO, tamaño ticket.
 *
 * Lo que el socio se lleva: quién cobró dónde, cuánto, con qué y a qué se
 * aplicó. Se imprime en la impresora de tickets o se manda como foto. No es
 * un CFDI: la factura electrónica es otro trámite y así lo dice.
 */
export default function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, branchName } = useSession();
  const [r, setR] = useState<Recibo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Recibo>(`/payments/${id}/receipt`).then(setR).catch((e) => setError(errorText(e, 'No se pudo cargar el comprobante'))); }, [id]);

  if (error) return <Callout tone="danger" title="Sin comprobante">{error}</Callout>;
  if (!r) return <div className="recibo"><Skeleton h={420} r={12} /></div>;

  const p = r.payment;
  const aFavor = BigInt(p.unappliedCents);
  return (
    <div className="stack items-center">
      <div className="no-print"><Button icon={<Printer />} onClick={() => window.print()}>Imprimir</Button></div>
      <article className="recibo">
        <header>
          {/* Logo, teléfonos y leyenda del gimnasio: los administra GymFlow (D-27, bloque 4.6). */}
          <LogoDeRecibo />
          <p className="recibo-org">{org.tradeName}</p>
          <p>{branchName(p.branchId)}</p>
          <p>{fechaHora(p.receivedAt)}</p>
          {p.folio && <p className="recibo-folio">Folio {p.folio}</p>}
        </header>
        {p.reversesPaymentId && <p className="recibo-aviso">CONTRA-ASIENTO de un pago anterior</p>}
        {r.member && <p className="recibo-socio">{r.member.fullName}<br /><span>{r.member.memberCode}</span></p>}
        <table>
          <tbody>
            {r.lines.map((l, i) => <tr key={i}><td>{concepto(l.concept)}</td><td>{pesos(l.amountCents)}</td></tr>)}
            {aFavor > 0n && <tr><td>Saldo a favor</td><td>{pesos(aFavor)}</td></tr>}
            <tr className="total"><td>Total pagado</td><td>{pesos(p.amountCents)}</td></tr>
          </tbody>
        </table>
        <p>{etiqueta(METODO_DE_PAGO, p.method, p.method)}{p.externalRef ? ` · ref. ${p.externalRef}` : ''}</p>
        {/* Quién cobró (3-05; bloque 2.2): el socio lo lee en su comprobante, no solo el personal en el estado de cuenta. */}
        {r.collectedByName && <p>Le atendió {r.collectedByName}</p>}
        {r.coverage?.paidThrough && <p>{r.coverage.planName ?? 'Membresía'} pagada hasta el <strong>{fecha(r.coverage.paidThrough)}</strong></p>}
        {/* El aviso del cambio de precio de su plan (D-19, bloque 3.6): antes de su siguiente pago y en el primero al precio nuevo. */}
        {r.priceNotice && (
          <p className="recibo-aviso" data-testid="recibo-aviso-precio">
            {r.priceNotice.kind === 'UPCOMING'
              ? <>{r.priceNotice.startsOn ? `A partir del ${fecha(r.priceNotice.startsOn)}` : 'A partir de tu siguiente pago'}, {r.priceNotice.planName ?? 'tu plan'} cuesta <strong>{pesos(r.priceNotice.toPriceCents)}</strong> (antes {pesos(r.priceNotice.fromPriceCents)}).</>
              : <>{r.priceNotice.planName ?? 'Tu plan'} cambió de precio: de {pesos(r.priceNotice.fromPriceCents)} a <strong>{pesos(r.priceNotice.toPriceCents)}</strong> desde este pago.</>}
          </p>
        )}
        <PieDeRecibo />
        <footer>
          Comprobante de pago. No es un comprobante fiscal (CFDI); si necesitas factura, pídela en recepción.
        </footer>
      </article>
    </div>
  );
}
