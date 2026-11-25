'use client';

import { Receipt } from 'lucide-react';
import type { GymflowAccount } from '@gymflow/core/contracts';
import { capital, fecha, nombreMes, pesos } from '@/lib/format';
import { useAvisosVistos, useCuentaConGymflow } from '@/components/cuenta-gymflow';
import { Badge, Callout, Card, Empty, EsqueletoPagina, PageHeader } from '@/components/ui';

type Factura = GymflowAccount['invoices'][number];
const ESTADO: Record<Factura['state'], { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  PENDIENTE: { label: 'Por pagar', tone: 'warn' }, PAGADA_EN_PARTE: { label: 'Abonada', tone: 'warn' }, VENCIDA: { label: 'Vencida', tone: 'danger' },
  PAGADA: { label: 'Pagada', tone: 'ok' }, ANULADA: { label: 'Anulada', tone: 'neutral' },
};
const mes = (dia: string): string => capital(nombreMes(dia));
/** `1600` → «16 %». */
const tasa = (bps: number): string => `${(bps / 100).toString()} %`;
const etiquetaDeIva = (d: { taxRateBps: number; taxIncluded: boolean }): string => (d.taxIncluded ? `IVA (${tasa(d.taxRateBps)}), incluido en los precios` : `IVA (${tasa(d.taxRateBps)})`);

/**
 * CUENTA CON GYMFLOW (D-37, bloque 3.11; 23-11). Lo que el gimnasio le paga a
 * GymFlow, para su dueño y solo para consultar: la mensualidad, lo que debe,
 * cuándo vence, si el servicio se va a suspender, y los avisos. Desde aquí no
 * se paga ni se cambia nada: el pago lo registra GymFlow cuando llega.
 *
 * Desde D-39 (bloque 4.9): la mensualidad con su renglón de descuento (y hasta
 * cuándo dura), el subtotal, el IVA y el total cuando hay IVA; cada factura
 * con sus renglones; y a nombre de quién salen y cómo se pagan. La factura es
 * un estado de cuenta, no un CFDI.
 */
