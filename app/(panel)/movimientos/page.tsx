'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Receipt, TrendingUp, Download, Landmark, Wallet, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { METODO } from '@/lib/caja';
import { capital, dia, fecha, hora, nombreMes, pesos } from '@/lib/format';
import { useSession, errorText, useToast } from '@/components/session';
import { Badge, Button, ButtonLink, Callout, CampoFecha, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, ErrorCarga, faltaMotivo, Field, PageHeader, Segmented, Skeleton, Stat, EsqueletoTabla } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { EstadoCarga, useCarga } from '@/lib/carga';
import type { Expense, ExpenseList } from '@gymflow/core/contracts';
import { GLOSARIO } from '@/lib/glosario';
import { GlosarioDinero } from '@/components/glosario-dinero';
import { hoyEn, masDias } from '@/lib/zonas';

type Totales = {
  incomeCents: string; refundsCents: string; expensesCents: string; varianceCents: string;
  /** Faltantes de los cortes, corte por corte (negativo): lo único del descuadre que resta (13-05, 14-09). */
  shortageCents?: string;
  /** Sobrantes de los cortes (positivo): no suman, se informan «por aclarar». */
  overageCents?: string;
  netCents: string; toBankCents: string; creditNotesCents: string; byMethod: Record<string, string>;
  /** Renta, nómina, servicios: repartidos por día (negativo). */
  fixedExpensesCents: string; profitCents: string;
};
type Dia = Totales & { date: string };
type Resumen = {
  from: string; to: string; totals: Totales; days: Dia[];
  /** Retiros del dueño de los meses del periodo: se informan, no restan (D-23). */
  ownerDrawsCents?: string;
  /** «Ajustes de ‹mes›» anotados en los meses del periodo: ya van dentro de los gastos fijos (D-22). */
  adjustments?: Array<{ month: string; cents: string; count: number }>;
  /** Meses del periodo ya cerrados: sus cifras no cambian. */
  closedMonths?: string[];
  totalsFromSnapshot?: boolean;
};
type Movimiento = {
  id: string; at: string; branchId: string | null; kind: string; method: string | null; amountCents: string;
  concept: string | null; folio: string | null; memberId: string | null; memberName: string | null;
  memberCode: string | null; userName: string | null;
};

/** Qué es cada movimiento y si cuenta para la ganancia del día. */
const TIPO: Record<string, { label: string; tone: 'ok' | 'danger' | 'warn' | 'info' | 'neutral'; cuenta: boolean }> = {
  PAYMENT: { label: 'Cobro a socio', tone: 'ok', cuenta: true },
  POS_SALE: { label: 'Venta de mostrador', tone: 'ok', cuenta: true },
  REFUND: { label: 'Devolución', tone: 'danger', cuenta: true },
  CASH_EXPENSE: { label: 'Gasto de caja', tone: 'warn', cuenta: true },
  CASH_VARIANCE: { label: 'Faltante o sobrante de caja', tone: 'warn', cuenta: true },
  CASH_WITHDRAWAL: { label: 'Retiro al banco', tone: 'info', cuenta: false },
  CASH_DEPOSIT: { label: 'Depósito', tone: 'info', cuenta: false },
  CASH_FLOAT_IN: { label: 'Fondo de caja', tone: 'neutral', cuenta: false },
  CASH_CORRECTION: { label: 'Corrección de caja', tone: 'neutral', cuenta: false },
  POS_VOID: { label: 'Venta anulada', tone: 'neutral', cuenta: false },
  // Lo que se le abonó al socio (lo que sobró al bajar de plan, el saldo a
  // favor de una importación): no entró dinero (0.6).
  CREDIT_NOTE: { label: 'Saldo a favor (nota de crédito)', tone: 'info', cuenta: false },
};

type Rango = 'hoy' | 'ayer' | '7' | '30' | 'mes' | 'otro';
const RANGOS: ReadonlyArray<{ value: Rango; label: string }> = [
  { value: 'hoy', label: 'Hoy' }, { value: 'ayer', label: 'Ayer' }, { value: '7', label: '7 días' },
  { value: '30', label: '30 días' }, { value: 'mes', label: 'Este mes' }, { value: 'otro', label: 'Elegir' },
];

/**
 * Un descuadre dice qué fue según su signo: el faltante cuenta en la ganancia,
 * el sobrante no (DM-10, 14-09). Antes los dos eran «faltante o sobrante» y
 * contaban igual.
 */
