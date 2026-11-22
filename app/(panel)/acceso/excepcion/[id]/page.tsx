'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { X, CircleCheck, CalendarDays } from 'lucide-react';
import type { AccessException } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { antiguedad, fechaCorta, hora } from '@/lib/format';
import { DENIAL_REASON } from '@/lib/labels';
import { EstadoCarga, useCarga } from '@/lib/carga';
import { Avatar, Breadcrumb, Button, Card, Skeleton } from '@/components/ui';
import { ResolverRechazo } from '@/components/cobro/resolver-rechazo';

/**
 * Pantalla de excepción.
 *
 * El criterio del sprint es resolver el rechazo en **veinte segundos**, con un
 * socio delante y una cola detrás. De ahí tres decisiones de diseño:
 *
 *  · **Todo cabe sin desplazar**: nombre, motivo, adeudo, antigüedad y las
 *    acciones.
 *  · **Una sola petición** trae toda la información.
 *  · **Las mismas salidas que el mostrador** (fase 1.4, 5-11): cobrar y abrir
 *    con método, caja y el neto de su saldo a favor; renovar y abrir; dejar
 *    pasar con motivo. Antes esta pantalla cobraba todo en efectivo y sin
 *    caja: el dinero no entraba a ningún corte.
 */

/** Lo que responde `GET /access/decisions/:id/exception` (con sus opciones): contrato del núcleo (5-21). */
type Vista = AccessException;

const POR_ADEUDO = new Set(['MEMBERSHIP_PAST_DUE', 'MEMBERSHIP_SUSPENDED']);

export default function ExcepcionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const cargar = useCallback(() => api<Vista>(`/access/decisions/${id}/exception`), [id]);
  const carga = useCarga(cargar);
  const volver = () => router.push('/acceso');

  return (
    <div className="excepcion">
      <div className="page-eyebrow"><Breadcrumb items={[{ label: 'Accesos', href: '/acceso' }, { label: 'Excepción' }]} /></div>
      <EstadoCarga carga={carga} titulo="No se pudo abrir este rechazo" esqueleto={<div className="stack"><Skeleton h={80} r={16} /><Skeleton h={120} r={16} /><Skeleton h={160} r={16} /></div>}>
        {(v) => (
          <Card pad={false}>
            <div className="card-body stack">
              {/* Identidad primero y grande: recepción tiene que reconocerlo de un vistazo. */}
              <div className="profile">
                <Avatar name={v.member.fullName} size={64} />
                <div>
                  <h1 className="profile-name">{v.member.fullName}</h1>
                  <p className="small muted"><code>{v.member.memberCode}</code> · socio desde hace {antiguedad(v.member.joinedAt)}</p>
                </div>
              </div>

              <div className="row wrap small gap-8">
                <span className="muted row gap-6"><CalendarDays size={14} />Últimas visitas</span>
                {v.recentVisits.length === 0 && <span className="muted">ninguna registrada</span>}
                {v.recentVisits.slice(0, 4).map((x) => <span key={x.at} className="badge">{fechaCorta(x.at)}</span>)}
              </div>

              {v.resolution ? (
                // Un rechazo se resuelve una vez (5-10): aquí ya no hay nada que cobrar ni que abrir.
                <div className="stack" data-testid="excepcion-resuelta">
                  <div className="callout callout-danger"><X /><span>{DENIAL_REASON[v.decision.reason ?? ''] ?? v.decision.reason}</span></div>
                  <div className="entrada-veredicto" data-estado="neutro">
                    <CircleCheck />
                    <div>
                      <p className="entrada-titulo">Este rechazo ya se resolvió</p>
                      <p className="small muted">{v.resolution.byName ? `Lo resolvió ${v.resolution.byName} a las ${hora(v.resolution.at)}.` : `Se resolvió a las ${hora(v.resolution.at)}.`} No se registra otra entrada.</p>
                    </div>
                  </div>
                  <div className="resolver-pie"><Button onClick={volver}>Volver a accesos</Button></div>
                </div>
              ) : (
                <ResolverRechazo
                  rechazo={{
                    decisionId: v.decision.id, memberId: v.member.id, memberName: v.member.fullName.split(' ')[0] ?? v.member.fullName,
                    branchId: v.decision.branchId, reason: v.decision.reason,
                    overridable: v.options.some((o) => o.action === 'GRANT_ONCE'),
                    // Como en el mostrador: se cobra en la puerta solo cuando el rechazo ES por adeudo.
                    outstandingCents: POR_ADEUDO.has(v.decision.reason ?? '') && BigInt(v.outstandingCents) > 0n ? v.outstandingCents : null,
                    minimumCents: v.minimumCents, periodsOwed: v.periodsOwed, creditCents: v.creditCents,
                  }}
                  onNoPasa={volver} onListo={volver} />
              )}
            </div>
          </Card>
        )}
      </EstadoCarga>
    </div>
  );
}
