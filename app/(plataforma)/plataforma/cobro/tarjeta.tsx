'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Banknote, FilePlus, Receipt, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { fecha, pesos } from '@/lib/format';
import { Badge, Button, ButtonLink, Callout, Card, Empty, Skeleton, ErrorCarga } from '@/components/ui';
import { Anular } from './anular';
import { Emitir } from './emitir';
import { Pagar } from './pagar';
import { ESTADO_COBRO, ESTADO_FACTURA, FORMA_DE_PAGO, dias, fraseDeCobro, periodo, type CobroDeMarca, type Factura, type Linea } from './textos';

type Resumen = {
  /** El mes en curso en la Ciudad de México. */
  month: string;
  invoices: Factura[];
  monthly: { lines: Linea[]; totalCents: string; missingPrices: string[] };
  status: CobroDeMarca;
  /** Los meses que a esta marca se le pueden facturar, del más reciente al de su liberación. */
  billableMonths: Array<{ month: string; invoiced: boolean }>;
  /** Solo a una marca en uso se le emite. */
  canIssue: boolean;
};

/**
 * COBRO DE UNA MARCA (ADR-038). La mensualidad de hoy sale de los precios y
 * de lo contratado; cada factura congela sus líneas al emitirse. Pagar,
 * deshacer un pago y anular dejan rastro en la bitácora de la marca. El
 * estado de la marca y el de cada factura los dice el servidor (23-02).
 */
export function Cobro({ organizationId, tradeName }: { organizationId: string; tradeName: string }) {
  const [emitir, setEmitir] = useState(false);
  const [pagar, setPagar] = useState<Factura | null>(null);
  const [anular, setAnular] = useState<Factura | null>(null);
  const pedir = useCallback(() => api<Resumen>(`/platform/organizations/${organizationId}/billing`), [organizationId]);
  const carga = useCarga(pedir, { conservar: true });
  const r = carga.datos;
  const cargar = () => void carga.recargar();

  if (carga.error) return <Card title="Cobro"><ErrorCarga mensaje={carga.error} onReintentar={cargar} /></Card>;
  if (!r) return <Card title="Cobro"><Skeleton h={120} /></Card>;
  const est = ESTADO_COBRO[r.status.code];
  const sinPrecios = r.monthly.missingPrices.length > 0;
  const porQueNo = sinPrecios ? 'Faltan precios para facturar' : !r.canIssue ? 'No está en uso: no se le factura' : null;
  return (
    <>
      <Card title="Cobro" data-testid="cobro"
        sub="Lo que la marca paga a GymFlow cada mes por lo básico y sus módulos contratados. La factura es un comprobante interno; el CFDI se emite por fuera."
        actions={<span className="row gap-6"><ButtonLink href="/plataforma/precios" variant="ghost" size="sm">Precios</ButtonLink>{porQueNo && <span className="tiny muted">{porQueNo}</span>}<Button size="sm" icon={<FilePlus />} disabled={!!porQueNo} onClick={() => setEmitir(true)}>Generar factura</Button></span>}>
        <div className="stack">
          <div className="row-between flex-wrap gap-12">
            <p className="row gap-8">
              <Badge tone={est.tone} dot>{est.label}</Badge>
              <span className="small muted" data-testid="cobro-estado">{fraseDeCobro(r.status, pesos)}</span>
            </p>
            <p className="small"><span className="muted">Mensualidad de hoy: </span><span className="strong num" data-testid="mensualidad">{pesos(r.monthly.totalCents)}</span></p>
          </div>
          {sinPrecios && <Callout tone="warn">Sin precio: {r.monthly.missingPrices.join(', ')}. <Link href="/plataforma/precios">Fíjalo en Precios</Link> para poder facturar.</Callout>}
          {r.monthly.lines.length > 0 && <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mensualidad de hoy</th><th className="right">Al mes</th></tr></thead>
              <tbody>{r.monthly.lines.map((l) => <tr key={l.key}><td className="small">{l.name}</td><td className="right num small">{pesos(l.monthlyCents)}</td></tr>)}</tbody>
            </table>
          </div>}
          {r.invoices.length === 0
            ? <Empty icon={<Receipt />} title="Sin facturas" text={sinPrecios ? 'Primero fija los precios.' : r.canIssue ? 'Genera la del mes en curso.' : 'Se le factura desde que se libera el software.'} />
            : (
              <div className="table-wrap">
                <table className="table table-stack" data-testid="facturas">
                  <thead><tr><th>Folio</th><th>Mes</th><th className="right">Total</th><th>Vence</th><th>Estado</th><th /></tr></thead>
                  <tbody>
                    {r.invoices.map((f) => {
                      const e = ESTADO_FACTURA[f.state];
                      return (
                        <tr key={f.id} data-folio={f.folio}>
                          <td data-label="Folio"><Link href={`/plataforma/factura/${f.id}`} className="strong mono no-underline">{f.folio}</Link></td>
                          <td data-label="Mes">{periodo(f)}</td>
                          <td data-label="Total" className="right num">{pesos(f.totalCents)}</td>
                          <td data-label="Vence" className="small">{fecha(f.dueDate)}</td>
                          <td data-label="Estado">
                            <Badge tone={e.tone} dot>{e.label}{f.state === 'VENCIDA' ? ` · ${dias(f.overdueDays)}` : ''}</Badge>
                            {f.status === 'PAID' && f.paidOn && <div className="tiny muted">{fecha(f.paidOn)}{f.paymentMethod ? ` · ${FORMA_DE_PAGO[f.paymentMethod] ?? f.paymentMethod}` : ''}</div>}
                            {f.status === 'PENDING' && f.paidCents !== '0' && <div className="tiny muted">Resta {pesos(f.balanceCents)} de {pesos(f.totalCents)}</div>}
                          </td>
                          <td className="right">
                            {f.status === 'PENDING' && (
                              <span className="row gap-4 justify-end">
                                <Button size="sm" variant="ghost" icon={<Banknote />} onClick={() => setPagar(f)}>Registrar pago</Button>
                                {/* Con abonos no se anula: primero se deshacen, en el comprobante. */}
                                {f.paidCents === '0' && <Button size="sm" variant="ghost" icon={<Ban />} onClick={() => setAnular(f)}>Anular</Button>}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Card>

      {emitir && <Emitir mesActual={r.month} marca={{ id: organizationId, tradeName, totalCents: r.monthly.totalCents, meses: r.billableMonths }} onClose={() => setEmitir(false)} onHecho={() => { setEmitir(false); cargar(); }} />}
      {pagar && <Pagar factura={pagar} onClose={() => setPagar(null)} onHecho={() => { setPagar(null); cargar(); }} />}
      {anular && <Anular factura={anular} onClose={() => setAnular(null)} onHecho={() => { setAnular(null); cargar(); }} />}
    </>
  );
}