function tipoDe(m: { kind: string; amountCents: string }): { label: string; tone: 'ok' | 'danger' | 'warn' | 'info' | 'neutral'; cuenta: boolean } {
  if (m.kind === 'CASH_VARIANCE') {
    return BigInt(m.amountCents) < 0n
      ? { label: 'Faltante de caja', tone: 'danger', cuenta: true }
      : { label: 'Sobrante de caja · por aclarar', tone: 'warn', cuenta: false };
  }
  return TIPO[m.kind] ?? { label: m.kind, tone: 'neutral', cuenta: false };
}
/** Faltante del corte (negativo): con la API anterior, la parte negativa del descuadre. */
const faltanteDe = (t: Totales) => BigInt(t.shortageCents ?? (BigInt(t.varianceCents) < 0n ? t.varianceCents : '0'));
const sobranteDe = (t: Totales) => BigInt(t.overageCents ?? (BigInt(t.varianceCents) > 0n ? t.varianceCents : '0'));

/** "mié 30 de sep" → "Mié 30 de sep": solo la primera letra. */
const diaCorto = (d: string, opts: Intl.DateTimeFormatOptions) => capital(dia(d, opts));
/** El periodo en fechas de calendario. `h` es HOY en la zona del gimnasio, no en la de la computadora (14-20). */
function periodo(r: Rango, desde: string, hasta: string, h: string): [string, string] {
  switch (r) {
    case 'hoy': return [h, h];
    case 'ayer': return [masDias(h, -1), masDias(h, -1)];
    case '7': return [masDias(h, -6), h];
    case '30': return [masDias(h, -29), h];
    case 'mes': return [`${h.slice(0, 8)}01`, h];
    default: return [desde, hasta];
  }
}

/**
 * MOVIMIENTOS: lo que entró y salió cada día, y lo que de verdad le quedó al
 * gimnasio. Es caja, no contabilidad devengada: para eso está el Tablero.
 */
