'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { HeartHandshake, MessageCircle, Phone, PhoneCall } from 'lucide-react';
import { CAUSA_DE_BAJA, frasesDePlazos } from '@gymflow/core/plazos';
import { ESTADO_DE_HABITO } from '@gymflow/core/vocabulario';
import type { FollowUpLatest, WinbackList, WinbackMember } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, telefono } from '@/lib/format';
import { useCarga } from '@/lib/carga';
import { useSession } from '@/components/session';
import { ContactoDialog, UltimoContacto, type Contacto } from '@/components/seguimiento';
import { Badge, Button, Card, Empty, ErrorCarga, EsqueletoLista } from '@/components/ui';

/** Cuántas personas se traen; si hay más, la tarjeta dice cuántas faltan. */
const TOPE = 100;
type Ultimo = { last: Contacto; count: number };

/** Lo que dice la fila de cada quien: por qué está aquí y desde cuándo. */
function porQue(m: WinbackMember): string {
  if (m.cause === 'LOST') return m.lastVisitOn ? `Sigue con su membresía y no viene desde el ${fecha(m.lastVisitOn)}` : 'Sigue con su membresía y nunca ha venido';
  if (m.cause === 'CANCELED') return `${CAUSA_DE_BAJA.CANCELED} el ${fecha(m.since)}${m.reason ? ` · ${m.reason}` : ''}`;
  if (m.cause === 'EXPIRED') return `${CAUSA_DE_BAJA.EXPIRED} · baja desde el ${fecha(m.since)}`;
  return `${CAUSA_DE_BAJA.ARCHIVED} el ${fecha(m.since)}`;
}

/**
 * «RECUPERAR» (fase 4, bloque 4.4 · D-18, 15-10): a quien se perdió o se dio
 * de baja se le sigue buscando los meses del gimnasio (de fábrica 6). Cada
 * persona sale con su ficha de siempre: no se copia a Interesados. Los más
 * recientes primero.
 */
export function Recuperar({ sede, sedes, onTotal }: { sede: string; sedes: number; onTotal?: (n: number) => void }) {
  const { can, branchName } = useSession();
  const anota = can('retention:followup:write');
  const carga = useCarga(useCallback(() => api<WinbackList>(`/retention/winback?limit=${TOPE}${sede ? `&branchId=${sede}` : ''}`)
    .then((r) => { onTotal?.(r.total); return r; }), [sede, onTotal]));
  const r = carga.datos ?? null;
  const ids = r?.members.map((m) => m.memberId).join(',') ?? '';
  const seguimiento = useCarga(useCallback(() => (ids
    ? api<FollowUpLatest>(`/members/follow-ups/latest?ids=${ids}`)
      .then((x) => new Map<string, Ultimo>(x.latest.map((l) => [l.memberId, { last: l.last, count: l.count }])))
    : Promise.resolve(new Map<string, Ultimo>())), [ids]), { conservar: true });
  const contactos = seguimiento.datos ?? new Map<string, Ultimo>();
  const [llamando, setLlamando] = useState<WinbackMember | null>(null);

  if (carga.error && !r) return <ErrorCarga titulo="No se pudo cargar a quién recuperar" mensaje={carga.error} onReintentar={() => void carga.recargar()} />;
  const frases = r ? frasesDePlazos(r.terms) : null;
  const bajas = r ? r.counts.ARCHIVED + r.counts.CANCELED + r.counts.EXPIRED : 0;

  return (
    <>
      <Card pad={false} title="Recuperar"
        sub={r ? `${frases!.winbackMonths} ${r.total === 0 ? '' : `Hoy: ${r.counts.LOST} ${r.counts.LOST === 1 ? 'perdido' : 'perdidos'} y ${bajas} de baja.`}${r.total > r.members.length ? ` Se muestran los ${r.members.length} más recientes de ${r.total}.` : ''}` : undefined}>
        {r === null ? <EsqueletoLista filas={4} /> : r.members.length === 0 ? (
          <Empty icon={<HeartHandshake />} title="Nadie por recuperar" text="Aquí aparece quien se da por perdido o se da de baja, mientras se le sigue buscando." />
        ) : (
          <ul className="list" data-testid="por-recuperar">
            {r.members.map((m) => {
              const c = contactos.get(m.memberId);
              return (
                <li key={m.memberId} className="list-item se-apila" data-causa={m.cause}>
                  <div className="fila-titulo flex-1 min-w-0">
                    <Link href={`/socios/${m.memberId}`} className="strong small">{m.fullName}</Link> <code className="tiny muted">{m.memberCode}</code>
                    <div className="tiny muted">
                      {porQue(m)}{m.planName ? ` · ${m.planName}` : ''}{sedes > 1 && m.homeBranchId ? ` · ${branchName(m.homeBranchId)}` : ''}
                    </div>
                    <div className="tiny muted">Se le busca hasta el {fecha(m.until)}.{m.archived ? ' Para volver hay que reactivarlo desde su ficha.' : ''}</div>
                    <UltimoContacto c={c?.last} total={c?.count} />
                  </div>
                  <Badge tone={m.cause === 'LOST' ? 'danger' : undefined}>{m.cause === 'LOST' ? ESTADO_DE_HABITO.LOST?.label ?? 'Perdido' : 'Baja'}</Badge>
                  {m.phoneE164 && <>
                    <a className="btn btn-ghost btn-icon btn-sm" href={`tel:${m.phoneE164}`} title={telefono(m.phoneE164)} aria-label="Llamar"><Phone /></a>
                    <a className="btn btn-ghost btn-icon btn-sm" href={`https://wa.me/${m.phoneE164.replace('+', '')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle /></a>
                  </>}
                  {anota && <Button size="sm" variant="secondary" icon={<PhoneCall />} onClick={() => setLlamando(m)}>Le llamé</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {llamando && (
        <ContactoDialog para="socio" nombre={llamando.fullName.split(' ')[0]!} url={`/members/${llamando.memberId}/follow-ups`}
          onClose={() => setLlamando(null)} onListo={() => { setLlamando(null); void seguimiento.recargar(); }} />
      )}
    </>
  );
}
