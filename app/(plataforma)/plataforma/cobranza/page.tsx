'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Banknote, FilePlus, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { fecha, pesos } from '@/lib/format';
import { Badge, Breadcrumb, Button, Callout, Card, Empty, ErrorCarga, PageHeader, Segmented, Stat, EsqueletoTabla } from '@/components/ui';
import { Exportar } from '@/components/exportar';
import type { PlatformCollectionsBoard } from '@gymflow/core/contracts';
import { ESTADO_FACTURA, FORMA_DE_PAGO, Emitir, MandarAviso, Pagar, claseDeAviso, dias, fraseDeCobranza, periodo, type Factura } from '../cobro';

type FacturaMarca = Factura & { tradeName: string };
type Resumen = {
  /** El mes en curso en la Ciudad de México: el que se propone emitir (23-14). */
  month: string;
  monthlyIncome: { totalCents: string; organizations: number; missingPrices: Array<{ organizationId: string; tradeName: string; modules: string[] }> };
  /** Marcas en uso sin factura viva del mes: lo cuenta el servidor. */
  withoutInvoiceThisMonth: number;
  invoices: FacturaMarca[];
};
type Vista = 'pendientes' | 'vencidas' | 'pagadas' | 'todas';

/**
 * COBRANZA DE LA PLATAFORMA (DP-03): todas las facturas de todas las marcas
 * en una pantalla, el mes se emite de una vez —viendo antes lo que va a
 * salir— y la cifra que importa —cuánto entra al mes— está arriba. El mes,
 * «sin factura» y el estado de cada factura vienen del servidor.
 */
