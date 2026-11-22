'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AccessException, AccessPending, AccessPendingItem } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { hora } from '@/lib/format';
import { zonaDe } from '@/lib/zonas';
import { DENIAL_REASON } from '@/lib/labels';
import { EstadoCarga, useCarga } from '@/lib/carga';
import { useSession } from '@/components/session';
import { Avatar, Badge, Card, Dialog, Skeleton } from '@/components/ui';
import { ResolverRechazo } from '@/components/cobro/resolver-rechazo';

const POR_ADEUDO = new Set(['MEMBERSHIP_PAST_DUE', 'MEMBERSHIP_SUSPENDED']);
/** Cada cuánto se vuelve a preguntar mientras la pestaña se ve: la estación deja rechazos sin que nadie toque esta pantalla. */
const REVISAR_CADA_MS = 20_000;

/**
 * «POR RESOLVER EN LA PUERTA» (auditoría 8, bloque 2.1; 5-05, 5-12).
 *
 * La estación (o un compañero en el mostrador) rechazó a alguien y esa persona
 * está parada en la entrada. Hasta hoy el rechazo solo se veía en el monitor
 * de Accesos, que nace apagado. Aquí están los de HOY que siguen sin resolver,
 * en las sedes de quien mira, y cada uno se resuelve en su sitio con la misma
 * pieza que el mostrador (`ResolverRechazo`): cobrar y abrir, renovar y abrir,
 * dejar pasar con motivo o «no pasa». Un rechazo se resuelve una vez.
 *
 * Sin pendientes, la tarjeta no existe.
 */
export function PorResolverEnLaPuerta({ onResuelto }: { onResuelto?: () => void }) {
  const { branches, branchName, inScope, org } = useSession();
  // La hora de cada rechazo, en la zona de SU sucursal (un gimnasio puede tener sedes en otra zona).
  const horaEn = (iso: string, branchId: string) => hora(iso, zonaDe(branches.find((b) => b.id === branchId), org));
  const variasSedes = branches.filter((b) => b.isActive && inScope(b.id)).length > 1;
  const carga = useCarga(useCallback(() => api<AccessPending>('/access/pending?limit=12'), []), { conservar: true });
  const { recargar } = carga;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void recargar(); }, REVISAR_CADA_MS);
    return () => clearInterval(t);
  }, [recargar]);
  const [abierto, setAbierto] = useState<AccessPendingItem | null>(null);
  const cerrar = () => { setAbierto(null); void recargar(); onResuelto?.(); };

  const pendientes = carga.datos?.pending ?? [];
  // Si no se pudo preguntar, no se inventa una tarjeta: el renglón de «Hoy te toca» dirá que la lista puede estar incompleta.
  if (pendientes.length === 0) return null;
  const total = carga.datos?.total ?? pendientes.length;

  return (
    <Card pad={false} data-testid="por-resolver-puerta"
      title="Por resolver en la puerta"
      sub={total > pendientes.length ? `Los ${pendientes.length} más recientes de ${total} rechazos de hoy sin resolver.` : 'Rechazos de hoy que nadie ha resuelto.'}>
      <ul className="list">
        {pendientes.map((p) => (
          <li key={p.decisionId}>
            <button type="button" className="list-item is-link puerta-fila" data-rechazo={p.decisionId} onClick={() => setAbierto(p)}>
              <Avatar name={p.memberName} size={36} />
              <span className="flex-1 min-w-0">
                <span className="strong ellipsis block">{p.memberName}</span>
                <span className="tiny muted block">
                  {DENIAL_REASON[p.reason ?? ''] ?? 'No pudo pasar'} · {horaEn(p.at, p.branchId)}{variasSedes ? ` · ${branchName(p.branchId)}` : ''}
                </span>
              </span>
              {p.attempts > 1 && <Badge tone="danger">{p.attempts} intentos</Badge>}
              <ChevronRight size={16} className="faint" />
            </button>
          </li>
        ))}
      </ul>
      {abierto && <ResolverPendiente pendiente={abierto} onCerrar={cerrar} />}
    </Card>
  );
}

/** El rechazo elegido, con todo lo que hace falta para resolverlo en una petición (`…/exception`). */
function ResolverPendiente({ pendiente, onCerrar }: { pendiente: AccessPendingItem; onCerrar: () => void }) {
  const carga = useCarga(useCallback(() => api<AccessException>(`/access/decisions/${pendiente.decisionId}/exception`), [pendiente.decisionId]));
  return (
    <Dialog open onClose={onCerrar} title={`En la puerta · ${pendiente.memberName}`}>
      <EstadoCarga carga={carga} titulo="No se pudo abrir este rechazo" esqueleto={<div className="stack"><Skeleton h={72} r={12} /><Skeleton h={44} /></div>}>
        {(v) => (v.resolution ? (
          <div className="entrada-veredicto" data-estado="neutro" data-testid="excepcion-resuelta">
            <div>
              <p className="entrada-titulo">Este rechazo ya se resolvió</p>
              <p className="small muted">{v.resolution.byName ? `Lo resolvió ${v.resolution.byName} a las ${hora(v.resolution.at)}.` : `Se resolvió a las ${hora(v.resolution.at)}.`} No se registra otra entrada.</p>
            </div>
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
            onNoPasa={onCerrar} onListo={onCerrar} />
        ))}
      </EstadoCarga>
    </Dialog>
  );
}
