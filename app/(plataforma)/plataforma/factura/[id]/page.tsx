'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { Ban, Banknote, Printer, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { fecha, pesos, ultimoDia } from '@/lib/format';
import { Badge, Breadcrumb, Button, Callout, Card, ErrorCarga, PageHeader, Skeleton, NoExiste, esNoExiste } from '@/components/ui';
import { Anular, DeshacerPago, ESTADO_FACTURA, FORMA_DE_PAGO, FilaDeLinea, FilasDeDesglose, Pagar, dias, periodo, type FacturaConPagos, type Pago } from '../../cobro';

type Detalle = FacturaConPagos & { organization: { tradeName: string; legalName: string } | null };

/**
 * UNA FACTURA DE LA PLATAFORMA (ADR-038): el estado de cuenta del cobro
 * mensual a una marca. Guarda sus renglones tal como se cobraron (con el del
 * descuento y lo que fue por días), su subtotal, su IVA y los datos fiscales
 * del gimnasio y de GymFlow del día en que se emitió (D-39, bloque 4.9):
 * cambiar precios, IVA o datos después no la altera. NO es un CFDI ni se
 * timbra. Aquí se ven sus pagos, uno por uno, y se registra, se deshace o se
 * anula (23-07, 23-08).
 */
export default function FacturaPage() {
  const { id } = useParams<{ id: string }>();
  const [noExiste, setNoExiste] = useState(false);
  const [pagar, setPagar] = useState(false);
  const [anular, setAnular] = useState(false);
  const [deshacer, setDeshacer] = useState<Pago | null>(null);
  const pedir = useCallback(() => api<Detalle>(`/platform/invoices/${id}`).catch((e: unknown) => {
    if (esNoExiste(e)) setNoExiste(true);
    throw e;
  }), [id]);
  const carga = useCarga(pedir, { conservar: true });
  const f = carga.datos;
  const cargar = () => void carga.recargar();

  if (noExiste) return <NoExiste titulo="Esta factura no existe" texto="Revisa el folio desde la ficha de la marca." volverA="/plataforma" volverTexto="Ir a Marcas" />;
  if (carga.error) return <ErrorCarga mensaje={carga.error} onReintentar={cargar} />;
  if (!f) return <div className="stack"><Skeleton h={36} w={320} /><Skeleton h={320} r={16} /></div>;
  const est = ESTADO_FACTURA[f.state];
  const pendiente = f.status === 'PENDING';
  const abonada = pendiente && f.paidCents !== '0';
  return (
    <>
      <Breadcrumb items={[{ label: 'Marcas', href: '/plataforma' }, ...(f.organization ? [{ label: f.organization.tradeName, href: `/plataforma/${f.organizationId}` }] : []), { label: f.folio }]} />
      <PageHeader title={`Factura ${f.folio}`} sub={`${periodo(f)} · emitida el ${fecha(f.issuedOn)}`}
        actions={<>
          <Badge tone={est.tone} dot>{est.label}{f.state === 'VENCIDA' ? ` · ${dias(f.overdueDays)}` : ''}</Badge>
          {pendiente && <Button icon={<Banknote />} onClick={() => setPagar(true)}>Registrar pago</Button>}
          {pendiente && !abonada && <Button variant="secondary" icon={<Ban />} onClick={() => setAnular(true)}>Anular</Button>}
          <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>Imprimir</Button>
        </>} />
      <div className="stack factura-hoja">
        <Card data-testid="factura" className="factura-doc">
          {/* Encabezado de documento: lo que se ve al imprimir o al mandarlo (UX5-PL-08). */}
          <div className="factura-encabezado">
            <div>
              <p className="factura-marca">GymFlow</p>
              <p className="small muted">Estado de cuenta · {periodo(f)}</p>
            </div>
            <div className="text-right">
              <p className="mono strong">{f.folio}</p>
              <p className="small muted">Emitida el {fecha(f.issuedOn)}</p>
              <p className="factura-total num">{pesos(f.totalCents)}</p>
            </div>
          </div>
          <div className="grid grid-2 mb-16">
            <div data-testid="factura-emisor">
              <p className="label">Cobra</p>
              <p className="strong">{f.issuer?.legalName ?? 'GymFlow · Plataforma'}</p>
              {f.issuer?.rfc && <p className="small mono">RFC {f.issuer.rfc}</p>}
              {f.issuer?.address && <p className="small muted">{f.issuer.address}</p>}
              {f.issuer?.contact && <p className="small muted">{f.issuer.contact}</p>}
            </div>
            <div data-testid="factura-receptor">
              <p className="label">A</p>
              <p className="strong">{f.receiver?.legalName ?? f.organization?.legalName ?? 'Marca'}</p>
              <p className="small mono">{f.receiver?.rfc ? `RFC ${f.receiver.rfc}` : <span className="muted">Sin RFC en su ficha</span>}</p>
              <p className="small muted">{f.receiver?.tradeName ?? f.organization?.tradeName}</p>
            </div>
            <div>
              <p className="label">Periodo</p>
              <p>{fecha(f.periodStart)} – {fecha(ultimoDia(f.periodEnd))}</p>
            </div>
            <div>
              <p className="label">Vence</p>
              <p>{fecha(f.dueDate)}</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Concepto</th><th className="right">Importe</th></tr></thead>
              <tbody>
                {f.lines.map((l) => <FilaDeLinea key={l.key} l={l} />)}
              </tbody>
              <tfoot>
                <FilasDeDesglose d={f} total="Total a pagar" testidTotal="factura-total" />
                {abonada && <tr><td>Pagado</td><td className="right num">{pesos(f.paidCents)}</td></tr>}
                {abonada && <tr><th>Resta</th><th className="right num" data-testid="factura-resta">{pesos(f.balanceCents)}</th></tr>}
              </tfoot>
            </table>
          </div>
          {f.note && <p className="small muted mt-12">Nota: {f.note}</p>}
          {!f.itemized && <p className="small muted mt-12">Emitida antes de que las facturas desglosaran el IVA: es un total, sin IVA aparte. Se queda como se emitió.</p>}
          {f.issuer?.payment && f.status === 'PENDING' && <p className="small mt-12" data-testid="como-pagar"><span className="label">Cómo pagar</span><br />{f.issuer.payment}</p>}
          {/* La fecha sin hora: nadie la captura (23-15). */}
          {f.state === 'PAGADA' && f.paidOn && (
            <Callout tone="ok">Pagada el {fecha(f.paidOn)}{f.paymentMethod ? ` · ${FORMA_DE_PAGO[f.paymentMethod] ?? f.paymentMethod}` : ''}{f.paymentRef ? ` · ref. ${f.paymentRef}` : ''}.</Callout>
          )}
          {abonada && <Callout tone="warn">Pagada en parte: {pesos(f.paidCents)} de {pesos(f.totalCents)}. Resta {pesos(f.balanceCents)}{f.state === 'VENCIDA' ? `, con ${dias(f.overdueDays)} de atraso` : ''}.</Callout>}
          {f.state === 'ANULADA' && <Callout tone="warn">Anulada{f.voidReason ? `: ${f.voidReason}` : ''}. No se cobra.</Callout>}
        </Card>

        {f.payments.length > 0 && (
          <Card title="Pagos" sub="Cada pago o abono registrado. Uno registrado por error se deshace con motivo hasta 7 días después; no se borra." pad={false} data-testid="pagos">
            <ul className="list">
              {f.payments.map((p) => (
                <li key={p.id} className={`list-item${p.undone ? ' pago-deshecho' : ''}`} data-pago={p.id}>
                  <div className="flex-1">
                    <p className="small"><span className="strong num">{pesos(p.amountCents)}</span> <span className="pago-dato">· {FORMA_DE_PAGO[p.paymentMethod] ?? p.paymentMethod} · {fecha(p.paidOn)}{p.paymentRef ? ` · ref. ${p.paymentRef}` : ''}</span></p>
                    {p.note && <p className="tiny muted">{p.note}</p>}
                    {p.undone && <p className="tiny muted">Deshecho{p.undoneAt ? ` el ${fecha(p.undoneAt)}` : ''}: {p.undoReason}</p>}
                  </div>
                  {p.undone ? <Badge>Deshecho</Badge>
                    : p.canUndo ? <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => setDeshacer(p)}>Deshacer</Button>
                      : <span className="tiny muted">Ya no se deshace desde aquí</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="tiny muted">Estado de cuenta de GymFlow. No es un CFDI, no se timbra y no sustituye al comprobante fiscal.</p>
      </div>

      {pagar && <Pagar factura={f} onClose={() => setPagar(false)} onHecho={() => { setPagar(false); cargar(); }} />}
      {anular && <Anular factura={f} onClose={() => setAnular(false)} onHecho={() => { setAnular(false); cargar(); }} />}
      {deshacer && <DeshacerPago factura={f} pago={deshacer} onClose={() => setDeshacer(null)} onHecho={() => { setDeshacer(null); cargar(); }} />}
    </>
  );
}