export default function CobranzaPage() {
  const [vista, setVista] = useState<Vista>('pendientes');
  const [emitir, setEmitir] = useState(false);
  const [pagar, setPagar] = useState<FacturaMarca | null>(null);
  const pedir = useCallback(() => api<Resumen>('/platform/billing'), []);
  const carga = useCarga(pedir, { conservar: true });
  const r = carga.datos;
  // La escalera de cobranza (D-37, bloque 3.11): quién se suspende y cuándo, y los avisos que no le han llegado a su dueño.
  const pedirEscalera = useCallback(() => api<PlatformCollectionsBoard>('/platform/collections'), []);
  const escalera = useCarga(pedirEscalera, { conservar: true });
  const cargar = () => { void carga.recargar(); void escalera.recargar(); };
  const esc = escalera.datos;

  const todas = r?.invoices ?? [];
  const pendientes = todas.filter((f) => f.status === 'PENDING');
  const vencidas = pendientes.filter((f) => f.state === 'VENCIDA');
  const filas = vista === 'pendientes' ? pendientes : vista === 'vencidas' ? vencidas : vista === 'pagadas' ? todas.filter((f) => f.status === 'PAID') : todas;
  const sinMes = r?.withoutInvoiceThisMonth ?? 0;
  const mes = r?.month ?? '';

  return (
    <>
      <Breadcrumb items={[{ href: '/plataforma', label: 'Marcas' }, { label: 'Cobranza' }]} />
      <PageHeader title="Cobranza" sub="Lo que GymFlow cobra a las marcas. Una factura por marca y mes; el día 1 se emiten solas y aquí se registra cuándo llegó el dinero. Al dueño se le avisa al emitir y al vencer; a los 15 días de atraso avisado, el servicio se suspende solo."
        actions={<>
          <Exportar nombre={`cobranza-${vista}-${mes}`} disabled={filas.length === 0}
            filas={() => [['Folio', 'Marca', 'Periodo', 'Importe', 'Pagado', 'Resta', 'Estado', 'Emitida', 'Vence', 'Último pago', 'Forma de pago', 'Referencia'],
              ...filas.map((f) => [f.folio, f.tradeName, periodo(f), enPesos(f.totalCents), enPesos(f.paidCents), enPesos(f.balanceCents), ESTADO_FACTURA[f.state].label,
                f.issuedOn, f.dueDate, f.paidOn ?? '', f.paymentMethod ? FORMA_DE_PAGO[f.paymentMethod] ?? f.paymentMethod : '', f.paymentRef ?? ''])]} />
          {/* Encendido (principal) solo si hay marcas sin la factura del mes (2.12). Con todas emitidas queda como secundario:
              sigue abriendo el diálogo, que explica que no hay nada que emitir y deja elegir otro mes. */}
          <Button icon={<FilePlus />} variant={r && sinMes === 0 ? 'secondary' : 'primary'} onClick={() => setEmitir(true)} disabled={!r}
            title={r && sinMes === 0 ? 'Todas las marcas en uso ya tienen la factura de este mes' : undefined}>Emitir {r ? periodo(mes).toLowerCase() : 'el mes'}</Button>
        </>} />

      {carga.error && <ErrorCarga mensaje={carga.error} onReintentar={cargar} />}
      {!r && !carga.error && <div className="card"><EsqueletoTabla columnas={6} /></div>}
      {r && (
        <>
          <div className="grid grid-3 mb-20">
            <Stat label="Ingreso mensual" value={pesos(r.monthlyIncome.totalCents, { decimals: false })}
              note={`${r.monthlyIncome.organizations} ${r.monthlyIncome.organizations === 1 ? 'marca en uso' : 'marcas en uso'}${r.monthlyIncome.missingPrices.length ? ` · ${r.monthlyIncome.missingPrices.length} sin precio completo` : ''}`} />
            <Stat label="Por cobrar" value={pesos(pendientes.reduce((a, f) => a + BigInt(f.balanceCents), 0n), { decimals: false })} danger={vencidas.length > 0}
              note={vencidas.length ? `${vencidas.length} ${vencidas.length === 1 ? 'vencida' : 'vencidas'}` : `${pendientes.length} ${pendientes.length === 1 ? 'factura pendiente' : 'facturas pendientes'}`} />
            <Stat label={`Sin factura de ${periodo(mes).split(' ')[0]!.toLowerCase()}`} value={sinMes} note={sinMes > 0 ? 'Marcas en uso sin emitir este mes' : 'Todas las marcas en uso ya tienen la del mes'} />
          </div>
          {r.monthlyIncome.missingPrices.length > 0 && (
            <Callout tone="warn" title="Hay marcas que no se pueden facturar">
              {r.monthlyIncome.missingPrices.map((m) => <div key={m.organizationId}><Link href={`/plataforma/${m.organizationId}`} className="strong">{m.tradeName}</Link>: falta el precio de {m.modules.join(', ')}. Fíjalo en <Link href="/plataforma/precios">Precios</Link>.</div>)}
            </Callout>
          )}
          {esc && esc.atRisk.length > 0 && (
            <div className="mb-20">
              <Card title="Se suspenden solas si no pagan" sub={`A los ${esc.suspendsAfterDays} días de atraso desde que al dueño le llegó el aviso. Suspender no borra nada: al registrar el pago se reanuda en el mismo paso.`} pad={false} data-testid="por-suspender">
                <div className="table-wrap">
                  <table className="table table-stack">
                    <thead><tr><th>Marca</th><th>Factura</th><th className="right">Debe</th><th>Qué va a pasar</th></tr></thead>
                    <tbody>
                      {esc.atRisk.map((x) => (
                        <tr key={x.organizationId} data-marca={x.tradeName} data-cobranza={x.state}>
                          <td data-label="Marca"><Link className="row-link strong" href={`/plataforma/${x.organizationId}`}>{x.tradeName}</Link></td>
                          <td data-label="Factura">{x.invoiceId ? <Link className="row-link mono" href={`/plataforma/factura/${x.invoiceId}`}>{x.folio}</Link> : '—'}<div className="tiny muted">{dias(x.overdueDays)} vencida</div></td>
                          <td data-label="Debe" className="right num">{x.balanceCents ? pesos(x.balanceCents) : '—'}</td>
                          <td data-label="Qué va a pasar" className="small">{fraseDeCobranza(x)?.texto}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
          {esc && esc.toSend.length > 0 && (
            <div className="mb-20">
              <Card title={`Avisos por mandar (${esc.toSend.length})`} sub="Avisos al dueño sin constancia de entrega: no tiene notificaciones en su teléfono y no los ha visto en su panel. Mándaselos: sin constancia de que el de «factura vencida» le llegó, el sistema no suspende." pad={false} data-testid="avisos-por-mandar">
                <div className="table-wrap">
                  <table className="table table-stack">
                    <thead><tr><th>Marca</th><th>Aviso</th><th>Del</th><th /></tr></thead>
                    <tbody>
                      {esc.toSend.map((a) => (
                        <tr key={a.id} data-aviso={a.kind}>
                          <td data-label="Marca"><Link className="row-link strong" href={`/plataforma/${a.organizationId}`}>{a.tradeName}</Link><div className="tiny muted">{a.owners.map((o) => o.fullName).join(', ') || 'Sin dueño activo'}</div></td>
                          <td data-label="Aviso"><span className="small strong">{claseDeAviso(a)}</span><div className="tiny muted">{a.body}</div></td>
                          <td data-label="Del" className="small">{fecha(a.noticeOn)}</td>
                          <td className="right"><MandarAviso aviso={a} duenos={a.owners} onHecho={cargar} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
          <Segmented value={vista} onChange={setVista} options={[
            { value: 'pendientes', label: `Pendientes (${pendientes.length})` }, { value: 'vencidas', label: `Vencidas (${vencidas.length})` },
            { value: 'pagadas', label: 'Pagadas' }, { value: 'todas', label: 'Todas' },
          ]} />
          <div className="mt-12">
          <Card pad={false}>
            {filas.length === 0 ? <Empty icon={<Receipt />} title="Nada por aquí" text={vista === 'pendientes' ? 'No hay facturas pendientes de pago.' : 'No hay facturas en esta vista.'} /> : (
              <div className="table-wrap">
                <table className="table table-stack">
                  <thead><tr><th>Folio</th><th>Marca</th><th>Periodo</th><th className="right">Importe</th><th>Estado</th><th>Vence</th><th /></tr></thead>
                  <tbody>
                    {filas.map((f) => {
                      const e = ESTADO_FACTURA[f.state];
                      return (
                        <tr key={f.id} data-folio={f.folio}>
                          <td><Link className="row-link mono" href={`/plataforma/factura/${f.id}`}>{f.folio}</Link></td>
                          <td><Link className="row-link" href={`/plataforma/${f.organizationId}`}>{f.tradeName}</Link></td>
                          <td className="small">{periodo(f)}</td>
                          <td className="right num strong" data-label="Importe">{pesos(f.totalCents)}{f.status === 'PENDING' && f.paidCents !== '0' && <div className="tiny muted">resta {pesos(f.balanceCents)}</div>}</td>
                          <td data-label="Estado">
                            <Badge tone={e.tone} dot={f.state !== 'ANULADA'}>
                              {e.label}{f.state === 'VENCIDA' ? ` · ${dias(f.overdueDays)}` : f.state === 'PAGADA' && f.paidOn ? ` · ${fecha(f.paidOn)}` : ''}
                            </Badge>
                          </td>
                          <td className="small" data-label="Vence">{fecha(f.dueDate)}</td>
                          <td className="right">{f.status === 'PENDING' && <Button size="sm" variant="ghost" icon={<Banknote />} onClick={() => setPagar(f)}>Registrar pago</Button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          </div>
        </>
      )}

      {emitir && r && <Emitir mesActual={r.month} onClose={() => setEmitir(false)} onHecho={() => { setEmitir(false); cargar(); }} />}
      {pagar && <Pagar factura={pagar} onClose={() => setPagar(null)} onHecho={() => { setPagar(null); cargar(); }} />}
    </>
  );
}

/** Centavos a pesos con dos decimales, sin signo ni comas: para el CSV. */
function enPesos(cents: string): string {
  const c = BigInt(cents);
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}