export default function MovimientosPage() {
  const { branches, inScope, branchName, me, can, org } = useSession();
  const hoy = hoyEn(org.timezone);
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const todas = me.branchScopes.includes(null);
  const [sede, setSede] = useState(todas || sedes.length > 1 ? '' : sedes[0]?.id ?? '');
  const [rango, setRango] = useState<Rango>('7');
  // `?rango=mes` llega desde el inicio del dueño: abre en la misma cifra que acaba de ver.
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('rango');
    if (r && RANGOS.some((x) => x.value === r)) setRango(r as Rango);
  }, []);
  const [desde, setDesde] = useState(() => masDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const [desdeP, hastaP] = periodo(rango, desde, hasta, hoy);
  const [dia, setDia] = useState<string>(hastaP);
  const [tipo, setTipo] = useState<string>('');
  const [todos, setTodos] = useState(false);
  const qsSede = sede ? `&branchId=${sede}` : '';

  // El resumen y el día, cada uno con sus tres estados (14-20): un error de red
  // ya no se lee «Ese día no entró ni salió dinero» ni «Sin gastos fijos».
  const cargarResumen = useCallback(() => api<Resumen>(`/reports/daily?from=${desdeP}&to=${hastaP}${qsSede}`), [desdeP, hastaP, qsSede]);
  const resumen = useCarga(cargarResumen);
  // Mientras llega otro periodo no se ven las cifras del anterior (useCarga las suelta).
  const r = resumen.datos ?? null;
  // Al cambiar de periodo, se abre su último día.
  useEffect(() => { setDia(hastaP); }, [hastaP]);

  const cargarDia = useCallback(() => api<{ movements: Movimiento[] }>(`/reports/movements?date=${dia}${qsSede}`).then((x) => x.movements), [dia, qsSede]);
  const delDia = useCarga(cargarDia);
  const movs = delDia.datos ?? null;
  useEffect(() => { setTodos(false); }, [dia, qsSede]);

  const visibles = useMemo(() => (movs ?? []).filter((m) => !tipo || m.kind === tipo), [movs, tipo]);
  const tiposDelDia = useMemo(() => [...new Set((movs ?? []).map((m) => m.kind))], [movs]);
  const max = useMemo(() => (r?.days ?? []).reduce((a, d) => {
    const v = BigInt(d.profitCents); const abs = v < 0n ? -v : v; return abs > a ? abs : a;
  }, 1n), [r]);
  const t = r?.totals;
  const hayNegativos = (r?.days ?? []).some((d) => BigInt(d.profitCents) < 0n);
  const unDia = desdeP === hastaP;
  // Gimnasio sin un solo peso en el periodo: un solo aviso, no gráfica en cero, siete "$0" y tres vacíos.
  const ceros = (d: Totales) => [d.incomeCents, d.refundsCents, d.expensesCents, d.varianceCents, d.fixedExpensesCents, d.profitCents, d.toBankCents, d.creditNotesCents]
    .every((c) => BigInt(c) === 0n);
  const sinNada = !!r && r.days.every(ceros) && movs !== null && movs.length === 0;

  function exportar() {
    const filas = [['Hora', 'Tipo', 'Socio', 'Código', 'Concepto', 'Método', 'Folio', 'Registró', 'Monto', 'Cuenta en la ganancia']];
    for (const m of visibles) {
      filas.push([hora(m.at), tipoDe(m).label, m.memberName ?? '', m.memberCode ?? '', m.concept ?? '',
        m.method ? METODO[m.method] ?? m.method : '', m.folio ?? '', m.userName ?? '', (Number(m.amountCents) / 100).toFixed(2),
        tipoDe(m).cuenta ? 'Sí' : 'No']);
    }
    const csv = filas.map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `movimientos-${dia}${sede ? `-${branchName(sede)}` : ''}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title="Movimientos" sub="Lo que entró y salió cada día, y lo que de verdad te quedó."
        actions={sedes.length > 1 && (
          <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
            <option value="">{todas ? 'Todas las sucursales' : 'Mis sucursales'}</option>
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )} />

      <div className="row wrap gap-10 mb-16">
        <Segmented value={rango} onChange={setRango} options={RANGOS} />
        {rango === 'otro' && (
          <div className="row gap-6">
            {/* Día/mes/año siempre (D26-02); el periodo cambia solo con una fecha completa. */}
            <CampoFecha aria-label="Desde" value={desde} max={hasta} hoy={hoy} onChange={(v) => { if (v) setDesde(v); }} />
            <span className="muted small">al</span>
            <CampoFecha aria-label="Hasta" value={hasta} min={desde} max={hoy} hoy={hoy} onChange={(v) => { if (v) setHasta(v); }} />
          </div>
        )}
      </div>

      {resumen.error && <div className="mb-12"><ErrorCarga titulo="No se pudo cargar el resumen del periodo" mensaje={resumen.error} onReintentar={() => void resumen.recargar()} /></div>}

      {/* D-22: lo cerrado no cambia, y lo que llegó tarde se ve etiquetado. */}
      {r && (r.closedMonths?.length ?? 0) > 0 && (
        <div className="mb-12" data-testid="meses-cerrados">
          <Callout tone="ok" title={`${capital(r.closedMonths!.map(nombreMes).join(', '))}: mes cerrado`}>
            {r.totalsFromSnapshot ? 'Los totales son los de la foto del cierre y ya no cambian.' : 'Sus cifras quedaron fijas al cerrarlo.'} Lo que llegue tarde se anota en el mes en curso como ajuste.
          </Callout>
        </div>
      )}
      {r && (r.adjustments?.length ?? 0) > 0 && (
        <div className="mb-12" data-testid="ajustes-de-meses-cerrados">
          <Callout tone="info" title="Incluye ajustes de meses cerrados">
            {r.adjustments!.map((a) => `ajuste de ${nombreMes(a.month)}: ${BigInt(a.cents) < 0n ? `${pesos(-BigInt(a.cents))} a favor` : pesos(a.cents)}`).join(' · ')}. Van dentro de los gastos fijos del periodo.
          </Callout>
        </div>
      )}

      {!resumen.error && <div className="grid grid-4 mb-12">
        {t ? (
          <>
            <Stat icon={<ArrowDownLeft />} label={GLOSARIO.entro.nombre} value={pesos(t.incomeCents, { decimals: false })} note="Cobros a socios y ventas de mostrador" />
            <Stat icon={<ArrowUpRight />} label="Devoluciones" value={pesos(t.refundsCents, { decimals: false })} note="Reversas y reembolsos" danger={BigInt(t.refundsCents) < 0n} />
            {/* Gastos = gastos + FALTANTES + fijos: Entró − Devoluciones − Gastos da la Ganancia.
                Un sobrante no paga un faltante: se dice aparte, «por aclarar» (14-09). */}
            <Stat icon={<Receipt />} label={GLOSARIO.gastos.nombre} value={pesos(BigInt(t.expensesCents) + faltanteDe(t) + BigInt(t.fixedExpensesCents), { decimals: false })}
              note={[
                `De la caja ${pesos(BigInt(t.expensesCents) + faltanteDe(t), { decimals: false })}`,
                `fijos ${pesos(t.fixedExpensesCents, { decimals: false })}`,
                sobranteDe(t) > 0n ? `sobró ${pesos(sobranteDe(t), { decimals: false })} por aclarar (no suma)` : null,
              ].filter(Boolean).join(' · ')} />
            <Stat feature icon={<TrendingUp />} label={unDia ? `${GLOSARIO.gananciaCaja.nombre} del día` : `${GLOSARIO.gananciaCaja.nombre} del periodo`} value={pesos(t.profitCents, { decimals: false })}
              note={[
                `En caja quedó ${pesos(t.netCents, { decimals: false })}`,
                BigInt(t.toBankCents) !== 0n ? `al banco ${pesos(-BigInt(t.toBankCents), { decimals: false })}` : null,
                BigInt(t.creditNotesCents) !== 0n ? `con saldo a favor ${pesos(t.creditNotesCents, { decimals: false })} (no suma)` : null,
                // El retiro del dueño se anota y se ve, pero no resta (D-23).
                r?.ownerDrawsCents && BigInt(r.ownerDrawsCents) > 0n ? `retiros del dueño ${pesos(r.ownerDrawsCents, { decimals: false })} (no restan)` : null,
              ].filter(Boolean).join(' · ')} />
          </>
        ) : [0, 1, 2, 3].map((i) => <Skeleton key={i} h={112} r={16} />)}
      </div>}
      <div className="mb-20">
        {/* El mismo glosario que el Tablero y el Inicio (D-24). */}
        <GlosarioDinero titulo="¿Qué cuenta aquí?" terminos={['entro', 'gastos', 'gananciaCaja', 'descuadre', 'retiroDueno', 'ajuste']}>
          Lo que se cobra por adelantado (una anualidad) cuenta el día que entró; para repartirlo por meses usa el <Link href="/tablero">Tablero</Link>.
        </GlosarioDinero>
      </div>

      {t && Object.keys(t.byMethod).length > 0 && (
        <Card title="Cómo entró el dinero" className="mov-metodos">
          <div className="row wrap" style={{ gap: 18 }}>
            {Object.entries(t.byMethod).sort((a, b) => Number(BigInt(b[1]) - BigInt(a[1]))).map(([m, v]) => (
              <div key={m}>
                <div className="tiny muted row gap-4">{m === 'CASH' ? <Wallet size={12} /> : <Landmark size={12} />}{METODO[m] ?? m}</div>
                <div className="strong num">{pesos(v, { decimals: false })}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {sinNada && (
        <Card pad={false}>
          <Empty icon={<Receipt />} title="Todavía no hay movimientos" text="Aquí verás cada cobro, venta y gasto del día en cuanto pase por la caja."
            // Solo a quien abre turnos: la dueña consulta y no cobra (3.13).
            action={can('cash:session:open') ? <ButtonLink href="/caja" variant="primary">Abre la caja para empezar a cobrar</ButtonLink> : undefined} />
        </Card>
      )}
      {r && !unDia && !sinNada && (
        <Card title={`${GLOSARIO.gananciaCaja.nombre} por día`} sub="Toca un día para ver sus movimientos." pad={false}>
          <div className={`mov-chart${hayNegativos ? '' : ' solo-pos'}`} role="group" aria-label="Ganancia en caja por día. Elige un día para ver sus movimientos">
            {r.days.map((d) => {
              const v = BigInt(d.profitCents);
              const pct = Number(((v < 0n ? -v : v) * 1000n) / max) / 10;
              return (
                <button key={d.date} type="button" className="mov-barra" aria-pressed={d.date === dia}
                  title={`${fecha(d.date)}: ${pesos(d.profitCents)}`} aria-label={`${fecha(d.date)}: ganancia ${pesos(d.profitCents)}`}
                  onClick={() => setDia(d.date)}>
                  <span className={`mov-barra-fill${v < 0n ? ' neg' : ''}`} style={{ height: `${Math.max(pct, v === 0n ? 0 : 2)}%` }} />
                </button>
              );
            })}
          </div>
          {/* Las fechas de los extremos y del medio: sin ellas las barras no dicen qué día son. */}
          <div className="mov-ejes tiny muted">
            {[r.days[0], r.days[Math.floor(r.days.length / 2)], r.days.at(-1)].map((d, i) => d && (
              <span key={i}>{diaCorto(d.date, { day: 'numeric', month: 'short' })}</span>
            ))}
          </div>
          <div className="table-wrap">
            {/* En el teléfono, un renglón táctil por día: día, lo que entró y la ganancia (UX7 Dirección 7). */}
            <table className="table table-stack table-dias">
              <thead><tr><th>Día</th><th className="right">{GLOSARIO.entro.nombre}</th><th className="right">Devoluciones</th><th className="right">Gastos de caja</th><th className="right">{GLOSARIO.descuadre.nombre}</th><th className="right">Fijos</th><th className="right">{GLOSARIO.gananciaCaja.nombre}</th></tr></thead>
              <tbody>
                {[...r.days].reverse().map((d) => (
                  <tr key={d.date} className="is-link" aria-selected={d.date === dia} onClick={() => setDia(d.date)}
                    style={d.date === dia ? { background: 'var(--surface-2)' } : undefined}>
                    <td><button type="button" className="row-link strong" onClick={(e) => { e.stopPropagation(); setDia(d.date); }}>
                      {diaCorto(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                    </button></td>
                    <td className="right num" data-label={GLOSARIO.entro.nombre}>{pesos(d.incomeCents, { decimals: false })}</td>
                    <td className="right num stack-hide">{BigInt(d.refundsCents) ? pesos(d.refundsCents, { decimals: false }) : '—'}</td>
                    <td className="right num stack-hide">{BigInt(d.expensesCents) ? pesos(d.expensesCents, { decimals: false }) : '—'}</td>
                    {/* El faltante resta (rojo); el sobrante se informa y no suma. */}
                    <td className="right num stack-hide">
                      {faltanteDe(d) === 0n && sobranteDe(d) === 0n ? '—' : <>
                        {faltanteDe(d) < 0n && <span className="text-danger">{pesos(faltanteDe(d), { decimals: false })}</span>}
                        {sobranteDe(d) > 0n && <div className="tiny muted">+{pesos(sobranteDe(d), { decimals: false })} por aclarar</div>}
                      </>}
                    </td>
                    <td className="right num stack-hide">{BigInt(d.fixedExpensesCents) ? pesos(d.fixedExpensesCents, { decimals: false }) : '—'}</td>
                    <td className="right num strong" data-label={GLOSARIO.gananciaCaja.nombre} style={BigInt(d.profitCents) < 0n ? { color: 'var(--danger)' } : undefined}>{pesos(d.profitCents, { decimals: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <GastosFijos sede={sede} hoy={hoy} compacto={sinNada} onCambio={() => void resumen.recargar()} />
      {!sinNada && <Card pad={false} className="mt-16" title={diaCorto(dia, { weekday: 'long', day: 'numeric', month: 'long' })}
        sub={movs ? `${movs.length} movimientos` : undefined}
        actions={movs && movs.length > 0 && <Button size="sm" variant="secondary" icon={<Download />} onClick={exportar}>Exportar</Button>}>
        {tiposDelDia.length > 1 && (
          <div className="card-body row wrap" style={{ gap: 6, paddingBottom: 0 }}>
            <button type="button" className="chip" aria-pressed={!tipo} onClick={() => setTipo('')}>Todos</button>
            {tiposDelDia.map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={tipo === k} onClick={() => setTipo(k)}>{TIPO[k]?.label ?? k}</button>
            ))}
          </div>
        )}
        <EstadoCarga carga={delDia} titulo="No se pudieron cargar los movimientos del día" relleno esqueleto={<EsqueletoTabla />}
          esVacio={() => visibles.length === 0} vacio={<Empty icon={<Receipt />} title="Sin movimientos" text="Ese día no entró ni salió dinero." />}>
        {() => (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Movimiento</th><th>Hora</th><th>Método</th><th>Registró</th><th className="right">Monto</th></tr></thead>
              <tbody>
                {(todos ? visibles : visibles.slice(0, 50)).map((m) => {
                  const k = tipoDe(m);
                  const v = BigInt(m.amountCents);
                  return (
                    <tr key={`${m.kind}-${m.id}`}>
                      <td>
                        <div className="row gap-8">
                          <Badge tone={k.tone === 'neutral' ? undefined : k.tone}>{k.label}</Badge>
                          {m.memberId
                            ? (can('members:read') ? <Link className="strong small" href={`/socios/${m.memberId}`}>{m.memberName}</Link> : <span className="strong small">{m.memberName}</span>)
                            : <span className="small">{m.concept ?? (sede ? '' : branchName(m.branchId))}</span>}
                        </div>
                        {(m.memberId && m.concept) || m.folio ? <div className="tiny muted mt-4">{[m.memberId ? m.concept : null, m.folio ? `Folio ${m.folio}` : null].filter(Boolean).join(' · ')}</div> : null}
                      </td>
                      <td className="muted num">{hora(m.at)}</td>
                      <td className="small">{m.method ? METODO[m.method] ?? m.method : '—'}</td>
                      <td className="small muted stack-hide">{m.userName ?? 'Sistema'}</td>
                      <td className="right num strong" style={!k.cuenta ? { color: 'var(--muted)', fontWeight: 400 } : v < 0n ? { color: 'var(--danger)' } : undefined}
                        title={k.cuenta ? undefined : m.kind === 'CASH_VARIANCE' ? 'No cuenta en la ganancia: sobró y está por aclarar' : 'No cuenta en la ganancia: es dinero que cambia de lugar'}>
                        {v > 0n && k.cuenta ? '+' : ''}{pesos(v)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!todos && visibles.length > 50 && (
              <div className="card-foot row-between">
                <span className="tiny muted">Se muestran 50 de {visibles.length}. Exportar siempre baja todos.</span>
                <Button size="sm" variant="secondary" onClick={() => setTodos(true)}>Ver todos</Button>
              </div>
            )}
          </div>
        )}
        </EstadoCarga>
      </Card>}
    </>
  );
}

type Gasto = Expense;
const RETIRO = 'OWNER_DRAW';
const CATEGORIA: Record<string, string> = {
  RENT: 'Renta', PAYROLL: 'Nómina', UTILITIES: 'Luz, agua y gas', SERVICES: 'Servicios (internet, software, limpieza)',
  MAINTENANCE: 'Mantenimiento', MARKETING: 'Publicidad', TAXES: 'Impuestos', OTHER: 'Otro',
  // Se anota junto a los gastos, pero no resta de la ganancia (D-23).
  [RETIRO]: GLOSARIO.retiroDueno.nombre,
};
// El mes se nombra como en el Tablero y en el cierre («octubre de 2026», `lib/format`): antes aquí decía «octubre 2026» y el
// mismo mes se leía de dos maneras entre «Cerrar octubre de 2026» y «Ajuste de octubre 2026» (3.13).
const otroMes = (m: string, n: number) => { const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

/**
 * GASTOS FIJOS (UXB-02): renta, nómina, luz. Sin ellos la "ganancia" solo
 * era caja. Se registran por mes; la ganancia de cada día lleva su parte.
 *
 * Fase 3, bloque 3.7:
 *  - D-23 · Los anota la dueña, haya o no gerente, y la gerencia con
 *    Movimientos liberado. Aquí va también el «Retiro del dueño», que se ve
 *    pero no resta.
 *  - D-22 · En un mes cerrado nada se registra ni se anula: se anota en el mes
 *    en curso como «ajuste de ‹mes›». La pantalla lo dice antes de enviar.
 */
function GastosFijos({ sede, hoy, compacto, onCambio }: { sede: string; hoy: string; compacto?: boolean; onCambio: () => void }) {
  const { can, canOrg, branchName, branches, inScope } = useSession();
  const toast = useToast();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [nuevo, setNuevo] = useState(false);
  const [anular, setAnular] = useState<Gasto | null>(null);
  const cargar = useCallback(() => api<ExpenseList>(`/expenses?month=${mes}`), [mes]);
  const carga = useCarga(cargar);
  // Al cambiar de mes no se ven los gastos del anterior (useCarga los suelta).
  const gastos = carga.datos?.expenses ?? null;
  const cerrado = carga.datos?.closed ?? false;
  const enCurso = carga.datos?.currentMonth ?? hoy.slice(0, 7);
  const listo = () => { void carga.recargar(); onCambio(); };
  const visibles = (gastos ?? []).filter((g) => !sede || g.branchId === sede || g.branchId === null);
  const vivos = visibles.filter((g) => !g.voidedAt);
  const total = vivos.filter((g) => g.category !== RETIRO).reduce((a, g) => a + BigInt(g.amountCents), 0n);
  const retiros = vivos.filter((g) => g.category === RETIRO).reduce((a, g) => a + BigInt(g.amountCents), 0n);
  const gestiona = can('expenses:manage');
  const quien = 'Los anotan la dueña y la gerencia.';

  return (
    <Card className="mt-16" title={cerrado ? <>Gastos fijos <Badge tone="ok">Mes cerrado</Badge></> : 'Gastos fijos'} pad={false}
      sub={gastos ? `${nombreMes(mes)} · ${pesos(total, { decimals: false })} en gastos${retiros > 0n ? ` · ${pesos(retiros, { decimals: false })} en retiros del dueño (no restan)` : ''}` : nombreMes(mes)}
      actions={<div className="row gap-6">
        <Button size="sm" variant="ghost" aria-label="Mes anterior" onClick={() => setMes(otroMes(mes, -1))}>‹</Button>
        <Button size="sm" variant="ghost" aria-label="Mes siguiente" disabled={mes >= hoy.slice(0, 7)} onClick={() => setMes(otroMes(mes, 1))}>›</Button>
        {gestiona && <Button size="sm" icon={<Plus />} onClick={() => setNuevo(true)}>{cerrado ? 'Anotar ajuste' : 'Registrar'}</Button>}
      </div>}>
      {cerrado && <p className="card-body small muted" data-testid="gastos-mes-cerrado">{capital(nombreMes(mes))} está cerrado y sus cifras no cambian. Lo que falte o sobre se anota en {nombreMes(enCurso)} como «ajuste de {nombreMes(mes)}».</p>}
      {carga.error ? <div className="card-body"><ErrorCarga titulo="No se pudieron cargar los gastos fijos" mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>
        : gastos === null ? <div className="card-body"><Skeleton h={80} /></div> : visibles.length === 0 ? compacto ? (
        // Sin movimientos ya hay un aviso arriba: aquí basta una línea.
        <p className="card-body small muted">{gestiona ? 'Aún no registras renta, nómina ni servicios.' : quien}</p>
      ) : (
        <Empty icon={<Landmark />} title="Sin gastos fijos este mes" text={gestiona ? 'Registra la renta, la nómina y los servicios para que la ganancia sea ganancia.' : quien} />
      ) : (
        <ul className="list">
          {visibles.map((g) => {
            const apagado = !!g.voidedAt || !!g.correctedInMonth;
            return (
              <li key={g.id} className={`list-item${apagado ? ' gasto-apagado' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="strong small">{g.description}</div>
                  <div className="tiny muted">
                    {CATEGORIA[g.category] ?? g.category} · {g.branchId ? branchName(g.branchId) : 'Todo el gimnasio'}
                    {g.voidedAt ? ` · Anulado: ${g.voidReason}` : ''}
                    {g.correctedInMonth ? ` · Corregido con un ajuste en ${nombreMes(g.correctedInMonth)}` : ''}
                  </div>
                </div>
                {g.adjustsMonth && <Badge tone="info">Ajuste de {nombreMes(g.adjustsMonth)}</Badge>}
                {g.category === RETIRO && <Badge>No resta</Badge>}
                <span className={`num strong${g.voidedAt ? ' gasto-tachado' : ''}`}>{pesos(g.amountCents, { decimals: false })}</span>
                {gestiona && !apagado && <Button size="sm" variant="ghost" icon={<X />} aria-label={`${cerrado ? 'Corregir' : 'Anular'} ${g.description}`} onClick={() => setAnular(g)} />}
              </li>
            );
          })}
        </ul>
      )}
      {nuevo && <NuevoGasto mes={mes} ajusteEn={cerrado ? enCurso : null} sedes={branches.filter((b) => b.isActive && inScope(b.id))} todoElGimnasio={canOrg('expenses:manage')} sedeInicial={sede}
        onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); toast('ok', cerrado ? `Ajuste de ${nombreMes(mes)} anotado en ${nombreMes(enCurso)}` : 'Gasto registrado'); listo(); }} />}
      {anular && <AnularGasto gasto={anular} ajusteEn={cerrado ? enCurso : null} onClose={() => setAnular(null)}
        onListo={() => { setAnular(null); toast('ok', cerrado ? `Corregido con un ajuste en ${nombreMes(enCurso)}` : 'Gasto anulado'); listo(); }} />}
    </Card>
  );
}