export default function CuentaConGymflowPage() {
  const { cuenta } = useCuentaConGymflow();
  useAvisosVistos(cuenta);
  if (!cuenta) return <EsqueletoPagina cifras={2} />;
  if (!cuenta.visible) {
    return <Empty icon={<Receipt />} title="Esta pantalla es para la Dueña o el Dueño" text="Aquí se consulta lo que el gimnasio le paga a GymFlow." />;
  }
  const vencida = cuenta.status.code === 'VENCIDA';
  const conIva = cuenta.monthly.taxRateBps > 0 && cuenta.monthly.taxCents !== '0';
  const { receiver, issuer } = cuenta.fiscal;
  return (
    <>
      <PageHeader title="Cuenta con GymFlow" sub="Lo que tu gimnasio le paga a GymFlow por el sistema. Solo consulta: el pago lo registra GymFlow cuando llega, y aquí lo ves reflejado." />
      <div className="stack">
        {cuenta.serviceStatus === 'SUSPENDED' && <Callout tone="danger" title="El servicio está suspendido">Nadie del gimnasio puede entrar al sistema. No se borró nada: en cuanto GymFlow registre el pago, se reanuda.</Callout>}
        {vencida && (
          <Callout tone="danger" title={`Debes ${pesos(cuenta.status.pendingCents)} · ${cuenta.status.overdueDays} ${cuenta.status.overdueDays === 1 ? 'día' : 'días'} de atraso`}>
            {cuenta.suspendsOn
              ? <>Si el pago no se registra, <strong>el servicio se suspende el {fecha(cuenta.suspendsOn)}</strong>: nadie del gimnasio podrá entrar hasta que se pague. Tus datos se conservan completos.</>
              : <>Si no se paga, el servicio se suspende a los {cuenta.suspendsAfterDays} días de atraso. Tus datos se conservan completos.</>}
          </Callout>
        )}
        {cuenta.notices.length > 0 && (
          <Card title="Avisos de GymFlow" data-testid="avisos-de-gymflow">
            <ul className="stack">
              {cuenta.notices.map((n) => (
                <li key={n.id} data-aviso={n.kind}><p className="strong small">{n.title}</p><p className="small">{n.body}</p><p className="tiny muted">{fecha(n.noticeOn)}</p></li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Tu mensualidad" sub={cuenta.upcoming ? `Desde la factura de ${mes(cuenta.upcoming.effectiveFrom).toLowerCase()} será de ${pesos(cuenta.upcoming.totalCents)} al mes; hasta entonces pagas lo de hoy.` : undefined} pad={false} data-testid="mensualidad-gymflow">
          {/* Bloque 4.16: sin precios no se pinta una tabla vacía con «Total $0.00». */}
          {cuenta.monthly.lines.length === 0 ? <Empty icon={<Receipt />} title="GymFlow todavía no te ha dado precio" text="Cuando GymFlow fije tu mensualidad, aquí verás cada concepto y el total al mes." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Concepto</th><th className="right">Al mes</th></tr></thead>
              <tbody>
                {cuenta.monthly.lines.map((l) => <tr key={l.key} data-clase={l.kind ?? 'CHARGE'}><td className="small">{l.name}</td><td className="right num small">{pesos(l.monthlyCents)}</td></tr>)}
                {/* Con IVA, el desglose va antes del total; sin IVA, el total a secas, como siempre. */}
                {conIva && <tr data-desglose="subtotal"><td className="small">{cuenta.monthly.taxIncluded ? 'Antes de IVA' : 'Antes de IVA (suma de lo anterior)'}</td><td className="right num small">{pesos(cuenta.monthly.subtotalCents)}</td></tr>}
                {conIva && <tr data-desglose="iva"><td className="small">{etiquetaDeIva(cuenta.monthly)}</td><td className="right num small">{pesos(cuenta.monthly.taxCents)}</td></tr>}
                <tr data-testid="mensualidad-total"><td className="strong">Total</td><td className="right num strong">{pesos(cuenta.monthly.totalCents)}</td></tr>
              </tbody>
            </table>
          </div>
          )}
          {cuenta.monthly.discount && <p className="small muted card-foot" data-testid="descuento-vigente">Tienes un descuento hasta la factura de {mes(cuenta.monthly.discount.lastMonth).toLowerCase()}. Después pagas la mensualidad sin ese renglón.</p>}
        </Card>
        <Card title="Facturas" pad={false} data-testid="facturas-gymflow">
          {cuenta.invoices.length === 0 ? <Empty icon={<Receipt />} title="Sin facturas todavía" text="La primera se emite al empezar el mes siguiente a la liberación del sistema." /> : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead><tr><th>Folio</th><th>Mes</th><th className="right">Total</th><th className="right">Debe</th><th>Vence</th><th>Estado</th></tr></thead>
                <tbody>
                  {cuenta.invoices.map((f) => (
                    <tr key={f.id} data-folio={f.folio}>
                      <td data-label="Folio" className="mono strong">{f.folio}</td>
                      <td data-label="Mes">{mes(f.periodStart)}</td>
                      <td data-label="Total" className="right num">{pesos(f.totalCents)}
                        {f.taxCents !== '0' && <div className="tiny muted">{f.taxIncluded ? 'incluye' : 'con'} IVA {pesos(f.taxCents)}</div>}
                        {f.lines.filter((l) => l.kind === 'DISCOUNT' || l.kind === 'PRORATED' || l.kind === 'CATCH_UP').map((l) => <div key={l.key} className="tiny muted" data-renglon={l.kind}>{l.name}: {pesos(l.monthlyCents)}</div>)}</td>
                      <td data-label="Debe" className="right num">{f.balanceCents === '0' ? '—' : pesos(f.balanceCents)}</td>
                      <td data-label="Vence" className="small">{fecha(f.dueDate)}</td>
                      <td data-label="Estado"><Badge tone={ESTADO[f.state].tone} dot>{ESTADO[f.state].label}{f.state === 'VENCIDA' ? ` · ${f.overdueDays} ${f.overdueDays === 1 ? 'día' : 'días'}` : ''}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Datos de facturación" sub="A nombre de quién salen tus facturas de GymFlow y cómo se pagan." data-testid="datos-fiscales-gymflow">
          <div className="grid grid-2">
            <div>
              <p className="label">Tu gimnasio</p>
              <p className="strong">{receiver.legalName}</p>
              <p className="small">{receiver.rfc ? <span className="mono">RFC {receiver.rfc}</span> : <span className="muted">Sin RFC registrado</span>}</p>
              <p className="tiny muted">Si la razón social o el RFC están mal, pide el cambio a GymFlow desde «Mi gimnasio».</p>
            </div>
            <div>
              <p className="label">Cobra</p>
              <p className="strong">{issuer?.legalName ?? 'GymFlow'}</p>
              {issuer?.rfc && <p className="small mono">RFC {issuer.rfc}</p>}
              {issuer?.payment ? <p className="small" data-testid="como-pagar">{issuer.payment}</p> : <p className="small muted">Para pagar, habla con quien te atiende en GymFlow.</p>}
              {issuer?.contact && <p className="tiny muted">{issuer.contact}</p>}
            </div>
          </div>
        </Card>
        <Callout tone="info">La factura de GymFlow es un estado de cuenta: no es un CFDI ni se timbra. Para aclarar un cargo o pedir tu comprobante fiscal, habla con quien te atiende en GymFlow.</Callout>
      </div>
    </>
  );
}
