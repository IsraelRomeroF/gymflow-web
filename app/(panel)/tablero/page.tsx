'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Wallet, TrendingUp, Hourglass, Repeat, Landmark, AlertTriangle, Users, Clock, ArrowRight, HeartPulse, Scale, Lock, Rocket } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { comparar, fecha, hora, nombreMes, pesos, ultimoDia } from '@/lib/format';
import { hoyEn } from '@/lib/zonas';
import { useSession } from '@/components/session';
import { Badge, Callout, Card, Empty, ErrorCarga, PageHeader, Segmented, Skeleton, Stat, Button, ButtonLink } from '@/components/ui';
import { useCarga } from '@/lib/carga';
import { Exportar } from '@/components/exportar';
import { CerrarMesDialog, CierresDeMes, useCierresDeMes } from '@/components/cierre-mes';
import { GLOSARIO } from '@/lib/glosario';
import { GlosarioDinero } from '@/components/glosario-dinero';
import type { Dashboard, RetentionSummary } from '@gymflow/core/contracts';

/**
 * El mes `AAAA-MM` de un rango que va del día 1 al día 1 del siguiente, o
 * `null` si el rango no es un mes completo. Si ese mes ya se puede cerrar no
 * lo decide esta pantalla: lo dice la API (`pending` de
 * `/reports/monthly-closes`), que cuenta con la fecha de CADA sede (13-12,
 * bloque 1.9). Antes se comparaba aquí contra la fecha del gimnasio y, con una
 * sucursal en otra zona, el botón salía para que el envío lo rechazara.
 */
function mesDelRango(r: { from: string; to: string }): string | null {
  const from = new Date(`${r.from}T00:00:00Z`); const to = new Date(`${r.to}T00:00:00Z`);
  return from.getUTCDate() === 1 && to.getTime() === Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) ? r.from.slice(0, 7) : null;
}

/**
 * Tablero del dueño.
 *
 * Diseñado primero para el TELÉFONO —el dueño lo abre entre sedes, de pie— y
 * después para la pantalla grande. La primera fila contiene lo que decide
 * (cobrado, ganado, por prestar, recurrente) y todo viene de una sola
 * petición: tres peticiones en una red mala son tres formas de quedar a medias.
 */

