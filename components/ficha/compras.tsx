'use client';

import { useCallback, useEffect, useState } from 'react';
import { Printer, ShoppingBag } from 'lucide-react';
import type { MemberPosSales, MemberPosSale } from '@gymflow/core/contracts';
import { METODO_DE_PAGO, etiqueta } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { fecha, fechaHora, pesos } from '@gymflow/ui/format';
import { useSession, errorText } from '@/components/session';
import { Badge, Button, Card, Empty, ErrorCarga, EsqueletoLista, IconTile } from '@/components/ui';

/** Lo que se llevó, en una línea: «2× Agua 600 ml · 1× Barra de proteína». */
export const queCompro = (v: Pick<MemberPosSale, 'lines'>): string =>
  v.lines.map((l) => `${l.quantity}× ${l.name ?? 'Producto que ya no está en el catálogo'}`).join(' · ');

/**
 * COMPRAS EN LA TIENDA (auditoría 8, bloque 2.2; 8-01). El punto de venta liga
 * la venta al socio y decía «queda en su ficha»: aquí es donde queda. Qué se
 * llevó, cuánto, cómo pagó, quién le cobró y su ticket; una venta anulada se
 * ve como anulada, con su motivo. Es dinero: la ve quien ve el estado de
 * cuenta.
 */
export function ComprasSocio({ memberId }: { memberId: string }) {
  const { can, branches, branchName } = useSession();
  const [d, setD] = useState<MemberPosSales | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async (cursor?: string) => {
    setFallo(null); setCargando(true);
    try {
      const r = await api<MemberPosSales>(`/members/${memberId}/pos-sales?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setD((prev) => (cursor && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
    } catch (e) { setFallo(errorText(e, 'No se pudieron cargar sus compras')); } finally { setCargando(false); }
  }, [memberId]);
  useEffect(() => { setD(null); void cargar(); }, [cargar]);

  if (fallo && !d) return <ErrorCarga titulo="No se pudieron cargar sus compras de la tienda" mensaje={fallo} onReintentar={() => void cargar()} />;
  return (
    <Card pad={false} title="Compras en la tienda" data-testid="compras-socio"
      sub={d && d.total > 0 ? `${d.items.length < d.total ? `Se muestran ${d.items.length} de ${d.total}` : `${d.total} ${d.total === 1 ? 'compra' : 'compras'}`} · ha gastado ${pesos(d.spentCents)}` : undefined}
      footer={d?.nextCursor ? <Button size="sm" variant="secondary" loading={cargando} onClick={() => void cargar(d.nextCursor!)}>Cargar compras anteriores</Button> : undefined}>
      {!d ? <EsqueletoLista filas={3} />
        : d.items.length === 0 ? <Empty icon={<ShoppingBag />} title="Sin compras en la tienda" text="Lo que se le venda desde «Venderle producto» o eligiéndolo en el punto de venta aparecerá aquí." />
          : (
            <ul className="list">
              {d.items.map((v) => {
                const anulada = v.status === 'VOIDED';
                return (
                  <li key={v.id} className="list-item items-start mov" data-testid="compra" data-estado={v.status}>
                    <IconTile size="sm" tone={anulada ? 'neutral' : 'ok'}><ShoppingBag /></IconTile>
                    <div className="flex-1 min-w-0">
                      <div className="small strong mov-titulo">{queCompro(v)}{anulada && <> <Badge>Anulada</Badge></>}
                        {/* D-13 (bloque 3.5): sigue por corregir, o ya se devolvió otro día. */}
                        {v.flagged && <> <Badge tone="warn">Por corregir</Badge></>}{v.returnedOn && <> <Badge tone="info">Devuelta el {fecha(v.returnedOn)}</Badge></>}</div>
                      <div className="tiny muted">
                        {fechaHora(v.soldAt)}{v.method ? ` · ${etiqueta(METODO_DE_PAGO, v.method, v.method)}` : ''}{v.folio ? ` · ${v.folio}` : ''}
                        {v.soldByName ? ` · Cobró ${v.soldByName}` : ''}{branches.length > 1 ? ` · ${branchName(v.branchId)}` : ''}
                      </div>
                      {anulada && v.voidReason && <div className="tiny muted">Motivo de la anulación: {v.voidReason}</div>}
                    </div>
                    <div className={`mov-importe num strong${anulada ? ' muted' : ''}`}>{pesos(v.totalCents)}</div>
                    <div className="mov-acciones">
                      {/* El ticket lo abre quien vende en la tienda (la API lo pide así). */}
                      {can('pos:sale:create') && <a className="btn btn-ghost btn-icon btn-sm" href={`/recibo/venta/${v.id}`} target="_blank" rel="noreferrer" title="Ticket" aria-label="Ticket"><Printer /></a>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
    </Card>
  );
}
