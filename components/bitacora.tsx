'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { History, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaCorta, hora } from '@/lib/format';
import { zonaDe } from '@/lib/zonas';
import { useSession, errorText } from './session';
import { Badge, Button, Card, Empty, ErrorCarga, EsqueletoLista, Segmented } from './ui';

/**
 * UN ASIENTO DE LA BITÁCORA como lo manda `GET /audit` (auditoría 8, 1.11).
 * La frase (`phrase`) llega completa del servidor, armada en el núcleo con el
 * socio, la persona y el importe: aquí no hay diccionario de acciones (20-10).
 */
export type Evento = {
  id: string; at: string; action: string; resourceType: string; resourceId: string | null;
  actorUserId: string | null; actorType: string; branchId: string | null; reason: string | null;
  approvedByUserId: string | null; beforeState: Record<string, unknown> | null; afterState: Record<string, unknown> | null;
  actorName: string | null; approverName: string | null;
  member: { name: string; memberId: string; memberCode: string | null } | null; personName: string | null;
  phrase: string;
  /** La frase sin nombres ni importe, para juntar asientos iguales. */
  label: string;
  amountCents: string | null; category: string | null;
  /** «Para revisar»: el dinero que sale, el poder que cambia y las excepciones (20-06). */
  sensitive: boolean;
  /** Por qué, cuando depende del asiento («El corte tuvo diferencia»). */
  reviewReason: string | null;
};
export type PaginaDeBitacora = { entries: Evento[]; nextCursor: string | null };

/** Quién lo hizo, dicho como se lee. Lo de la plataforma ya dice «GymFlow …» en la frase. */
export function quien(e: Evento): string | null {
  if (e.action.startsWith('platform.')) return null;
  return e.actorName ?? (e.actorType === 'SYSTEM' || e.actorType === 'JOB' ? 'El sistema' : e.actorType === 'MEMBER' ? 'El socio' : 'Alguien');
}

/** La frase con el nombre del socio como enlace a su ficha (salvo que ya estemos en ella). */
export function Frase({ e, sinEnlace }: { e: Evento; sinEnlace?: boolean }) {
  const nombre = e.member?.name;
  const i = nombre && !sinEnlace ? e.phrase.indexOf(nombre) : -1;
  if (!e.member || sinEnlace) return <>{e.phrase}</>;
  const enlace = <Link className="row-link" href={`/socios/${e.member.memberId}`}>{e.member.name}</Link>;
  // Si la frase no nombra al socio (un asiento sin hueco para él), va al final.
  if (i < 0) return <>{e.phrase} · {enlace}</>;
  return <>{e.phrase.slice(0, i)}{enlace}{e.phrase.slice(i + nombre!.length)}</>;
}

/**
 * Un renglón de bitácora: hora (en la zona de SU sucursal), quién, qué, a
 * quién y cuánto; el motivo, quién autorizó, la sucursal y si es para revisar.
 */
export function Asiento({ e, conFecha, sinEnlace }: { e: Evento; conFecha?: boolean; sinEnlace?: boolean }) {
  const { branches, branchName, org } = useSession();
  const zona = zonaDe(e.branchId ? branches.find((b) => b.id === e.branchId) : null, org);
  const actor = quien(e);
  return (
    <li className="list-item items-start" data-testid="asiento" data-accion={e.action} data-revisar={e.sensitive ? 'si' : 'no'}>
      <span className="tiny muted num nowrap asiento-hora">{conFecha && <>{fechaCorta(e.at, zona)}<br /></>}{hora(e.at, zona)}</span>
      <div className="flex-1 min-w-0">
        <div className="small">{actor && <><strong>{actor}</strong>{' '}</>}<Frase e={e} sinEnlace={sinEnlace} /></div>
        {e.reason && <div className="tiny muted">Motivo: {e.reason}</div>}
        <div className="row wrap tiny gap-6 mt-4">
          {e.approverName && <Badge tone="info"><UserCheck size={12} /> Autorizó {e.approverName}</Badge>}
          {e.branchId && <span className="muted">{branchName(e.branchId)}</span>}
          {e.sensitive && e.reviewReason && <span className="muted">{e.reviewReason}</span>}
        </div>
      </div>
      {e.sensitive && <Badge tone="warn" dot>Revisar</Badge>}
    </li>
  );
}

type Vista = 'todo' | 'sensibles' | 'dinero' | 'acceso';
const VISTAS: ReadonlyArray<{ value: Vista; label: string }> = [
  { value: 'todo', label: 'Todo' }, { value: 'sensibles', label: 'Para revisar' }, { value: 'dinero', label: 'Dinero' }, { value: 'acceso', label: 'Acceso' },
];

/**
 * TODO LO DE ESTE SOCIO (ficha → Bitácora; auditoría 8, 1.11): lo asentado
 * sobre él y sobre lo suyo (pagos, cargos, membresías, consentimientos,
 * biometría, portal, entradas por excepción), lo más reciente primero. Lo ve
 * quien tiene Bitácora, y solo lo de sus sucursales.
 */
export function BitacoraSocio({ memberId }: { memberId: string }) {
  const [vista, setVista] = useState<Vista>('todo');
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async (mas?: string) => {
    setFallo(null); setCargando(true);
    try {
      const q = new URLSearchParams({ memberId, limit: '50', ...(vista !== 'todo' ? { category: vista } : {}), ...(mas ? { cursor: mas } : {}) });
      const r = await api<PaginaDeBitacora>(`/audit?${q.toString()}`);
      setEventos((prev) => (mas && prev ? [...prev, ...r.entries] : r.entries));
      setCursor(r.nextCursor);
    } catch (e) { setFallo(errorText(e, 'No se pudo cargar la bitácora de este socio')); } finally { setCargando(false); }
  }, [memberId, vista]);
  useEffect(() => { setEventos(null); void cargar(); }, [cargar]);

  return (
    <div className="stack" data-testid="bitacora-socio">
      <Segmented value={vista} onChange={setVista} options={VISTAS} etiqueta="Qué ver" />
      {fallo ? <ErrorCarga mensaje={fallo} onReintentar={() => void cargar()} /> : eventos === null ? <Card pad={false}><EsqueletoLista filas={6} /></Card> : (
        <Card pad={false} title="Todo lo de este socio" sub="Quién hizo qué, cuándo, por qué y con qué autorización. Lo más reciente primero; nada de esto se puede borrar ni editar.">
          {eventos.length === 0 ? (
            <Empty icon={<History />} title={vista === 'todo' ? 'Todavía no hay nada asentado' : 'Nada de este tipo'}
              text={vista === 'sensibles' ? 'Sin reembolsos, condonaciones, correcciones ni otras operaciones para revisar de este socio.' : vista === 'todo' ? 'Cada cobro, cambio de datos, firma o excepción de este socio aparecerá aquí.' : 'Prueba con «Todo».'} />
          ) : (
            <ul className="list">{eventos.map((e) => <Asiento key={e.id} e={e} conFecha sinEnlace />)}</ul>
          )}
        </Card>
      )}
      {cursor && !fallo && <div><Button variant="secondary" loading={cargando} onClick={() => void cargar(cursor)}>Ver más</Button></div>}
    </div>
  );
}
