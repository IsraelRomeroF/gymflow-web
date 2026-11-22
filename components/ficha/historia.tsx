'use client';

import { useCallback, useEffect, useState } from 'react';
import { CreditCard, DoorOpen, FileSignature, History, MessageCircle, UserCheck, UserRound, Wallet } from 'lucide-react';
import type { HistoryKind, MemberHistory, MemberHistoryItem } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, fechaCorta, hora } from '@/lib/format';
import { zonaDe } from '@/lib/zonas';
import { useSession, errorText } from '@/components/session';
import { Badge, Button, Card, Empty, ErrorCarga, EsqueletoLista, IconTile, Segmented, type Tono } from '@/components/ui';

/**
 * HISTORIA DEL SOCIO (auditoría 8, bloque 2.2; 3-11): lo que pasó con él, en
 * una línea de tiempo. Dinero, membresía, puerta, contacto, firmas y datos,
 * lo más reciente primero. Responde lo que antes pedía abrir tres pantallas:
 * «¿ya le hablaron?», «¿quién le cobró?», «¿cuándo vino por última vez?».
 *
 * La arma el servidor (`GET /members/:id/history`) con la bitácora y con lo
 * que la bitácora no guarda (entradas del día, la nota de cada contacto, los
 * avisos de su portal). Cada quien recibe las partes que ya ve en otras
 * pantallas, y solo esos filtros se ofrecen. No sustituye a la pestaña
 * «Bitácora», que es el registro completo para quien revisa.
 */

type Vista = 'TODO' | HistoryKind;
const PARTE: Record<HistoryKind, { label: string; icono: React.ReactNode; tono: Tono }> = {
  DINERO: { label: 'Dinero', icono: <Wallet />, tono: 'ok' },
  MEMBRESIA: { label: 'Membresía', icono: <CreditCard />, tono: 'info' },
  PUERTA: { label: 'Puerta', icono: <DoorOpen />, tono: 'neutral' },
  CONTACTO: { label: 'Contacto', icono: <MessageCircle />, tono: 'volt' },
  FIRMAS: { label: 'Firmas y privacidad', icono: <FileSignature />, tono: 'neutral' },
  DATOS: { label: 'Datos y servicios', icono: <UserRound />, tono: 'neutral' },
};

/** Las fechas que el servidor manda como día de calendario dentro de un texto se leen como en el resto de la ficha. */
const conFechas = (texto: string) => texto.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => fecha(d));

export function HistoriaSocio({ memberId, version = 0 }: {
  memberId: string;
  /** Sube cuando algo cambió en la ficha (un cobro, un contacto): la historia se vuelve a pedir. */
  version?: number;
}) {
  const { branches, branchName, org } = useSession();
  const [vista, setVista] = useState<Vista>('TODO');
  const [items, setItems] = useState<MemberHistoryItem[] | null>(null);
  const [partes, setPartes] = useState<HistoryKind[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async (mas?: string) => {
    setFallo(null); setCargando(true);
    try {
      const q = new URLSearchParams({ limit: '40', ...(vista !== 'TODO' ? { kind: vista } : {}), ...(mas ? { cursor: mas } : {}) });
      const r = await api<MemberHistory>(`/members/${memberId}/history?${q.toString()}`);
      setItems((prev) => (mas && prev ? [...prev, ...r.items] : r.items));
      setPartes(r.kinds);
      setCursor(r.nextCursor);
    } catch (e) { setFallo(errorText(e, 'No se pudo cargar su historia')); } finally { setCargando(false); }
  }, [memberId, vista]);
  useEffect(() => { setItems(null); void cargar(); }, [cargar, version]);

  const vistas: Array<{ value: Vista; label: string }> = [{ value: 'TODO', label: 'Todo' }, ...(partes ?? []).map((k) => ({ value: k as Vista, label: PARTE[k].label }))];

  return (
    <div className="stack" data-testid="historia-socio">
      {partes && partes.length > 1 && <Segmented value={vista} onChange={setVista} options={vistas} etiqueta="Qué parte de su historia" />}
      {fallo ? <ErrorCarga mensaje={fallo} onReintentar={() => void cargar()} /> : items === null ? <Card pad={false}><EsqueletoLista filas={6} /></Card> : (
        <Card pad={false} title="Historia" sub="Lo que ha pasado con este socio, lo más reciente primero: quién lo hizo, cuándo y por qué.">
          {items.length === 0 ? (
            <Empty icon={<History />} title={vista === 'TODO' ? 'Todavía no hay historia' : 'Nada de este tipo'}
              text={vista === 'TODO' ? 'Cada cobro, entrada, llamada o firma de este socio aparecerá aquí.' : cursor ? 'En lo más reciente no hay nada de este tipo. Sigue hacia atrás con «Ver lo anterior».' : 'Prueba con «Todo».'} />
          ) : (
            <ul className="list">
              {items.map((e) => {
                const p = PARTE[e.kind];
                const zona = zonaDe(e.branchId ? branches.find((b) => b.id === e.branchId) : null, org);
                // De sus entradas se dice el hecho, no quién: «Entró con su rostro».
                const conActor = e.source !== 'VISIT';
                return (
                  <li key={e.id} className="list-item items-start" data-testid="historia-renglon" data-parte={e.kind} data-origen={e.source}>
                    <IconTile size="sm" tone={e.source === 'VISIT' && e.phrase === 'No pasó' ? 'danger' : p.tono}>{p.icono}</IconTile>
                    <span className="tiny muted num nowrap asiento-hora">{fechaCorta(e.at, zona)}<br />{hora(e.at, zona)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="small">{conActor && <><strong>{e.actorName}</strong>{' '}</>}{conActor ? e.phrase : <strong>{e.phrase}</strong>}</div>
                      {e.detail && <div className="tiny historia-detalle">{conFechas(e.detail)}</div>}
                      {e.reason && <div className="tiny muted">Motivo: {e.reason}</div>}
                      <div className="row wrap tiny gap-6 mt-4">
                        {e.approverName && <Badge tone="info"><UserCheck size={12} /> Autorizó {e.approverName}</Badge>}
                        {e.branchId && branches.length > 1 && <span className="muted">{branchName(e.branchId)}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
      {cursor && !fallo && items !== null && <div><Button variant="secondary" loading={cargando} onClick={() => void cargar(cursor)}>Ver lo anterior</Button></div>}
    </div>
  );
}
