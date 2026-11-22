'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, FileText, Printer, Receipt, Undo2 } from 'lucide-react';
import type { MemberStatement, StatementCharge, StatementChargesPage, StatementPayment, StatementPaymentsPage } from '@gymflow/core/contracts';
import { COMO_SE_SALDO, METODO_DE_PAGO, etiqueta } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { concepto, fecha, fechaHora, pesos } from '@/lib/format';
import { useToast, errorText } from './session';
import { Badge, Button, Card, Empty, IconTile, Skeleton } from './ui';
import { CargoAcciones, PagoAcciones } from './correcciones';

/**
 * EL ESTADO DE CUENTA EN LA FICHA (bloque 1.6 · 3-04, 3-05, 3-06, 4-15; bloque
 * 2.2 · 3-13).
 *
 * UNA lista cronológica, de lo más reciente a lo más viejo: cargos y pagos
 * intercalados, como los lee el socio en su portal. Antes eran dos tarjetas
 * lado a lado y los botones de cada cargo se salían de la suya; en el
 * teléfono, doce cargos medían tres pantallas. Arriba, lo que se pregunta en
 * el mostrador: cuánto debe, cuánto tiene a favor y cuándo pagó por última
 * vez. Cada renglón trae su corrección («Corregir» un cargo, «Devolver» un
 * pago) y su detalle plegado (ajustes, qué cubrió).
 *
 * La primera página y lo que se debe llegan con el estado de cuenta (`st`);
 * aquí se piden las siguientes. Cargos y pagos se paginan por separado en la
 * API: la lista solo enseña hasta donde las DOS llegan, para no pintar un
 * tramo con cargos y sin sus pagos. Lo que se debe se ve siempre.
 */

type Tono = 'ok' | 'warn' | 'danger' | 'info';
const CARGO: Record<string, { label: string; tone?: Tono }> = {
  PAID: { label: 'Pagado', tone: 'ok' }, OPEN: { label: 'Por pagar', tone: 'warn' },
  PARTIALLY_PAID: { label: 'Pago parcial', tone: 'warn' }, OVERDUE: { label: 'Vencido', tone: 'danger' },
  VOID: { label: 'Anulado' }, WRITTEN_OFF: { label: 'Castigado' }, DRAFT: { label: 'Borrador' },
};
const AJUSTE: Record<string, string> = { DISCOUNT: 'Descuento', WAIVER: 'Condonación', LATE_FEE: 'Recargo', CORRECTION: 'Corrección' };

/** La palabra del cargo: si ya está saldado, cómo se saldó (la misma que ve el socio en su portal). */
function estadoDelCargo(c: StatementCharge): { label: string; tone?: Tono } {
  if (c.status === 'PAID' && c.settledBy) return { label: COMO_SE_SALDO[c.settledBy]?.personal ?? 'Pagado', tone: c.settledBy === 'PAYMENT' ? 'ok' : 'info' };
  return CARGO[c.status] ?? { label: c.status };
}

/** Junta páginas sin repetir: lo que debe llega también con la primera aunque sea viejo. */
function juntar<T extends { id: string }>(primera: readonly T[], demas: readonly T[]): T[] {
  const porId = new Map<string, T>();
  for (const x of [...primera, ...demas]) if (!porId.has(x.id)) porId.set(x.id, x);
  return [...porId.values()];
}

type Renglon =
  | { tipo: 'cargo'; id: string; orden: string; cargo: StatementCharge }
  | { tipo: 'pago'; id: string; orden: string; pago: StatementPayment };

const debe = (c: StatementCharge) => BigInt(c.balanceCents) > 0n && !['VOID', 'WRITTEN_OFF'].includes(c.status);

