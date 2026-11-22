'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { hoyEn, masDias, zonaDe } from '@/lib/zonas';
import { Check, CircleCheck, Clock, Repeat, Ticket, CalendarDays, Wallet, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { parsePesos } from '@/lib/pesos';
import { fecha, pesos, ultimoDia } from '@/lib/format';
import { MODELO, duracion, porPeriodo, type Plan } from '@/lib/plans';
import { useSession, useToast, errorText, erroresPorCampo } from './session';
import { Badge, Button, Callout, CampoFecha, Dialog, Empty, ErrorCarga, Field, Skeleton, Switch } from './ui';
import { EstadoCarga, useCarga } from '@/lib/carga';
import type { CollectionState, DayPassSaleResult, MemberStatement, RecordPaymentResult } from '@gymflow/core/contracts';
import { CobroFields, cobroListo, cuerpoDelCobro, COBRO_INICIAL, type Cobro, CambioEfectivo } from './cobro';

type Quote = { available: boolean; totalCents: string; lines: Array<{ concept: string; totalCents: string }> };
type Resultado = {
  estado: 'ACTIVE' | 'PENDING'; total: string; periodoFin: string | null; cobrado: boolean; paymentId?: string | null;
  /** Lo que de verdad se cobró y lo que cubrió su saldo a favor (4-18): pueden no sumar el total. */
  cobradoCents?: string | null; creditoCents?: string;
  /** Se vendió un pase del día (1.8): no hay membresía; entra hoy en la sede de venta. */
  pase?: boolean;
};


/**
 * Vender una membresía en tres pasos: plan → resumen y cobro → listo.
 *
 * El total que se ve es el que calcula el servidor con la misma regla que los
 * cargos reales (`/plans/:id/quote`), no una suma hecha aquí: si hubiera
 * impuesto o precio por sucursal, lo cobrado y lo mostrado no podrían diferir.
 */
export function VenderDialog({
  memberId, memberName, homeBranchId, sedeFija, onClose, onDone,
}: {
  memberId: string; memberName: string; homeBranchId: string | null;
  /** «Renovar y abrir» (5-25): la venta es en la sucursal por donde está entrando; no se elige otra. */
  sedeFija?: string;
  onClose: () => void; onDone: () => void;
}) {
  const { branches, can, inScope, org, branchName } = useSession();
  const toast = useToast();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [branchId, setBranchId] = useState(sedeFija ?? (homeBranchId && inScope(homeBranchId) ? homeBranchId : sedes[0]?.id ?? ''));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [paso, setPaso] = useState<0 | 1>(0);
  // «Hoy» es el de la sucursal que vende, no el de la computadora (26-06).
  const hoy = hoyEn(zonaDe(branches.find((b) => b.id === branchId), org));
  const [inicio, setInicio] = useState(hoy);
  // Más de 7 días atrás exige permiso y motivo (MC-10, DM-14); más de 30 adelante no se vende.
  const diaRelativo = (d: number) => masDias(hoy, d);
  const retroactivo = inicio < diaRelativo(-7);
  const [motivoInicio, setMotivoInicio] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const puedeCobrar = can('payments:record');
  // Precio pactado (DM-05): convenio, promoción respetada, precio viejo. Solo quien puede dar descuentos.
  const puedePactar = can('billing:discount:apply');
  const [pactado, setPactado] = useState('');
  const [motivoPrecio, setMotivoPrecio] = useState('');
  const pactadoCents = pactado.trim() === '' ? null : parsePesos(pactado);
  const precioDistinto = pactadoCents !== null && plan !== null && pactadoCents !== BigInt(plan.effectivePriceCents ?? plan.priceCents);
  // Una por venta: el cobro de un paquete va aparte y también la necesita.
  const [claveVenta] = useState(() => crypto.randomUUID());
  const [cobrarAhora, setCobrarAhora] = useState(puedeCobrar);
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<Resultado | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  // Los planes y la cotización con sus tres estados (26-01): sin red ya no es
  // «No hay planes a la venta aquí» ni un total que nunca llega.
  const cargarPlanes = useCallback(() => api<Plan[]>(`/plans?branchId=${branchId}`).then((ps) => ps.filter((p) => p.effectivePriceCents !== null)), [branchId]);
  const planesCarga = useCarga(branchId ? cargarPlanes : null);
  const planes = planesCarga.datos ?? null;

  const cargarCotizacion = useCallback(() => api<Quote>(`/plans/${plan?.id}/quote?branchId=${branchId}`), [plan, branchId]);
  const cotizacion = useCarga(plan ? cargarCotizacion : null);
  const quote = cotizacion.datos ?? null;
  useEffect(() => {
    if (!plan) return;
    // El prepago nace SIN renovarse (D-14): vence y se le vuelve a vender, salvo
    // que aquí se elija lo contrario. El recurrente, lo que diga su plan.
    setAutoRenew(plan.billingModel === 'RECURRING' ? plan.autoRenewDefault : false);
  }, [plan]);

  const cambiarCobro = useCallback((c: Cobro) => setCobro(c), []);

  // La visita suelta es un PASE DEL DÍA (1.8, 4-01): un cargo y la entrada de
  // hoy, sin membresía ni inscripción. Se cobra al venderlo: no queda a deber.
  const esPase = plan?.billingModel === 'DAY_PASS';
  const seCobra = esPase ? puedeCobrar : cobrarAhora;

  async function vender() {
    if (!plan || !quote) return;
    setEnviando(true);
    const pago = seCobra ? cuerpoDelCobro(cobro) : null;
    try {
      if (plan.billingModel === 'DAY_PASS') {
        const r = await api<DayPassSaleResult>(`/members/${memberId}/day-passes`, {
          method: 'POST', body: JSON.stringify({ planId: plan.id, branchId, saleKey: `pase-${claveVenta}`, payment: pago }),
        });
        setListo({
          estado: 'ACTIVE', total: r.pass.amountCents, periodoFin: null, cobrado: true, paymentId: r.payment?.id ?? null,
          cobradoCents: r.payment?.amountCents ?? null, creditoCents: r.creditAppliedCents, pase: true,
        });
      } else if (plan.billingModel === 'VISIT_PACK') {
        // Un paquete no es una membresía por periodo: tiene su propia venta.
        // Venta y cobro en UNA llamada con su clave (UXA-18): si el cobro
        // fallaba, reintentar creaba un segundo paquete.
        const r = await api<{ charge: { id: string; amountCents: string }; payment: { id: string } | null }>(`/members/${memberId}/visit-packs`, {
          method: 'POST', body: JSON.stringify({ planId: plan.id, soldAtBranchId: branchId, saleKey: `paquete-${claveVenta}`, payment: pago }),
        });
        const paymentId = r.payment?.id ?? null;
        setListo({ estado: pago ? 'ACTIVE' : 'PENDING', total: r.charge.amountCents, periodoFin: null, cobrado: !!pago, paymentId });
      } else {
        const r = await api<{ membership: { status: 'ACTIVE' | 'PENDING'; currentPeriodEnd: string }; totalCents: string; creditAppliedCents?: string; payment: { id: string; amountCents: string } | null }>(
          `/members/${memberId}/memberships/sale`,
          {
            method: 'POST',
            body: JSON.stringify({
              planId: plan.id, branchId,
              // Una clave por venta (DM-08): reintentar tras un corte de red devuelve la misma venta.
              saleKey: `venta-${claveVenta}`,
              ...(inicio !== hoy ? { startDate: inicio } : {}),
              ...(precioDistinto ? { agreedPriceCents: pactadoCents!.toString(), reason: motivoPrecio.trim() } : retroactivo ? { reason: motivoInicio.trim() } : {}),
              // Recurrente y prepago dicen si se renuevan (4-02); la visita suelta nunca (4-01).
              ...(plan.billingModel === 'RECURRING' || plan.billingModel === 'PREPAID_PERIOD' ? { autoRenew } : {}),
              payment: pago,
            }),
          },
        );
        setListo({
          estado: r.membership.status, total: r.totalCents, periodoFin: r.membership.currentPeriodEnd,
          // Con saldo a favor, lo cobrado es menos que el total: se dice lo que salió de la bolsa del socio.
          cobrado: !!r.payment || r.membership.status === 'ACTIVE', paymentId: r.payment?.id ?? null,
          cobradoCents: r.payment?.amountCents ?? null, creditoCents: r.creditAppliedCents ?? '0',
        });
      }
    } catch (e) {
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo completar la venta'));
    } finally {
      setEnviando(false);
    }
  }

  // Con precio pactado, el total cambia: la cuota del primer periodo va al pactado.
  const totalConPacto = quote && precioDistinto && plan
    ? (BigInt(quote.totalCents) - BigInt(plan.effectivePriceCents ?? plan.priceCents) + pactadoCents!).toString()
    : quote?.totalCents ?? '0';

  if (listo) {
    return (
      <Dialog open onClose={onDone} title="Venta registrada">
        <div className="empty py-8">
          <div className="empty-icon" style={listo.cobrado
            ? { background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'var(--ok-line)' }
            : { background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'var(--warn-line)' }}>
            {listo.cobrado ? <CircleCheck /> : <Clock />}
          </div>
          <p className="empty-title">
            {listo.pase ? `${memberName} entra hoy con su pase del día`
              : listo.cobrado ? `${memberName} ya puede entrar` : `${plan?.name} vendida, pendiente de pago`}
          </p>
          <p className="empty-text">
            {listo.cobrado
              ? `${listo.cobradoCents ? `Se cobraron ${pesos(listo.cobradoCents)}.` : listo.creditoCents && BigInt(listo.creditoCents) > 0n ? '' : `Se cobraron ${pesos(listo.total)}.`}${listo.creditoCents && BigInt(listo.creditoCents) > 0n ? ` Su saldo a favor cubrió ${pesos(listo.creditoCents)}.` : ''}${listo.periodoFin ? ` Vigente hasta el ${fecha(ultimoDia(listo.periodoFin))}.` : ''}${listo.pase ? ` Vale hoy en ${branchName(branchId)}: no es una membresía y no se renueva.` : ''}`
              : `Queda un saldo de ${pesos((BigInt(listo.total) - BigInt(listo.creditoCents ?? '0')).toString())}. En cuanto se cobre desde el estado de cuenta, la membresía se activa.`}
          </p>
        </div>
        <div className="row gap-8 mt-12">
          {listo.paymentId && <a className="btn btn-secondary flex-1" href={`/recibo/${listo.paymentId}`} target="_blank" rel="noreferrer"><Printer />Comprobante</a>}
          <Button onClick={onDone} style={{ flex: 1 }}>Listo</Button>
        </div>
      </Dialog>
    );
  }

  const agrupados = (['RECURRING', 'PREPAID_PERIOD', 'VISIT_PACK', 'DAY_PASS'] as const)
    .map((m) => ({ modelo: m, planes: (planes ?? []).filter((p) => p.billingModel === m) }))
    .filter((g) => g.planes.length > 0);

  return (
    <Dialog
      open size="lg" onClose={() => { if (!enviando) onClose(); }}
      title={`Vender a ${memberName}`}
      sub={paso === 0 ? 'Elige el plan. El precio es el de la sucursal donde se vende.' : 'Revisa y cobra.'}
      footer={
        <>
          {paso === 1 && <Button variant="ghost" onClick={() => setPaso(0)} disabled={enviando}>Atrás</Button>}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          {paso === 0
            ? <Button onClick={() => setPaso(1)} disabled={!plan}>Continuar</Button>
            : <Button icon={cobrarAhora ? <Wallet /> : <Check />} loading={enviando}
                disabled={!quote?.available || (esPase ? !puedeCobrar || !cobroListo(cobro)
                  : !inicio || (retroactivo && motivoInicio.trim().length < 3) || (precioDistinto && motivoPrecio.trim().length < 3) || (pactado.trim() !== '' && pactadoCents === null) || (cobrarAhora && !cobroListo(cobro)))} onClick={() => void vender()}>
                {seCobra && quote ? `Cobrar ${pesos(esPase ? quote.totalCents : totalConPacto)}` : esPase ? 'Cobrar el pase' : 'Vender sin cobrar'}
              </Button>}
        </>
      }
    >
      <div className="steps">
        {['Plan', 'Resumen y cobro'].map((p, i) => (
          <div key={p} className="step" data-state={i < paso ? 'done' : i === paso ? 'current' : 'todo'}>
            <div className="step-bar" /><span className="step-label">{i + 1}. {p}</span>
          </div>
        ))}
      </div>

      {paso === 0 && (
        <div className="stack">
          {sedes.length > 1 && !sedeFija && (
            <Field label="Sucursal de venta" htmlFor="sede">
              <select id="sede" className="select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPlan(null); }}>
                {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <EstadoCarga carga={planesCarga} titulo="No se pudieron cargar los planes" esqueleto={<div className="stack-sm"><Skeleton h={64} /><Skeleton h={64} /></div>}
            vacio={<Empty icon={<Ticket />} title="No hay planes a la venta aquí" text="Pide a dirección que active o cree planes en el catálogo." />}>
            {() => agrupados.map((g) => (
                <div key={g.modelo}>
                  <p className="label mb-8">{MODELO[g.modelo].label}</p>
                  <div className="choice-grid">
                    {g.planes.map((p) => (
                      <button key={p.id} type="button" className="choice" aria-pressed={plan?.id === p.id} onClick={() => setPlan(p)}>
                        <span className="choice-icon">{p.billingModel === 'RECURRING' ? <Repeat /> : p.billingModel === 'VISIT_PACK' ? <Ticket /> : <CalendarDays />}</span>
                        <span className="flex-1 min-w-0">
                          <span className="row-between" style={{ alignItems: 'baseline' }}>
                            <span className="choice-title">{p.name}</span>
                            <span className="strong num" style={{ fontSize: 15 }}>{pesos(p.effectivePriceCents ?? p.priceCents, { decimals: false })}<span className="tiny muted"> {porPeriodo(p)}</span></span>
                          </span>
                          <span className="choice-text block">
                            {duracion(p)}{BigInt(p.signupFeeCents) > 0n && p.billingModel !== 'VISIT_PACK' && p.billingModel !== 'DAY_PASS' ? ` · inscripción ${pesos(p.signupFeeCents, { decimals: false })}` : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </EstadoCarga>
        </div>
      )}

      {paso === 1 && plan && (
        <div className="stack">
          <div className="card shadow-none">
            <div className="card-body stack-sm">
              <div className="row-between">
                <span className="strong">{plan.name}</span>
                <Badge>{MODELO[plan.billingModel].label}</Badge>
              </div>
              {cotizacion.error ? <ErrorCarga titulo="No se pudo calcular el total" mensaje={cotizacion.error} onReintentar={() => void cotizacion.recargar()} />
                : !quote ? <Skeleton h={60} /> : !quote.available ? (
                <Callout tone="warn">Este plan no está disponible en la sucursal elegida.</Callout>
              ) : (
                <>
                  {quote.lines.map((l) => (
                    <div key={l.concept} className="row-between small"><span className="muted">{l.concept}</span><span className="num">{pesos(l.totalCents)}</span></div>
                  ))}
                  {precioDistinto && <div className="row-between small"><span className="muted">Precio pactado en vez del de lista</span><span className="num">{pesos(pactadoCents!)}</span></div>}
                  <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }}>
                    <span className="strong">Total</span>
                    <span className="strong num" style={{ fontSize: 22 }}>{pesos(totalConPacto)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {esPase && (
            <Callout tone="info" title="Pase del día">
              Vale hoy en {branchName(branchId)}. No es una membresía: no se renueva, no lleva inscripción y mañana no queda nada por cobrar.
            </Callout>
          )}
          {plan.billingModel !== 'VISIT_PACK' && !esPase && (
            <div className="grid grid-2 gap-12">
              <Field label="Inicia" htmlFor="ini" required hint="El periodo y el día de corte se cuentan desde aquí."
                error={!inicio ? 'Elige la fecha en que empieza.' : errores.startDate}>
                <CampoFecha id="ini" value={inicio} hoy={hoy} min={can('payments:backdate') ? undefined : diaRelativo(-7)} max={diaRelativo(30)} aria-invalid={!inicio || !!errores.startDate} onChange={(v) => { setInicio(v); setErrores({}); }} />
              </Field>
              {retroactivo && (
                <Field label="Motivo del inicio retroactivo" htmlFor="ini-motivo" required error={errores.reason} hint="Empieza hace más de 7 días: mueve la vigencia, el corte y los ingresos del mes.">
                  <input id="ini-motivo" className="input" value={motivoInicio} onChange={(e) => setMotivoInicio(e.target.value)} placeholder="Migración tardía, pagó la semana pasada…" />
                </Field>
              )}
              {puedePactar && (
                <Field label="Precio pactado por periodo" htmlFor="pactado" hint="Opcional. Queda escrito en la membresía: sus cuotas se cobran a este precio aunque el de lista cambie." error={errores.agreedPriceCents}>
                  <input id="pactado" className="input num" inputMode="decimal" placeholder={pesos(plan.effectivePriceCents ?? plan.priceCents)} value={pactado} onChange={(e) => setPactado(e.target.value)} />
                </Field>
              )}
              {precioDistinto && (
                <Field label="Motivo del precio pactado" htmlFor="pactado-motivo" required error={errores.reason}>
                  <input id="pactado-motivo" className="input" value={motivoPrecio} onChange={(e) => setMotivoPrecio(e.target.value)} placeholder="Convenio con su empresa, promoción de apertura…" />
                </Field>
              )}
              {plan.billingModel === 'RECURRING' && (
                <div className="field">
                  <span className="label">Renovación</span>
                  <div className="mt-10"><Switch checked={autoRenew} onChange={(v) => setAutoRenew(v)}>Se renueva sola cada periodo</Switch></div>
                </div>
              )}
              {/* El prepago se ve y se elige (4-02); por omisión NO se renueva (D-14). */}
              {plan.billingModel === 'PREPAID_PERIOD' && (
                <div className="field">
                  <span className="label">Renovación</span>
                  <div className="mt-10"><Switch checked={autoRenew} onChange={(v) => setAutoRenew(v)}>Se renueva sola al terminar</Switch></div>
                  <p className="tiny muted mt-6">{autoRenew ? 'Al terminar se le cobra otro periodo igual.' : 'Al terminar vence y se le vuelve a vender.'}</p>
                </div>
              )}
            </div>
          )}

          {puedeCobrar && !esPase && (
            <Switch checked={cobrarAhora} onChange={(v) => setCobrarAhora(v)}><strong>Cobrar ahora.</strong> Si no, la membresía queda pendiente y se activa cuando se pague.</Switch>
          )}
          {esPase && !puedeCobrar && (
            <Callout tone="warn">El pase del día se cobra al venderlo: lo vende quien puede cobrar en esta sucursal.</Callout>
          )}
          {seCobra && <CobroFields branchId={branchId} value={cobro} onChange={cambiarCobro} errores={errores} />}
          {seCobra && cobro.method === 'CASH' && quote?.available && <CambioEfectivo totalCents={BigInt(esPase ? quote.totalCents : totalConPacto)} />}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Cobrar un saldo pendiente. El pago se aplica al cargo más antiguo, y si
 * liquida la cuota de una membresía pendiente o suspendida, la activa.
 */
/** Lo que el estado de cuenta dice para cobrar (4-09, 4-18): contrato del núcleo. */
type ParaCobrar = Pick<MemberStatement, 'outstandingCents' | 'creditCents' | 'cobro'>;
/** El veredicto que devuelve el cobro: si ya entra y hasta dónde quedó pagado. */
type Veredicto = CollectionState;

export function CobrarDialog({
  memberId, memberName, branchIds, saldoCents, onClose, onDone,
}: {
  memberId: string; memberName: string;
  /** Sucursales donde se puede cobrar, la preferida primero (ver la ficha). */
  branchIds: string[];
  /** Lo que se propone cobrar: el adeudo NETO de su saldo a favor (4-18). */
  saldoCents: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { branchName, can } = useSession();
  const [branchId, setBranchId] = useState(branchIds[0] ?? '');
  const [monto, setMonto] = useState((Number(BigInt(saldoCents)) / 100).toFixed(2));
  const [tocado, setTocado] = useState(false);
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ id: string; folio: string | null; monto: string; credito: string; veredicto: Veredicto } | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  // UNA clave por cobro, fija mientras el diálogo esté abierto: si la red
  // falla después de que el servidor registró el pago, reintentar devuelve
  // ese mismo pago en lugar de cobrar otra vez.
  const [clave] = useState(() => crypto.randomUUID());
  const cambiarCobro = useCallback((c: Cobro) => setCobro(c), []);

  // Ficha y Caja proponen LA MISMA cifra (4-18): el adeudo menos lo que tiene
  // a favor, que se aplica primero. Y lo que falta para que vuelva a entrar.
  // Si no responde, se dice: el cobro sigue con la cifra de la ficha, pero sin
  // saber si con él vuelve a entrar (26-01).
  const cargarCuenta = useCallback(() => api<ParaCobrar>(`/members/${memberId}/statement`), [memberId]);
  const cuentaCarga = useCarga(can('billing:statement:read') ? cargarCuenta : null);
  const cuenta = cuentaCarga.datos ?? null;
  const neto = cuenta ? (() => { const n = BigInt(cuenta.outstandingCents) - BigInt(cuenta.creditCents); return n > 0n ? n : 0n; })() : null;
  // `tocadoRef`: lo que se teclea justo cuando llega el estado de cuenta no se pisa
  // (el efecto de ese render todavía veía `tocado` en falso y reponía la cifra).
  const tocadoRef = useRef(false);
  useEffect(() => {
    if (neto !== null && neto > 0n && !tocado && !tocadoRef.current) setMonto((Number(neto) / 100).toFixed(2));
  }, [neto, tocado]);

  const centavos = parsePesos(monto);
  const debeAhora = neto ?? BigInt(saldoCents);
  const aFavor = cuenta ? BigInt(cuenta.creditCents) : 0n;
  // ¿Con este abono entra? La misma regla que el servidor: si no le alcanza, se dice ANTES de cobrar (4-09).
  const fuera = cuenta?.cobro?.membership && !cuenta.cobro.membership.canEnter && cuenta.cobro.toEnterCents !== null ? BigInt(cuenta.cobro.toEnterCents) : null;

  async function cobrar() {
    if (!centavos || centavos <= 0n) return;
    setEnviando(true);
    try {
      const r = await api<RecordPaymentResult>(`/members/${memberId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: centavos.toString(), branchId, ...cuerpoDelCobro(cobro),
          idempotencyKey: `cobro-${clave}`,
        }),
      });
      setHecho({
        id: r.payment.id, folio: r.payment.folio, monto: centavos.toString(), credito: r.creditAppliedCents,
        veredicto: { membership: r.membership, toEnterCents: r.toEnterCents },
      });
    } catch (e) {
      // El error va en el campo que falló; el aviso solo si no es de un campo.
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo cobrar'));
    } finally {
      setEnviando(false);
    }
  }

  if (hecho) {
    const m = hecho.veredicto.membership;
    return (
      <Dialog open onClose={onDone} title="Cobro registrado">
        <div className="empty py-8">
          <div className="empty-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'var(--ok-line)' }}><CircleCheck /></div>
          <p className="empty-title">Cobrados {pesos(hecho.monto)}</p>
          <p className="empty-text">
            {hecho.folio ? <>Folio <code>{hecho.folio}</code>. </> : null}Se aplicó a lo más antiguo primero.
            {BigInt(hecho.credito) > 0n && <> Además se usaron {pesos(hecho.credito)} de su saldo a favor.</>}
          </p>
        </div>
        {/* El resultado dice si ya entra (4-09): el abono que no alcanza no se descubre en la puerta. */}
        {m && (m.canEnter
          ? <Callout tone="ok" title={`${memberName} ya puede entrar`}>{m.paidThrough ? `Pagado hasta el ${fecha(m.paidThrough)}.` : null}</Callout>
          : hecho.veredicto.toEnterCents && BigInt(hecho.veredicto.toEnterCents) > 0n
            ? <Callout tone="warn" title="Todavía no puede entrar">Le faltan {pesos(hecho.veredicto.toEnterCents)} para quedar al corriente.{m.paidThrough ? ` Pagado hasta el ${fecha(m.paidThrough)}.` : ''}</Callout>
            : null)}
        <div className="row gap-8 mt-12">
          <a className="btn btn-secondary flex-1" href={`/recibo/${hecho.id}`} target="_blank" rel="noreferrer"><Printer />Comprobante</a>
          <Button onClick={onDone} style={{ flex: 1 }}>Listo</Button>
        </div>
      </Dialog>
    );
  }

  return (
    // Mientras el cobro va en vuelo no se cierra: reabrir generaría otra clave y podría cobrar dos veces (MC-30).
    <Dialog open onClose={() => { if (!enviando) onClose(); }} title={`Cobrar a ${memberName}`}
      sub={aFavor > 0n && cuenta
        ? `Debe ${pesos(cuenta.outstandingCents)} y tiene ${pesos(aFavor)} a favor, que se aplica primero: quedan ${pesos(debeAhora)}.`
        : `Debe ${pesos(debeAhora)}. Se aplica a lo más antiguo primero.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<Wallet />} loading={enviando} disabled={!branchId || !centavos || centavos <= 0n || !cobroListo(cobro)} onClick={() => void cobrar()}>
          {centavos ? `Cobrar ${pesos(centavos)}` : 'Cobrar'}
        </Button></>}>
      <div className="stack">
        {branchIds.length === 0 && (
          <Callout tone="warn">No tienes acceso a ninguna sucursal donde cobrarle a este socio.</Callout>
        )}
        {cuentaCarga.error && (
          <ErrorCarga titulo="No se pudo revisar su estado de cuenta" mensaje="El importe es el de su ficha. Sin el estado de cuenta no se sabe si con este cobro vuelve a entrar." onReintentar={() => void cuentaCarga.recargar()} />
        )}
        {branchIds.length > 1 && (
          <Field label="Sucursal" htmlFor="sede-cobro" error={errores.branchId}>
            <select id="sede-cobro" className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branchIds.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Importe" htmlFor="monto" required
          error={monto.trim() !== '' && (!centavos || centavos <= 0n) ? 'Escribe un importe en pesos, por ejemplo 650 o 650.50.' : errores.amountCents}
          hint={centavos && centavos > debeAhora ? 'Lo que exceda el adeudo queda a favor del socio.' : undefined}>
          <div className="input-icon"><span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>$</span>
            <input id="monto" className="input num" inputMode="decimal" style={{ paddingLeft: 28 }} value={monto} aria-invalid={monto.trim() !== '' && (!centavos || centavos <= 0n) ? true : undefined}
              onChange={(e) => { tocadoRef.current = true; setTocado(true); setMonto(e.target.value); setErrores((x) => { const n = { ...x }; delete n.amountCents; return n; }); }} />
          </div>
        </Field>
        {/* El abono que no alcanza lo dice (4-09): se acepta, pero nunca a ciegas. */}
        {fuera !== null && centavos && centavos > 0n && (centavos < fuera
          ? <Callout tone="warn" title="Con ese abono sigue sin poder entrar">Para volver a entrar hoy necesita {pesos(fuera)}. El abono se registra y queda debiendo {pesos(fuera - centavos)}.</Callout>
          : <Callout tone="ok">Con este cobro queda al corriente y puede entrar.</Callout>)}
        {branchId && <CobroFields branchId={branchId} value={cobro} onChange={cambiarCobro} errores={errores} />}
        {/* El cobro de mensualidad es el más grande del mostrador: "Paga con / Cambio" también aquí (MC-03). */}
        {branchId && cobro.method === 'CASH' && centavos && centavos > 0n && <CambioEfectivo totalCents={centavos} />}
      </div>
    </Dialog>
  );
}