/** `ajusteEn`: el mes está cerrado y esto se anota en ese otro mes (el mes en curso) como «ajuste de ‹mes›» (D-22). */
function NuevoGasto({ mes, ajusteEn, sedes, todoElGimnasio, sedeInicial, onClose, onListo }: {
  mes: string; ajusteEn: string | null; sedes: Array<{ id: string; name: string }>; todoElGimnasio: boolean; sedeInicial: string; onClose: () => void; onListo: () => void;
}) {
  const [categoria, setCategoria] = useState('RENT');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [sede, setSede] = useState(sedeInicial || (todoElGimnasio ? '' : sedes[0]?.id ?? ''));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = /^\d+(\.\d{1,2})?$/.test(monto.trim()) ? BigInt(Math.round(Number(monto) * 100)) : null;
  const valido = descripcion.trim().length >= 3 && cents !== null && cents > 0n && (sede !== '' || todoElGimnasio);
  const esRetiro = categoria === RETIRO;
  async function guardar() {
    setEnviando(true); setError(null);
    try {
      await api('/expenses', { method: 'POST', body: JSON.stringify({ category: categoria, description: descripcion.trim(), amountCents: cents!.toString(), month: mes, branchId: sede || null, ...(ajusteEn ? { asAdjustment: true } : {}) }) });
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo registrar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} error={error} title={ajusteEn ? `Ajuste de ${nombreMes(mes)}` : esRetiro ? `Retiro del dueño de ${nombreMes(mes)}` : `Gasto fijo de ${nombreMes(mes)}`}
      sub={ajusteEn ? `${capital(nombreMes(mes))} está cerrado: se anota en ${nombreMes(ajusteEn)}, etiquetado como ajuste.` : esRetiro ? GLOSARIO.retiroDueno.explica : 'Se reparte entre los días del mes al calcular la ganancia.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} disabled={!valido} onClick={() => void guardar()}>{ajusteEn ? 'Anotar ajuste' : 'Registrar'}</Button></>}>
      <div className="stack">
        <Field label="Tipo" htmlFor="gf-c">
          <select id="gf-c" className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {Object.entries(CATEGORIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Descripción" htmlFor="gf-d" hint="Queda en la bitácora con tu nombre.">
          <input id="gf-d" className="input" autoFocus value={descripcion} placeholder={esRetiro ? 'Retiro de la quincena' : 'Renta del local de Centro'} onChange={(e) => setDescripcion(e.target.value)} />
        </Field>
        <div className="grid grid-2 gap-12">
          <Field label={esRetiro ? 'Importe' : 'Importe del mes'} htmlFor="gf-m"><input id="gf-m" className="input num" inputMode="decimal" value={monto} placeholder="25000" onChange={(e) => setMonto(e.target.value)} /></Field>
          <Field label="Sucursal" htmlFor="gf-s">
            <select id="gf-s" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>
              {todoElGimnasio && <option value="">Todo el gimnasio</option>}
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** `ajusteEn`: el gasto es de un mes cerrado; no se anula, se corrige con un ajuste en negativo en ese otro mes (D-22). */
function AnularGasto({ gasto, ajusteEn, onClose, onListo }: { gasto: Gasto; ajusteEn: string | null; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  // El principal queda encendido: si falta el motivo, el campo lo dice (26-02, 26-09; adopción 2.12).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function enviar() {
    setError(null);
    try {
      await api(`/expenses/${gasto.id}/void`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim(), ...(ajusteEn ? { asAdjustment: true } : {}) }) });
      onListo();
    } catch (e) { setError(errorText(e, ajusteEn ? 'No se pudo anotar el ajuste' : 'No se pudo anular')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`${ajusteEn ? 'Corregir' : 'Anular'} ${gasto.description}`}
      sub={ajusteEn
        ? `${pesos(gasto.amountCents)} · su mes está cerrado y no cambia: se anota en ${nombreMes(ajusteEn)} un ajuste por el mismo importe a favor.`
        : `${pesos(gasto.amountCents)} · no se borra: queda tachado y en la bitácora.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(enviar)}>{ajusteEn ? 'Anotar ajuste' : 'Anular'}</Button></>}>
      <CampoMotivo id="ag-m" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} placeholder="Capturado dos veces" />
    </Dialog>
  );
}
