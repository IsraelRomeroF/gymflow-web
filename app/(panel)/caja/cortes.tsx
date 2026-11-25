'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { History, Wallet } from 'lucide-react';
import type { CashAlerts } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, hora, pesos } from '@gymflow/ui/format';
import { TURNO, type Caja, type Turno } from '@/lib/caja';
import { errorText, useSession } from '@/components/session';
import { Badge, Button, Callout, Card, Empty, ErrorCarga, EsqueletoTabla, PageHeader, Segmented, Skeleton } from '@/components/ui';
import { Diferencia, EstadoRevision, quienResponde, RevisarDialog, TOLERANCIA } from '@/components/caja';
import { useCarga } from '@gymflow/ui/carga';

type Filtro = 'todos' | 'diferencia' | 'revisar';
const FILTROS: ReadonlyArray<{ value: Filtro; label: string }> = [
  { value: 'todos', label: 'Todos' }, { value: 'diferencia', label: 'Con diferencia' }, { value: 'revisar', label: 'Por revisar' },
];
const CONSULTA: Record<Filtro, string> = { todos: '', diferencia: '&variance=ANY', revisar: '&variance=PENDING' };
/** Cortes por página (bloque 4.11); los siguientes, con «Cargar más cortes». */
const POR_PAGINA = 50;
const desde = (a: CashAlerts['open'][number]) => (a.stale ? `desde el ${fecha(a.businessDate)}` : `desde las ${hora(a.openedAt)}`);

/**
 * AVISOS DE LA CAJA (D-17, bloque 4.3): cajas que amanecieron sin cortar y
 * cortes con más de $20 de diferencia sin revisar. Los ve quien ve los cortes.
 */
export function AvisosDeCaja({ avisos, puedeRevisar }: { avisos: CashAlerts; puedeRevisar: boolean }) {
  const viejas = avisos.open.filter((a) => a.stale);
  const p = avisos.pendingVariances;
  if (viejas.length === 0 && p.count === 0) return null;
  return (
    <div className="stack-sm" data-testid="avisos-de-caja">
      {viejas.length > 0 && (
        <Callout tone="warn" title={viejas.length === 1 ? 'Una caja amaneció sin cortar' : `${viejas.length} cajas amanecieron sin cortar`}>
          {viejas.map((a) => `${a.registerName} (${a.branchName}), que abrió ${a.openedByName ?? 'alguien'} el ${fecha(a.businessDate)}`).join('; ')}.
          {' '}El corte lo hace quien la abrió o la gerencia; mientras siga abierta, su efectivo no está contado.
        </Callout>
      )}
      {p.count > 0 && (
        <Callout tone="warn" title={p.count === 1 ? 'Un corte con diferencia está por revisar' : `${p.count} cortes con diferencia están por revisar`}>
          {BigInt(p.shortageCents) > 0n ? `Faltan ${pesos(p.shortageCents)}` : 'No falta dinero'}{BigInt(p.overageCents) > 0n ? ` y sobran ${pesos(p.overageCents)}` : ''}
          {p.oldestBusinessDate ? `; el más antiguo es del ${fecha(p.oldestBusinessDate)}` : ''}.
          {' '}{puedeRevisar ? 'Revisa cada uno y ciérralo con tu nota.' : 'Los revisa la gerencia y los cierra con su nota.'}
        </Callout>
      )}
    </div>
  );
}

/**
 * «CORTES» (7-13; D-17, bloque 4.3): lo que ve de la caja quien solo consulta
 * (la dueña). Las cajas abiertas ahora, los avisos y los cortes de todas sus
 * sucursales, con de quién fue cada turno y en qué va la revisión de su
 * diferencia. Ningún botón de operación: aquí no se abre, no se corta y no se retira.
 */