type Rango = 'hoy' | '7' | '30' | 'mes' | 'pasado';
const RANGOS: ReadonlyArray<{ value: Rango; label: string }> = [
  { value: 'hoy', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' },
  { value: 'mes', label: 'Este mes' }, { value: 'pasado', label: 'Mes pasado' },
];
/**
 * El periodo como consulta: días hacia atrás, o un mes de calendario completo.
 * `h` es HOY en la zona del gimnasio (13-12): los meses ya no los arma el reloj
 * de la computadora, que en otra zona ganaba o perdía un día en los bordes.
 */
function consulta(r: Rango, h: string): string {
  if (r === 'hoy') return 'days=1';
  if (r === '7' || r === '30') return `days=${r}`;
  const inicio = new Date(`${h.slice(0, 7)}-01T12:00:00Z`);
  if (r === 'mes') {
    const manana = new Date(`${h}T12:00:00Z`); manana.setUTCDate(manana.getUTCDate() + 1);
    // Contra las MISMAS fechas del mes pasado, no contra los días anteriores (UXD-02).
    return `from=${h.slice(0, 7)}-01&to=${manana.toISOString().slice(0, 10)}&compare=mes`;
  }
  const antes = new Date(inicio); antes.setUTCMonth(antes.getUTCMonth() - 1);
  return `from=${antes.toISOString().slice(0, 10)}&to=${inicio.toISOString().slice(0, 10)}&compare=mes`;
}
/** Los gastos llegan en negativo; en la frase "− gastos $X" van sin signo. */
/** "+12 % vs. el periodo anterior": la comparación que pidió la dueña. */
/** Contra qué se compara cada periodo, dicho en palabras (UXD-02). */
const CONTRA: Record<Rango, string> = {
  hoy: 'ayer completo', '7': 'los 7 días anteriores', '30': 'los 30 días anteriores',
  mes: 'el mes pasado a la misma fecha', pasado: 'el mes anterior',
};
function contra(actual: string, antes: string, que = 'el periodo anterior'): string {
  return comparar(actual, antes, que).texto;
}
/** Une las partes de una nota con " · " saltándose las vacías (ambas cifras en cero). */
const nota = (...partes: string[]) => partes.filter(Boolean).join(' · ');

/** El gimnasio recién abierto, sin socios activos: qué hacer primero. */
const PASOS: ReadonlyArray<[string, string, string]> = [
  ['/planes', 'Crear planes', 'Mensualidades, visitas y paquetes que vas a cobrar.'],
  ['/productos', 'Productos', 'Lo que vendes en mostrador: agua, suplementos, toallas.'],
  ['/importar', 'Importar socios', 'Trae tu lista de socios desde una hoja de cálculo.'],
  ['/caja', 'Abrir la caja', 'Con la caja abierta ya puedes cobrar.'],
];

export default function TableroPage() {
  const { branchName, branches, activo, can, org } = useSession();
  // Abre en el mes: es la pregunta de la dueña (UXD-07).
  const [dias, setDias] = useState<Rango>('mes');
  const [cerrar, setCerrar] = useState<string | null>(null);
  const hoy = hoyEn(org.timezone);

  // Una sola carga con sus tres estados (13-18). Al cambiar de rango las cifras
  // se quedan, atenuadas, hasta que llegan las nuevas (UX7 Dirección 10), y la
  // respuesta vieja no pisa a la nueva. Si falla, no quedan a la vista las del
  // rango anterior como si fueran las del nuevo: se dice y se reintenta.
  const cargarTablero = useCallback(() => api<Dashboard>(`/dashboard?${consulta(dias, hoy)}`).catch((e: unknown) => {
    throw e instanceof ApiError && e.status === 403 ? new Error('Tu puesto no ve el tablero financiero.') : e;
  }), [dias, hoy]);
  const tablero = useCarga(cargarTablero, { conservar: true });
  const data = tablero.datos ?? null;
  const cargando = tablero.cargando;
  // Los meses cerrados y los que ya se pueden cerrar, según el servidor (14-04).
  const cierres = useCierresDeMes();
  const mesVisto = data ? mesDelRango(data.range) : null;
  const cierreVisto = mesVisto ? cierres.datos?.closes.find((c) => c.month === mesVisto) : undefined;

  // Quién está por irse: no depende del rango. Si el rol no lo ve, no se muestra.
  const conRetencion = activo('retention');
  // La cifra sale de /retention/summary, que también responde a la dueña
  // (15-01); si falla se dice, no se esconde la tarjeta (13-11).
  const cargarRiesgo = useCallback(() => api<RetentionSummary>('/retention/summary'), []);
  const cargaRiesgo = useCarga(conRetencion ? cargarRiesgo : null);
  const riesgo = cargaRiesgo.datos?.counts ?? null;

  const sedes = (data?.branches ?? []).filter((b) => b.branchId !== null);
  const max = sedes.reduce((m, b) => (BigInt(b.accruedCents) > m ? BigInt(b.accruedCents) : m), 0n);
  // La proporción que importa es en SOCIOS (UX5-D-07): "vencido 100 %" de la
  // cartera solo dice que nadie paga por adelantado, no cuántos se atrasaron.
  const atrasados = data?.portfolio.membersBehind ?? 0;
  const base = data?.portfolio.membersBase ?? 0;
  const tasa = base > 0 ? atrasados / base : 0;
  // Con una sola sucursal el reparto por sede repite el total: no se muestra.
  const variasSedes = branches.length > 1;
  const comparaEntro = data ? contra(data.money.collectedCents, data.previous.collectedCents, CONTRA[dias]) : '';

  return (
    <>
      <PageHeader
        title="Tablero"
        sub="Cuánto entró y cuánto ganaste, por periodo y por sucursal."
        actions={<div className="row gap-8 flex-wrap justify-end">
          {/* Para el contador (DP-06): por sede, lo que entró, lo ganado, la cartera y los socios. */}
          {/* Mientras llega el rango nuevo no se exporta el anterior con el nombre del nuevo (13-08). */}
          <Exportar nombre={`tablero-${dias}`} disabled={!data || cargando} filas={() => [['Del', 'Al', 'Sucursal', 'Entró', 'Ganado (devengado)', 'Por cobrar', 'Socios activos'],
            ...(data?.branches ?? []).map((b) => [data!.range.from, data!.range.to, b.branchId ? branchName(b.branchId) : 'Sin sucursal', (Number(BigInt(b.collectedCents)) / 100).toFixed(2), (Number(BigInt(b.accruedCents)) / 100).toFixed(2), (Number(BigInt(b.outstandingCents)) / 100).toFixed(2), b.activeMembers]),
            ...(data ? [[data.range.from, data.range.to, 'TOTAL', (Number(BigInt(data.money.collectedCents)) / 100).toFixed(2), (Number(BigInt(data.money.accruedCents)) / 100).toFixed(2), (Number(BigInt(data.portfolio.outstandingCents)) / 100).toFixed(2), data.activeMembers]] : [])]} />
          {/* El mes se cierra desde aquí (fase 4): solo un mes completo ya terminado. */}
          {can('reports:month:close') && data && !cargando && !data.closed && mesVisto && cierres.datos?.pending.includes(mesVisto) && (
            <Button variant="secondary" icon={<Lock />} onClick={() => setCerrar(mesVisto)}>Cerrar mes</Button>
          )}
          <Segmented value={dias} onChange={setDias} options={RANGOS} />
        </div>}
      />
      {/* D-22: las cifras de un mes cerrado salen de su foto y ya no cambian. */}
      {data?.closed && (
        <Callout tone="ok" title={`Mes cerrado el ${fecha(data.closed.closedAt)}`}>
          {data.closed.fromSnapshot
            ? 'Sus cifras quedaron fijas al cerrarlo: son las de la foto del cierre. Lo que llegue después se anota en el mes en curso como ajuste.'
            : 'Este cierre es anterior a la foto completa: sus cifras se calculan al momento.'}
          {cierreVisto?.closedByName ? ` Cerró ${cierreVisto.closedByName}${cierreVisto.approvedByName ? ` y firmó ${cierreVisto.approvedByName}` : ''}.` : ''}{data.closed.note ? ` Nota: ${data.closed.note}` : ''}
        </Callout>
      )}
      {/* Lo que llegó tarde a un mes cerrado y se anotó en este periodo, etiquetado (D-22). */}
      {data && data.adjustments.length > 0 && (
        <div data-testid="ajustes-de-meses-cerrados">
          <Callout tone="info" title="Incluye ajustes de meses cerrados">
            {data.adjustments.map((a) => `ajuste de ${nombreMes(a.month)}: ${BigInt(a.cents) < 0n ? `${pesos(-BigInt(a.cents))} a favor` : pesos(a.cents)}`).join(' · ')}.
            {' '}Están dentro de los gastos fijos de este periodo; el detalle, en <Link href="/movimientos">Movimientos</Link>.
          </Callout>
        </div>
      )}
      {cerrar && <CerrarMesDialog month={cerrar} onClose={() => setCerrar(null)} onHecho={() => { setCerrar(null); void tablero.recargar(); void cierres.recargar(); }} />}

      {tablero.error && <ErrorCarga titulo="No se pudo cargar el tablero" mensaje={tablero.error} onReintentar={() => void tablero.recargar()} />}
      <div className="tablero-cifras" data-cargando={(cargando && !!data) || undefined} aria-busy={cargando || undefined}>

      {!tablero.error && (
        <div className="grid grid-4 mb-24">
          {data ? (
            <>
              <Stat icon={<Wallet />} label={GLOSARIO.entro.nombre} value={pesos(data.money.collectedCents, { decimals: false })}
                note={<>Entró menos devoluciones, igual que en <Link href="/movimientos">Movimientos</Link>{comparaEntro && ` · ${comparaEntro}`}</>} />
              <Stat icon={<TrendingUp />} label={GLOSARIO.ganado.nombre} value={pesos(data.money.accruedCents, { decimals: false })}
                note={nota('Servicio ya prestado', contra(data.money.accruedCents, data.previous.accruedCents, CONTRA[dias]))} />
              <Stat feature icon={<Scale />} label={GLOSARIO.utilidad.nombre} value={pesos(data.money.profitCents, { decimals: false })} danger={BigInt(data.money.profitCents) < 0n}
                note={nota(
                  contra(data.money.profitCents, data.previous.profitCents, CONTRA[dias]),
                  // El sobrante no sube la utilidad (13-05): se dice aparte.
                  data.money.cashOverageCents && BigInt(data.money.cashOverageCents) > 0n ? `sobró ${pesos(data.money.cashOverageCents, { decimals: false })} en caja por aclarar (no suma)` : '',
                  // El costo de lo vendido en la tienda ya va restado (D-21); el retiro del dueño no resta (D-23).
                  BigInt(data.money.costOfGoodsCents) < 0n ? `ya resta ${pesos(-BigInt(data.money.costOfGoodsCents), { decimals: false })} de costo de lo vendido` : '',
                  BigInt(data.money.ownerDrawsCents) > 0n ? `retiros del dueño ${pesos(data.money.ownerDrawsCents, { decimals: false })} (no restan)` : '',
                  'en caja quedó otra cifra: ver Movimientos',
                )} />
              <Stat icon={<Hourglass />} label={GLOSARIO.porPrestar.nombre} value={pesos(data.money.deferredCents, { decimals: false })} note={GLOSARIO.porPrestar.explica} />
            </>
          ) : [0, 1, 2, 3].map((i) => <Skeleton key={i} h={112} r={16} />)}
        </div>
      )}
      {data && (
        <div className="glosario-tablero">
          {/* El mismo glosario que Movimientos e Inicio (D-24). */}
          <GlosarioDinero titulo="¿Por qué no coinciden lo que entró y lo ganado?" terminos={['entro', 'ganado', 'porPrestar', 'utilidad', 'costoVendido', 'descuadre', 'retiroDueno', 'ajuste']}>
            Si «{GLOSARIO.porPrestar.nombre}» está en cero, todo lo que entró ya se ganó.
            {data.notes.soldWithoutCost > 0 && ` ${data.notes.soldWithoutCost} ${data.notes.soldWithoutCost === 1 ? 'pieza vendida no tiene' : 'piezas vendidas no tienen'} costo registrado en Productos: su costo no se pudo restar.`}
          </GlosarioDinero>
        </div>
      )}

      {data && (
        <div className={data.activeMembers === 0 || variasSedes || data.notes.warning ? 'grid grid-main' : 'stack'}>
          {(data.activeMembers === 0 || variasSedes || data.notes.warning) && <div className="stack">
            {data.activeMembers === 0 && (
              <Card title={<span className="row gap-6"><Rocket size={16} />Primeros pasos</span>} sub="Mientras no haya socios activos, el tablero se queda en ceros." pad={false}>
                <ul className="list">
                  {PASOS.map(([href, titulo, texto]) => (
                    <li key={href} className="list-item">
                      <div className="flex-1 min-w-0">
                        <Link className="strong row gap-4" href={href}>{titulo} <ArrowRight size={14} /></Link>
                        <p className="tiny muted">{texto}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {variasSedes && <Card title="Ganado por sucursal" sub="Ordenadas por lo ganado, no por lo cobrado." pad={false}>
              {sedes.length === 0 ? <Empty icon={<Landmark />} title="Sin movimientos en el periodo" action={<ButtonLink href="/caja">Ir a la caja</ButtonLink>} /> : (
                <div className="card-body stack">
                  {sedes.map((b) => {
                    const pct = max > 0n ? Number((BigInt(b.accruedCents) * 1000n) / max) / 10 : 0;
                    return (
                      <div key={b.branchId} className="bar-row" title={`${branchName(b.branchId)}: ganado ${pesos(b.accruedCents)} · cobrado ${pesos(b.collectedCents)}`}>
                        <div className="row-between small">
                          <span className="strong">{branchName(b.branchId)}</span>
                          <span className="num strong">{pesos(b.accruedCents, { decimals: false })}</span>
                        </div>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(pct, 1)}%` }} /></div>
                        <div className="row wrap tiny muted gap-14">
                          <span>Cobrado {pesos(b.collectedCents, { decimals: false })}</span>
                          <span className="row gap-4"><Users size={12} />{b.activeMembers.toLocaleString('es-MX')} activos</span>
                          {BigInt(b.outstandingCents) > 0n && <span>Por cobrar {pesos(b.outstandingCents, { decimals: false })}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>}

            {data.notes.warning && <Callout tone="warn" title="Sobre estas cifras">{data.notes.warning}</Callout>}
          </div>}

          <div className="stack">
            <Card title="Cartera">
              <div className="stack-sm">
                <div className="row-between"><span className="muted">{GLOSARIO.porCobrar.nombre}</span><span className="num strong">{pesos(data.portfolio.outstandingCents, { decimals: false })}</span></div>
                {data.portfolio.overdueCents !== data.portfolio.outstandingCents && <div className="row-between"><span className="muted">Ya vencido</span><span className="num strong">{pesos(data.portfolio.overdueCents, { decimals: false })}</span></div>}
                {/* Sin enlaces a pantallas que no son de su puesto (UX5-D-06). */}
                {can('members:read')
                  ? <Link className="small strong row gap-4" href="/socios?adeudo=1">Ver quién debe <ArrowRight size={14} /></Link>
                  : <span className="small muted">El detalle de quién debe lo lleva la gerencia.</span>}
                <div className="row-between"><span className="muted">Socios activos</span><span className="num strong">{data.activeMembers.toLocaleString('es-MX')}</span></div>
                <div className="row-between"><span className="muted row gap-4"><Repeat size={13} />Cobro mensual fijo</span><span className="num strong">{pesos(data.money.mrrCents, { decimals: false })}</span></div>
                {base > 0 && <div className="mt-8" data-testid="socios-atrasados">
                  <div className="row-between small mb-8 gap-8">
                    <span className="strong">{atrasados.toLocaleString('es-MX')} de {base.toLocaleString('es-MX')} socios atrasados</span>
                    <span className="row gap-6">
                      {tasa >= .15 && <AlertTriangle size={14} className="text-danger" />}
                      <span className="num strong">{atrasados === 0 ? '0' : (tasa * 100).toFixed(1)} %</span>
                    </span>
                  </div>
                  <div className={`meter${tasa >= .15 ? ' is-danger' : tasa >= .08 ? ' is-warn' : ''}`}>
                    <div style={{ width: `${Math.min(tasa * 100, 100)}%` }} />
                  </div>
                  <p className="tiny muted mt-6">Con la mensualidad vencida o suspendidos por no pagar. Desde 8 % se marca en ámbar y desde 15 % en rojo.</p>
                </div>}
              </div>
            </Card>

            <Card title={<>Cajas abiertas <Badge>{data.openCashSessions.length}</Badge></>} pad={false}>
              {data.openCashSessions.length === 0
                ? <p className="card-body small muted">Ninguna caja abierta ahora mismo.</p>
                : (
                  <ul className="list">
                    {data.openCashSessions.slice(0, 6).map((s) => (
                      <li key={s.id} className="list-item">
                        <span className="dot dot-live" />
                        <span className="flex-1">{branchName(s.branchId)} · <code>{s.registerCode}</code></span>
                        <span className="tiny muted row gap-4"><Clock size={12} />desde {hora(s.openedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
            {conRetencion && cargaRiesgo.error && (
              <Card title="Socios en riesgo" sub="Dejan de venir semanas antes de dejar de pagar.">
                <ErrorCarga titulo="No se pudo cargar cuántos socios están en riesgo" mensaje="No es que no haya: la cifra no llegó." onReintentar={() => void cargaRiesgo.recargar()} />
              </Card>
            )}
            {conRetencion && riesgo && !cargaRiesgo.error && (
              <Card title="Socios en riesgo" sub="Dejan de venir semanas antes de dejar de pagar.">
                <div className="stack-sm">
                  {([['ONBOARDING_AT_RISK', 'No arrancaron'], ['DORMANT', 'Dejaron de venir'], ['SLIPPING', 'Vienen menos']] as const).map(([k, l]) => (
                    <div key={k} className="row-between"><span className="muted">{l}</span><span className="num strong">{(riesgo[k] ?? 0).toLocaleString('es-MX')}</span></div>
                  ))}
                  <Link className="small strong row gap-4" href="/retencion"><HeartPulse size={14} />A quién llamar hoy <ArrowRight size={14} /></Link>
                </div>
              </Card>
            )}
            <p className="tiny muted">Del {fecha(data.range.from)} al {fecha(ultimoDia(data.range.to))}.</p>
          </div>
        </div>
      )}
      </div>
      {!tablero.error && <CierresDeMes cierres={cierres} onCerrar={setCerrar} />}
    </>
  );
}
