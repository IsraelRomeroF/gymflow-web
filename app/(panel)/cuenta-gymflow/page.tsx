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

/**
 * CUENTA CON GYMFLOW (D-37, bloque 3.11; 23-11). Lo que el gimnasio le paga a
 * GymFlow, para su dueño y solo para consultar: la mensualidad, lo que debe,
 * cuándo vence, si el servicio se va a suspender, y los avisos. Desde aquí no
 * se paga ni se cambia nada: el pago lo registra GymFlow cuando llega.
 */
export default function CuentaConGymflowPage() {
  const { cuenta } = useCuentaConGymflow();
  useAvisosVistos(cuenta);
  if (!cuenta) return <EsqueletoPagina cifras={2} />;
  if (!cuenta.visible) {
    return <Empty icon={<Receipt />} title="Esta pantalla es para la Dueña o el Dueño" text="Aquí se consulta lo que el gimnasio le paga a GymFlow." />;
  }
  const vencida = cuenta.status.code === 'VENCIDA';
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
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Concepto</th><th className="right">Al mes</th></tr></thead>
              <tbody>
                {cuenta.monthly.lines.map((l) => <tr key={l.key}><td className="small">{l.name}</td><td className="right num small">{pesos(l.monthlyCents)}</td></tr>)}
                <tr><td className="strong">Total</td><td className="right num strong">{pesos(cuenta.monthly.totalCents)}</td></tr>
              </tbody>
            </table>
          </div>
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
                      <td data-label="Total" className="right num">{pesos(f.totalCents)}</td>
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
        <Callout tone="info">La factura de GymFlow es un comprobante interno de cobro, no un CFDI. Para pagar o aclarar un cargo, habla con quien te atiende en GymFlow.</Callout>
      </div>
    </>
  );
}