export function EstadoDeCuenta({ memberId, st, onCambio }: {
  memberId: string;
  /** `null` mientras carga. */
  st: MemberStatement | null;
  /** Tras corregir un cargo o devolver un pago: la ficha vuelve a pedir todo. */
  onCambio: () => void;
}) {
  const toast = useToast();
  // Lo que se fue pidiendo con «Cargar más». Si el estado de cuenta se vuelve a pedir, se empieza de nuevo.
  const [masCargos, setMasCargos] = useState<{ items: StatementCharge[]; cursor: string | null } | null>(null);
  const [masPagos, setMasPagos] = useState<{ items: StatementPayment[]; cursor: string | null } | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  useEffect(() => { setMasCargos(null); setMasPagos(null); }, [st]);

  const cursorCargos = masCargos ? masCargos.cursor : st?.pages.charges.nextCursor ?? null;
  const cursorPagos = masPagos ? masPagos.cursor : st?.pages.payments.nextCursor ?? null;

  const { renglones, cargados } = useMemo(() => {
    const cargos = juntar(st?.charges ?? [], masCargos?.items ?? []);
    const pagos = juntar(st?.payments ?? [], masPagos?.items ?? []);
    // Hasta dónde llega cada lista: si le faltan páginas, lo más viejo que ya trajo (sin contar la deuda vieja, que viene aparte).
    const fondoCargos = cursorCargos ? cargos.filter((c) => !debe(c)).map((c) => c.dueDate.slice(0, 10)).sort()[0] ?? null : null;
    const fondoPagos = cursorPagos ? pagos.map((p) => p.receivedAt.slice(0, 10)).sort()[0] ?? null : null;
    const frontera = [fondoCargos, fondoPagos].filter((x): x is string => !!x).sort().at(-1) ?? null;
    const todos: Renglon[] = [
      ...cargos.map((c) => ({ tipo: 'cargo' as const, id: c.id, orden: c.dueDate, cargo: c })),
      ...pagos.map((p) => ({ tipo: 'pago' as const, id: p.id, orden: p.receivedAt, pago: p })),
    ];
    const visibles = todos
      .filter((x) => !frontera || x.orden.slice(0, 10) >= frontera || (x.tipo === 'cargo' && debe(x.cargo)))
      // Mismo día: el pago va arriba del cargo que cubrió (se cobró después de emitirlo).
      .sort((a, b) => b.orden.slice(0, 10).localeCompare(a.orden.slice(0, 10)) || (a.tipo === b.tipo ? b.orden.localeCompare(a.orden) || b.id.localeCompare(a.id) : a.tipo === 'pago' ? -1 : 1));
    return { renglones: visibles, cargados: todos.length };
  }, [st, masCargos, masPagos, cursorCargos, cursorPagos]);

  const total = st ? st.pages.charges.total + st.pages.payments.total : 0;
  const hayMas = !!cursorCargos || !!cursorPagos;

  async function cargarMas() {
    setPidiendo(true);
    try {
      const [c, p] = await Promise.all([
        cursorCargos ? api<StatementChargesPage>(`/members/${memberId}/statement/charges?cursor=${encodeURIComponent(cursorCargos)}`) : null,
        cursorPagos ? api<StatementPaymentsPage>(`/members/${memberId}/statement/payments?cursor=${encodeURIComponent(cursorPagos)}`) : null,
      ]);
      if (c) setMasCargos((a) => ({ items: [...(a?.items ?? []), ...c.items], cursor: c.nextCursor }));
      if (p) setMasPagos((a) => ({ items: [...(a?.items ?? []), ...p.items], cursor: p.nextCursor }));
    } catch (e) { toast('error', errorText(e, 'No se pudieron cargar más movimientos')); } finally { setPidiendo(false); }
  }

  const saldo = BigInt(st?.outstandingCents ?? 0);
  const credito = BigInt(st?.creditCents ?? 0);
  const ultimoPago = st?.payments.find((p) => BigInt(p.amountCents) > 0n && p.status === 'SUCCEEDED') ?? null;

  return (
    <div className="stack" data-testid="estado-de-cuenta">
      {st && (
        <dl className="cuenta-totales" data-testid="cuenta-totales">
          <div><dt>Debe</dt><dd className={`num${saldo > 0n ? ' danger' : ''}`}>{pesos(saldo)}</dd></div>
          <div><dt>A favor</dt><dd className="num">{pesos(credito)}</dd></div>
          <div><dt>Último pago</dt><dd className="num">{ultimoPago ? <>{pesos(ultimoPago.amountCents)} <span className="tiny muted">· {fecha(ultimoPago.receivedAt)}</span></> : <span className="muted">Sin pagos</span>}</dd></div>
        </dl>
      )}
      <Card pad={false} title="Movimientos" data-testid="cuenta-movimientos"
        sub={st && total > 0 ? (hayMas ? `Se muestran ${renglones.length} de ${total} · lo más reciente primero` : `${total} ${total === 1 ? 'movimiento' : 'movimientos'} · lo más reciente primero`) : undefined}
        actions={st && total > 0 ? <a className="btn btn-secondary btn-sm" href={`/recibo/estado/${memberId}`} target="_blank" rel="noreferrer"><Printer />Imprimir para el socio</a> : undefined}
        footer={hayMas ? <Button size="sm" variant="secondary" loading={pidiendo} onClick={() => void cargarMas()}>Cargar más movimientos</Button> : undefined}>
        {!st ? <div className="card-body"><Skeleton h={160} /></div>
          : cargados === 0 ? <Empty icon={<Receipt />} title="Sin movimientos" text="Aquí aparecerán sus cargos y sus pagos." />
            : (
              <ul className="list">
                {renglones.map((x) => (x.tipo === 'cargo'
                  ? <RenglonCargo key={`c-${x.id}`} c={x.cargo} onCambio={onCambio} />
                  : <RenglonPago key={`p-${x.id}`} p={x.pago} onCambio={onCambio} />))}
              </ul>
            )}
      </Card>
    </div>
  );
}