export function VistaCortes() {
  const { branches, inScope, can, me } = useSession();
  const router = useRouter();
  const sedes = branches.filter((b) => inScope(b.id));
  const deTodas = me.branchScopes.includes(null) || sedes.length === 1;
  const [sede, setSede] = useState(deTodas ? '' : sedes[0]?.id ?? '');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [persona, setPersona] = useState('');
  const [revisar, setRevisar] = useState<Turno | null>(null);
  const puedeRevisar = can('cash:variance:approve');

  const deSede = sede ? `&branchId=${sede}` : '';
  const avisos = useCarga(useCallback(() => api<CashAlerts>(`/cash/alerts${sede ? `?branchId=${sede}` : ''}`), [sede]), { conservar: true });
  const cajas = useCarga(useCallback(() => api<{ registers: Caja[] }>(`/cash-registers${sede ? `?branchId=${sede}` : ''}`), [sede]), { conservar: true });
  // Por páginas (bloque 4.11): antes se cortaba en los últimos 200 sin decirlo.
  const consulta = `/cash-sessions?status=CLOSED&limit=${POR_PAGINA}${deSede}${CONSULTA[filtro]}`;
  const cortes = useCarga(useCallback(() => api<{ sessions: Turno[]; nextCursor: string | null }>(consulta), [consulta]), { conservar: true });
  // Lo que se fue pidiendo con «Cargar más». Si la lista se vuelve a pedir (otro filtro, otra sede, una revisión), se empieza de nuevo.
  const [mas, setMas] = useState<{ items: Turno[]; cursor: string | null } | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [errorMas, setErrorMas] = useState<string | null>(null);
  useEffect(() => { setMas(null); setErrorMas(null); }, [cortes.datos]);
  const cursor = mas ? mas.cursor : cortes.datos?.nextCursor ?? null;
  async function cargarMas() {
    if (!cursor || pidiendo) return;
    setPidiendo(true); setErrorMas(null);
    try {
      const r = await api<{ sessions: Turno[]; nextCursor: string | null }>(`${consulta}&cursor=${encodeURIComponent(cursor)}`);
      setMas((antes) => ({ items: [...(antes?.items ?? []), ...r.sessions], cursor: r.nextCursor }));
    } catch (e) { setErrorMas(errorText(e, 'No se pudieron cargar más cortes')); }
    finally { setPidiendo(false); }
  }

  const nombreCaja = useMemo(() => new Map((cajas.datos?.registers ?? []).map((c) => [c.id, c.name])), [cajas.datos]);
  const nombreSede = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const todos = useMemo(() => (cortes.datos ? [...cortes.datos.sessions, ...(mas?.items ?? [])] : null), [cortes.datos, mas]);
  const personas = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of todos ?? []) if (t.responsibleName) m.set(t.responsibleUserId, t.responsibleName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [todos]);
  const visibles = todos?.filter((t) => !persona || t.responsibleUserId === persona) ?? null;
  const abiertas = avisos.datos?.open ?? null;
  const variasSedes = !sede && sedes.length > 1;

  return (
    <div className="stack gap-24">
      <PageHeader
        title="Cortes de caja"
        sub="Solo consulta: qué cajas están abiertas, cómo cerró cada turno, de quién fue y qué diferencias faltan por revisar."
        actions={sedes.length > 1 ? (
          <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => { setSede(e.target.value); setPersona(''); }}>
            {deTodas && <option value="">Todas las sucursales</option>}
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : undefined}
      />

      {avisos.datos && <AvisosDeCaja avisos={avisos.datos} puedeRevisar={puedeRevisar} />}

      <Card title="Abiertas ahora" sub="Mientras una caja está abierta su efectivo no se muestra: se revela en el corte.">
        {avisos.error ? <ErrorCarga titulo="No se pudieron cargar las cajas abiertas" mensaje={avisos.error} onReintentar={() => void avisos.recargar()} />
          : abiertas === null ? <Skeleton h={48} />
          : abiertas.length === 0 ? <p className="small muted">No hay ninguna caja abierta.</p> : (
            <ul className="stack-sm lista-limpia" data-testid="cajas-abiertas">
              {abiertas.map((a) => (
                <li key={a.id} className="small">
                  <Badge tone={a.stale ? 'warn' : 'ok'} dot>{a.registerName}</Badge>{' '}
                  {a.branchName} · la abrió {a.openedByName ?? '—'} {desde(a)}{a.stale ? ': sigue sin cortar.' : '.'}
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title="Cortes" sub={`Los turnos cerrados, del más reciente al más antiguo. Una diferencia de más de ${TOLERANCIA} queda por revisar hasta que la gerencia la cierra con su nota.`} pad={false}
        actions={<Segmented etiqueta="Qué cortes ver" value={filtro} onChange={setFiltro} options={FILTROS} />}
        footer={cursor && !cortes.error ? (
          <div className="cargar-mas">
            {errorMas && <p className="small danger" role="alert">{errorMas}</p>}
            <Button size="sm" variant="secondary" loading={pidiendo} onClick={() => void cargarMas()} data-testid="cortes-cargar-mas">Cargar más cortes</Button>
          </div>
        ) : undefined}>
        {personas.length > 1 && (
          <div className="card-body">
            <select className="select w-auto" aria-label="De quién fue el turno" value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">Turnos de cualquier persona</option>
              {personas.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            </select>
          </div>
        )}
        {cortes.error ? <div className="card-body"><ErrorCarga mensaje={cortes.error} onReintentar={() => void cortes.recargar()} /></div>
          : visibles === null ? <EsqueletoTabla filas={5} columnas={6} />
          : visibles.length === 0 ? (
            <Empty icon={filtro === 'todos' ? <History /> : <Wallet />}
              title={filtro === 'revisar' ? 'Nada por revisar' : filtro === 'diferencia' ? 'Ningún corte con diferencia' : 'Todavía no hay cortes'}
              text={filtro === 'todos' ? 'Aparecen aquí en cuanto se cierre el primer turno.' : 'Con este filtro no hay cortes que mostrar.'} />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead><tr><th>Fecha</th><th>Caja</th><th>De quién fue</th><th className="right num col-contado">Contado</th><th className="right num">Diferencia</th><th>Revisión</th><th /></tr></thead>
                <tbody>
                  {visibles.map((t) => (
                    <tr key={t.id} className={`is-link${t.varianceCents && BigInt(t.varianceCents) !== 0n ? ' fila-descuadre' : ''}`}
                      onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) router.push(`/caja/${t.id}`); }}>
                      <td>
                        <div className="strong">{fecha(t.businessDate)}</div>
                        <div className="tiny muted">{t.shiftLabel ? TURNO[t.shiftLabel] : 'Turno'} · {hora(t.openedAt)}–{t.closedAt ? hora(t.closedAt) : ''}</div>
                      </td>
                      <td>{nombreCaja.get(t.cashRegisterId) ?? 'Caja'}{variasSedes ? <div className="tiny muted">{nombreSede.get(t.branchId) ?? ''}</div> : null}</td>
                      <td className="small" data-label="De quién fue">{quienResponde(t)}</td>
                      <td className="right num stack-hide col-contado">{t.countedCashCents ? pesos(t.countedCashCents) : '—'}</td>
                      <td className="right num" data-label="Diferencia"><Diferencia cents={t.varianceCents} /></td>
                      <td data-label="Revisión">
                        <EstadoRevision turno={t} />
                        {puedeRevisar && t.varianceStatus === 'PENDING' && <> <Button variant="ghost" size="sm" onClick={() => setRevisar(t)}>Revisar</Button></>}
                      </td>
                      <td className="right text-right"><Link className="btn btn-ghost btn-sm" href={`/caja/${t.id}`}>Ver corte</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {revisar && <RevisarDialog turno={revisar} caja={nombreCaja.get(revisar.cashRegisterId) ?? 'Caja'} onClose={() => setRevisar(null)}
        onListo={() => { setRevisar(null); void cortes.recargar(); void avisos.recargar(); }} />}
    </div>
  );
}