function RenglonCargo({ c, onCambio }: { c: StatementCharge; onCambio: () => void }) {
  const e = estadoDelCargo(c);
  const abierto = debe(c);
  return (
    <li className="list-item items-start mov" data-testid="mov-cargo" data-estado={c.status}>
      <IconTile size="sm" tone={c.status === 'OVERDUE' ? 'danger' : abierto ? 'warn' : 'neutral'}><FileText /></IconTile>
      <div className="flex-1 min-w-0">
        <div className="small strong mov-titulo">{concepto(c.concept)} <Badge tone={e.tone}>{e.label}</Badge></div>
        <div className="tiny muted">Cargo · vence {fecha(c.dueDate)}</div>
        {c.adjustments.length > 0 && (
          <details className="explica tiny" data-testid="cargo-ajustes">
            <summary>{c.adjustments.length === 1 ? 'Ver el ajuste' : `Ver los ${c.adjustments.length} ajustes`}</summary>
            {c.adjustments.map((a) => (
              <div key={a.id} className="muted">
                {AJUSTE[a.adjustmentType] ?? 'Ajuste'} de {pesos(a.amountCents)} · {a.reason}
                {a.approvedByName ? ` · Autorizó ${a.approvedByName}` : ''} · {fecha(a.createdAt)}
              </div>
            ))}
          </details>
        )}
      </div>
      <div className="mov-importe num">
        <span className="strong">{pesos(c.amountCents)}</span>
        {abierto && c.balanceCents !== c.amountCents && <span className="tiny muted">Pendiente {pesos(c.balanceCents)}</span>}
      </div>
      <div className="mov-acciones"><CargoAcciones cargo={c} onDone={onCambio} /></div>
    </li>
  );
}

function RenglonPago({ p, onCambio }: { p: StatementPayment; onCambio: () => void }) {
  const contra = BigInt(p.amountCents) < 0n;
  const titulo = contra ? (p.reversalReason?.startsWith('Reembolso') ? 'Reembolso' : 'Reversa') : `Pago · ${etiqueta(METODO_DE_PAGO, p.method, p.method)}`;
  return (
    <li className="list-item items-start mov" data-testid="mov-pago" data-contra={contra ? 'si' : 'no'}>
      <IconTile size="sm" tone={contra ? 'danger' : 'ok'}>{contra ? <Undo2 /> : <ArrowDownLeft />}</IconTile>
      <div className="flex-1 min-w-0">
        <div className="small strong mov-titulo">{titulo}{p.status === 'REVERSED' && <> <Badge>Revertido</Badge></>}</div>
        <div className="tiny muted">
          {fechaHora(p.receivedAt)}{p.folio ? ` · ${p.folio}` : ''}
          {/* Quién cobró y con qué referencia (3-05): antes había que abrir el comprobante o la bitácora. */}
          {p.collectedByName ? ` · ${contra ? 'Registró' : 'Cobró'} ${p.collectedByName}` : ''}
          {p.externalRef ? ` · Ref. ${p.externalRef}` : ''}
          {p.reversalReason ? ` · ${p.reversalReason}` : ''}
        </div>
        {p.covers.length > 0 && (
          <div className="tiny muted" data-testid="pago-cubre">
            {contra ? 'Dejó de cubrir: ' : 'Cubrió: '}
            {p.covers.map((x) => `${concepto(x.concept)} (${pesos(contra ? (-BigInt(x.amountCents)).toString() : x.amountCents)})`).join(' · ')}
          </div>
        )}
        {!contra && p.covers.length === 0 && BigInt(p.unappliedCents) > 0n && <div className="tiny muted">Quedó como saldo a favor</div>}
      </div>
      <div className={`mov-importe num strong${contra ? ' danger' : ''}`}>{pesos(p.amountCents)}</div>
      <div className="mov-acciones">
        <PagoAcciones pago={p} onDone={onCambio} />
        <a className="btn btn-ghost btn-icon btn-sm" href={`/recibo/${p.id}`} target="_blank" rel="noreferrer" title="Comprobante" aria-label="Comprobante"><Printer /></a>
      </div>
    </li>
  );
}
