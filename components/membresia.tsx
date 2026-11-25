'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ArrowLeftRight, Snowflake, Sun, Ban, CircleCheck, Wallet, CalendarClock, Eraser, Repeat } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fecha, pesos, ultimoDia } from '@gymflow/ui/format';
import { duracion, porPeriodo, type Plan } from '@/lib/plans';
import { useSession, useToast, errorText } from './session';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { Button, Callout, CampoMotivo, Dialog, ErrorCarga, Field, Skeleton, Switch, faltaMotivo } from './ui';
import { EstadoCarga, useCarga } from '@gymflow/ui/carga';
import { CobroFields, cobroListo, cuerpoDelCobro, COBRO_INICIAL, type Cobro } from './cobro';
import { AutorizacionDialog } from './autorizacion';
import { AdeudoAlCerrar } from './ficha/adeudo';

export type Membresia = {
  id: string; planId: string; status: string; soldAtBranchId: string | null;
  currentPeriodStart: string; currentPeriodEnd: string; coveredThrough: string | null;
  autoRenew: boolean; frozenUntil: string | null; frozenDaysUsedThisYear?: number;
  /** Último día que cubren sus cuotas PAGADAS (3-01). No es la vigencia del periodo. */
  paidThrough?: string | null;
  /** De una suspendida: periodos que no recorrió. Sin atrasos no hay adeudo que decidir (4-08). */
  missedPeriods?: number | null;
  /** De quién es: lo trae la API; lo usa el aviso del adeudo al cancelar (D-12). */
  memberId?: string;
  /** Lo que paga por periodo y si «conserva su precio» (D-19; bloque 3.5). */
  periodPriceCents?: string;
  priceProtected?: boolean;
  priceProtectedReason?: string | null;
};

type Accion = 'adeudo' | 'renovar' | 'cambiar' | 'congelar' | 'descongelar' | 'cancelar' | 'renovacion';

/**
 * Lo que se puede hacer con la membresía, según su estado y los permisos.
 *
 * Solo se ofrece lo que la máquina de estados permite: un botón que la API
 * va a rechazar es peor que no tenerlo.
 */
export function AccionesMembresia({
  membresia, plan, memberName, onDone, deudaCents = '0', onCobrar,
}: {
  membresia: Membresia; plan: Plan | null; memberName: string; onDone: () => void;
  /** Lo que debe de ESTA membresía (cuota, inscripción): con algo abierto, primero se cobra (4-06). */
  deudaCents?: string;
  /** Abre el cobro de la ficha. */
  onCobrar?: () => void;
}) {
  const { can } = useSession();
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const s = membresia.status;
  const cerrar = () => setAbierta(null);
  const listo = () => { setAbierta(null); onDone(); };
  const debe = BigInt(deudaCents) > 0n;

  const botones: Array<{ a: Accion; label: string; icon: React.ReactNode; show: boolean; variant?: 'danger-ghost' }> = [
    // Solo con meses atrasados hay algo que decidir (4-08); con el periodo en curso basta con cobrar.
    { a: 'adeudo', label: 'Decidir adeudo', icon: <CalendarClock />, show: s === 'SUSPENDED' && (membresia.missedPeriods ?? 0) > 0 && can('billing:charge:create') },
    // Con la cuota abierta, «Renovar» cobraría el periodo siguiente encima: primero se cobra (4-06).
    { a: 'renovar', label: 'Renovar', icon: <RefreshCw />, show: s === 'ACTIVE' && !debe && can('memberships:create') },
    { a: 'cambiar', label: 'Cambiar de plan', icon: <ArrowLeftRight />, show: s === 'ACTIVE' && can('memberships:change_plan') },
    { a: 'congelar', label: 'Congelar', icon: <Snowflake />, show: s === 'ACTIVE' && !!plan?.allowFreeze && can('memberships:freeze') },
    { a: 'descongelar', label: 'Descongelar', icon: <Sun />, show: s === 'FROZEN' && can('memberships:freeze') },
    // D-14 (bloque 3.5): si al terminar se le cobra otro periodo igual o vence y se le vuelve a vender. Se eligió al vender; aquí se cambia.
    { a: 'renovacion', label: membresia.autoRenew ? 'Que no se renueve sola' : 'Que se renueve sola', icon: <Repeat />,
      show: ['ACTIVE', 'PAST_DUE', 'FROZEN'].includes(s) && !!plan && ['RECURRING', 'PREPAID_PERIOD'].includes(plan.billingModel) && can('memberships:change_plan') },
    { a: 'cancelar', label: 'Cancelar', icon: <Ban />, variant: 'danger-ghost', show: !['CANCELED', 'EXPIRED'].includes(s) && can('memberships:cancel') },
  ];
  const visibles = botones.filter((b) => b.show);
  const cobrarPrimero = s === 'ACTIVE' && debe && !!onCobrar && can('payments:record');
  if (visibles.length === 0 && !cobrarPrimero) return null;

  return (
    <>
      <div className="row wrap gap-8">
        {cobrarPrimero && <Button size="sm" icon={<Wallet />} onClick={onCobrar}>Cobrar {pesos(deudaCents)}</Button>}
        {visibles.filter((b) => b.a !== 'cancelar').map((b) => (
          <Button key={b.a} size="sm" variant={b.variant ?? 'secondary'} icon={b.icon} onClick={() => setAbierta(b.a)}>{b.label}</Button>
        ))}
        {/* Apartada a la derecha y discreta: es irreversible y no es del día a día. */}
        {visibles.some((b) => b.a === 'cancelar') && <>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<Ban />} onClick={() => setAbierta('cancelar')}>Cancelar membresía</Button>
        </>}
      </div>
      {abierta === 'adeudo' && <DecidirAdeudo m={membresia} nombre={memberName} onClose={cerrar} onDone={listo} />}
      {abierta === 'renovar' && <Renovar m={membresia} plan={plan} nombre={memberName} onClose={cerrar} onDone={listo} />}
      {abierta === 'cambiar' && <CambiarPlan m={membresia} plan={plan} nombre={memberName} onClose={cerrar} onDone={listo}
        deudaCents={deudaCents} onCobrar={onCobrar ? () => { setAbierta(null); onCobrar(); } : undefined} />}
      {abierta === 'congelar' && plan && <Congelar m={membresia} plan={plan} nombre={memberName} onClose={cerrar} onDone={listo} />}
      {abierta === 'descongelar' && <Descongelar m={membresia} nombre={memberName} onClose={cerrar} onDone={listo} />}
      {abierta === 'cancelar' && <Cancelar m={membresia} nombre={memberName} onClose={cerrar} onDone={listo} />}
      {abierta === 'renovacion' && <CambiarRenovacion m={membresia} plan={plan} nombre={memberName} onClose={cerrar} onDone={listo} />}
    </>
  );
}

type Props = { m: Membresia; nombre: string; onClose: () => void; onDone: () => void };

/** "Cobrar ahora" + cómo. Compartido por renovar y cambiar de plan. */
function useCobro(branchId: string | null) {
  const { can } = useSession();
  const puede = can('payments:record') && !!branchId;
  const [ahora, setAhora] = useState(puede);
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const onChange = useCallback((c: Cobro) => setCobro(c), []);
  const payload = ahora ? cuerpoDelCobro(cobro) : null;
  const ui = (
    <>
      {puede && (
        <Switch checked={ahora} onChange={(v) => setAhora(v)}><strong>Cobrar ahora.</strong> Si no, el cargo queda pendiente en su estado de cuenta.</Switch>
      )}
      {ahora && branchId && <CobroFields branchId={branchId} value={cobro} onChange={onChange} />}
    </>
  );
  return { ui, payload, listo: !ahora || cobroListo(cobro), ahora };
}

function Renovar({ m, plan, nombre, onClose, onDone }: Props & { plan: Plan | null }) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const cobro = useCobro(m.soldAtBranchId);

  // Renovar cobra el periodo, no la inscripción: la última línea. Sin respuesta
  // ya no es un esqueleto eterno: se dice y se reintenta (26-01).
  const cargarTotal = useCallback(() => api<{ lines: Array<{ totalCents: string }> }>(`/plans/${plan?.id}/quote${m.soldAtBranchId ? `?branchId=${m.soldAtBranchId}` : ''}`)
    .then((q) => q.lines.at(-1)?.totalCents ?? null), [plan, m.soldAtBranchId]);
  const cotizacion = useCarga(plan ? cargarTotal : null);
  const total = cotizacion.datos ?? null;

  async function renovar() {
    setEnviando(true);
    try {
      const r = await api<{ membership: { currentPeriodEnd: string }; payment: unknown }>(`/memberships/${m.id}/renewal`, {
        // El periodo que se ve en pantalla: si la renovación ya se aplicó (un
        // doble clic, un reintento), el servidor responde 409 y no cobra otro.
        method: 'POST', body: JSON.stringify({ payment: cobro.payload, expectedPeriodStart: m.currentPeriodStart.slice(0, 10) }),
      });
      toast('ok', `Renovada hasta el ${fecha(ultimoDia(r.membership.currentPeriodEnd))}${r.payment ? ' y cobrada' : '; el cargo quedó pendiente'}.`);
      onDone();
    } catch (e) { toast('error', errorText(e, 'No se pudo renovar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Renovar a ${nombre}`} sub="Por adelantado: el periodo nuevo empieza cuando termina el actual."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={cobro.ahora ? <Wallet /> : <RefreshCw />} loading={enviando} disabled={!cobro.listo} onClick={() => void renovar()}>
          {cobro.ahora && total ? `Renovar y cobrar ${pesos(total)}` : 'Renovar'}
        </Button></>}>
      <div className="stack">
        <div className="card card-pad shadow-none">
          <div className="row-between small"><span className="muted">Plan</span><span className="strong">{plan?.name ?? '—'}</span></div>
          <div className="row-between small mt-6"><span className="muted">Vigente hasta el</span><span>{fecha(m.coveredThrough ?? ultimoDia(m.currentPeriodEnd))}</span></div>
          <div className="row-between" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <span className="strong">Siguiente periodo</span>
            <span className="strong num" style={{ fontSize: 20 }}>{total ? pesos(total) : cotizacion.error ? '—' : <Skeleton h={20} w={80} />}</span>
          </div>
        </div>
        {cotizacion.error && <ErrorCarga titulo="No se pudo calcular el siguiente periodo" mensaje={cotizacion.error} onReintentar={() => void cotizacion.recargar()} />}
        {cobro.ui}
      </div>
    </Dialog>
  );
}

function CambiarPlan({ m, plan, nombre, onClose, onDone, deudaCents = '0', onCobrar }: Props & { plan: Plan | null; deudaCents?: string; onCobrar?: (() => void) | undefined }) {
  const toast = useToast();
  const [destino, setDestino] = useState<Plan | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ credito: string; aFavor: string; cargo: string; pagado: boolean } | null>(null);
  const cobro = useCobro(m.soldAtBranchId);
  const debe = BigInt(deudaCents) > 0n;

  // Destinos válidos: recurrente y pago anticipado (4-05). Una visita suelta o un paquete se venden aparte.
  // Sin red no es «No hay otros planes» (26-01).
  const cargarPlanes = useCallback(() => api<Plan[]>(`/plans${m.soldAtBranchId ? `?branchId=${m.soldAtBranchId}` : ''}`)
    .then((ps) => ps.filter((p) => p.id !== m.planId && p.billingModel !== 'VISIT_PACK' && p.billingModel !== 'DAY_PASS' && p.effectivePriceCents !== null)), [m.planId, m.soldAtBranchId]);
  const planesCarga = useCarga(cargarPlanes);

  async function cambiar() {
    if (!destino) return;
    setEnviando(true);
    try {
      const r = await api<{ creditCents: string; creditToBalanceCents?: string; charge: { amountCents: string; adjustedCents: string; allocatedCents: string }; payment: unknown }>(
        `/memberships/${m.id}/plan-change`,
        { method: 'POST', body: JSON.stringify({ planId: destino.id, reason: motivo.trim(), payment: cobro.payload }) },
      );
      setHecho({
        credito: r.creditCents,
        aFavor: r.creditToBalanceCents ?? '0',
        cargo: (BigInt(r.charge.amountCents) - BigInt(r.charge.adjustedCents)).toString(),
        pagado: !!r.payment,
      });
    } catch (e) { toast('error', errorText(e, 'No se pudo cambiar el plan')); } finally { setEnviando(false); }
  }

  if (hecho) {
    return (
      <Dialog open onClose={onDone} title="Plan cambiado">
        <div className="empty py-8">
          <div className="empty-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'var(--ok-line)' }}><CircleCheck /></div>
          <p className="empty-title">{nombre} ahora tiene {destino?.name}</p>
          <p className="empty-text">
            {BigInt(hecho.credito) > 0n && <>Se le acreditaron {pesos(hecho.credito)} de lo que ya había pagado. </>}
            {/* Lo que sobra al bajar de plan es suyo: queda a su favor (4-05). */}
            {BigInt(hecho.aFavor) > 0n && <>Le quedan {pesos(hecho.aFavor)} a su favor para sus siguientes pagos. </>}
            {BigInt(hecho.cargo) <= 0n ? 'No hay nada que cobrar.' : hecho.pagado ? `Se cobraron ${pesos(hecho.cargo)}.` : `Quedaron ${pesos(hecho.cargo)} pendientes en su estado de cuenta.`}
          </p>
        </div>
        <Button block onClick={onDone} className="mt-12">Listo</Button>
      </Dialog>
    );
  }

  return (
    <Dialog open size="lg" onClose={onClose} title={`Cambiar el plan de ${nombre}`}
      sub={`Hoy tiene ${plan?.name ?? 'su plan'}. El plan nuevo empieza hoy; lo pagado y no usado se le acredita y, si sobra, queda a su favor.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<ArrowLeftRight />} loading={enviando} disabled={debe || !destino || motivo.trim().length < 3 || !cobro.listo} onClick={() => void cambiar()}>
          {cobro.ahora ? 'Cambiar y cobrar' : 'Cambiar de plan'}
        </Button></>}>
      <div className="stack">
        {debe && (
          <Callout tone="warn" title={`Primero se cobran ${pesos(deudaCents)}`}>
            Tiene una cuota de su membresía sin pagar: cambiar de plan ahora dejaría esa cuota abierta junto a la nueva.
            {onCobrar && <div className="mt-8"><Button size="sm" icon={<Wallet />} onClick={onCobrar}>Cobrar {pesos(deudaCents)}</Button></div>}
          </Callout>
        )}
        <EstadoCarga carga={planesCarga} titulo="No se pudieron cargar los planes" esqueleto={<Skeleton h={120} />}
          vacio={<Callout tone="info">No hay otros planes a la venta en esta sucursal.</Callout>}>
          {(planes) => (
          <div className="choice-grid">
            {planes.map((p) => (
              <button key={p.id} type="button" className="choice" aria-pressed={destino?.id === p.id} onClick={() => setDestino(p)}>
                <span className="flex-1 min-w-0">
                  <span className="row-between"><span className="choice-title">{p.name}</span>
                    <span className="strong num">{pesos(p.effectivePriceCents ?? p.priceCents, { decimals: false })}<span className="tiny muted"> {porPeriodo(p)}</span></span></span>
                  <span className="choice-text block">{duracion(p)}</span>
                </span>
              </button>
            ))}
          </div>
          )}
        </EstadoCarga>
        <Field label="Motivo" htmlFor="mot-cp" hint="Queda en la bitácora con tu nombre.">
          <input id="mot-cp" className="input" value={motivo} placeholder="Quiere entrar a todas las sucursales" onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        {cobro.ui}
      </div>
    </Dialog>
  );
}

function Congelar({ m, plan, nombre, onClose, onDone }: Props & { plan: Plan }) {
  const toast = useToast();
  const usados = m.frozenDaysUsedThisYear ?? 0;
  const disponibles = Math.max(0, plan.maxFreezeDaysPerYear - usados);
  const [dias, setDias] = useState(String(Math.min(Math.max(plan.minFreezeDays, 7), disponibles || plan.minFreezeDays)));
  const [motivo, setMotivo] = useState('');
  const [faltaElMotivo, setFaltaElMotivo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const n = Number(dias);
  const valido = Number.isInteger(n) && n >= plan.minFreezeDays && n <= disponibles;

  async function congelar() {
    // El botón queda encendido: si falta el motivo, el campo lo dice (26-02, 26-09).
    if (faltaMotivo(motivo)) { setFaltaElMotivo(true); return; }
    setEnviando(true);
    try {
      await api(`/memberships/${m.id}/freeze`, { method: 'POST', body: JSON.stringify({ days: n, reason: motivo.trim() }) });
      toast('ok', `Membresía congelada ${n} días. Al descongelar, su vigencia se extiende por los días que estuvo en pausa.`);
      onDone();
    } catch (e) { toast('error', errorText(e, 'No se pudo congelar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Congelar a ${nombre}`} sub="No pierde días: su vigencia se recorre por lo que dure la pausa."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<Snowflake />} loading={enviando} disabled={!valido} onClick={() => void congelar()}>Congelar</Button></>}>
      <div className="stack">
        {disponibles < plan.minFreezeDays ? (
          <Callout tone="warn">Ya usó {usados} de {plan.maxFreezeDaysPerYear} días de congelamiento este año: no le alcanzan para el mínimo de {plan.minFreezeDays}.</Callout>
        ) : (
          <Field label="Días" htmlFor="dias" hint={`Su plan permite de ${plan.minFreezeDays} a ${disponibles} días (le quedan ${disponibles} de ${plan.maxFreezeDaysPerYear} este año).`}>
            <input id="dias" className="input num" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} />
          </Field>
        )}
        {/* Los motivos de un toque (D26-01): así se puede contar cuántas pausas son por lesión o por viaje. */}
        <CampoMotivo id="mot-cg" value={motivo} onChange={(x) => { setMotivo(x); setFaltaElMotivo(false); }} motivos={textosDeMotivo('congelamiento')}
          error={faltaElMotivo ? 'Elige o escribe el motivo: queda en la bitácora con tu nombre.' : null} />
      </div>
    </Dialog>
  );
}

function Descongelar({ m, nombre, onClose, onDone }: Props) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  async function descongelar() {
    setEnviando(true);
    try {
      const r = await api<{ currentPeriodEnd: string }>(`/memberships/${m.id}/unfreeze`, { method: 'POST', body: '{}' });
      toast('ok', `Descongelada. Vigente hasta el ${fecha(ultimoDia(r.currentPeriodEnd))}.`);
      onDone();
    } catch (e) { toast('error', errorText(e, 'No se pudo descongelar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Descongelar a ${nombre}`}
      sub="Vuelve a entrar desde hoy. Su vigencia se extiende por los días que realmente estuvo en pausa."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<Sun />} loading={enviando} onClick={() => void descongelar()}>Descongelar</Button></>}>
      <p className="small muted">{m.frozenUntil ? `Estaba congelada hasta el ${fecha(m.frozenUntil)}.` : 'Está congelada.'}</p>
    </Dialog>
  );
}

function Cancelar({ m, nombre, onClose, onDone }: Props) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function cancelar() {
    setEnviando(true);
    try {
      await api(`/memberships/${m.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', 'Membresía cancelada. Si vuelve, se le vende un plan nuevo y conserva su antigüedad.');
      onDone();
    } catch (e) { toast('error', errorText(e, 'No se pudo cancelar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Cancelar la membresía de ${nombre}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
        <Button variant="danger" icon={<Ban />} loading={enviando} disabled={motivo.trim().length < 3} onClick={() => void cancelar()}>Cancelar membresía</Button></>}>
      <div className="stack">
        {/* Lo que de verdad hace cancelar (D-12 y D-13, bloque 3.5): la deuda se queda; lo pagado y no usado queda a su favor. */}
        <Callout tone="warn" title="Deja de entrar de inmediato">
          Lo que ya pagó y no usó (los días que faltan de su periodo) queda a su favor: cubre primero lo que deba y, si pide que se le devuelva,
          se hace desde su estado de cuenta con autorización. Si vuelve, conserva su antigüedad.
        </Callout>
        {m.memberId && <AdeudoAlCerrar memberId={m.memberId} membershipId={m.id} branchId={m.soldAtBranchId} al="cancelar" />}
        <Field label="Motivo" htmlFor="mot-cn" hint="Obligatorio. Alimenta el análisis de bajas.">
          <input id="mot-cn" className="input" value={motivo} placeholder="Se muda de ciudad, precio, horario…" onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** D-14: cambia si la membresía se renueva sola, con motivo. */
function CambiarRenovacion({ m, plan, nombre, onClose, onDone }: Props & { plan: Plan | null }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const aSola = !m.autoRenew;
  const prepago = plan?.billingModel === 'PREPAID_PERIOD';
  async function guardar() {
    setEnviando(true); setFallo(null);
    try {
      await api(`/memberships/${m.id}/auto-renew`, { method: 'PUT', body: JSON.stringify({ autoRenew: aSola, reason: motivo.trim() }) });
      toast('ok', aSola ? 'Se renovará sola al terminar' : 'Ya no se renueva sola: al terminar vence');
      onDone();
    } catch (e) { setFallo(errorText(e, 'No se pudo cambiar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} title={aSola ? `Que la membresía de ${nombre} se renueve sola` : `Que la membresía de ${nombre} ya no se renueve sola`} error={fallo}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
        <Button loading={enviando} disabled={faltaMotivo(motivo)} onClick={() => void guardar()}>{aSola ? 'Que se renueve sola' : 'Que no se renueve'}</Button></>}>
      <div className="stack">
        <Callout tone={aSola ? 'warn' : 'info'}>
          {aSola
            ? `Al terminar su periodo (${fecha(ultimoDia(m.currentPeriodEnd))}) se le emite ${prepago ? 'otro periodo completo' : 'la siguiente cuota'}${plan ? ` de ${pesos(m.periodPriceCents ?? plan.priceCents)}` : ''} sin que nadie se la venda. Si no la paga, queda en mora.`
            : `Al terminar su periodo (${fecha(ultimoDia(m.currentPeriodEnd))}) vence y se le vuelve a vender.${prepago ? ' Se le avisa 15 días antes.' : ''}`}
        </Callout>
        <CampoMotivo id="ren-motivo" autoFocus value={motivo} onChange={setMotivo} motivos={aSola ? ['Lo pidió el socio'] : ['Lo pidió el socio', 'No la eligió al comprar']} />
      </div>
    </Dialog>
  );
}

type Opciones = {
  today: string; planName: string; periodCents: string; openCents: string;
  openCharges: Array<{ id: string; concept: string }>;
  missedPeriods: Array<{ start: string; end: string }>;
  resumeTotalCents: string;
  forgiveNewPeriod: { start: string; end: string } | null;
};

/**
 * Suspendida que vuelve: el dueño decide si se le cobran los periodos que no
 * vino (reanudar) o se le perdonan (olvidar). Olvidar es de la gerencia: sola
 * hasta una mensualidad del socio; arriba pide la segunda autorización (D-12).
 */
function DecidirAdeudo({ m, nombre, onClose, onDone }: Props) {
  const toast = useToast();
  const { can } = useSession();
  const [o, setO] = useState<Opciones | null>(null);
  const [decision, setDecision] = useState<'RESUME' | 'FORGIVE' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const cobro = useCobro(m.soldAtBranchId);

  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Opciones>(`/memberships/${m.id}/debt-options`).then(setO)
      .catch((e) => setError(errorText(e, 'No se pudo calcular el adeudo')));
  }, [m.id]);

  const puedeReanudar = !!o && o.missedPeriods.length > 0;
  // Olvidar solo con meses atrasados (4-08): con el periodo en curso solo movía el día de corte.
  const puedeOlvidar = !!o?.forgiveNewPeriod && o.missedPeriods.length > 0 && can('billing:waiver:apply');
  const aPagar = !o || !decision ? null : decision === 'RESUME' ? o.resumeTotalCents : o.periodCents;

  async function enviar(approvalToken?: string) {
    if (!decision) return;
    setEnviando(true);
    try {
      const r = await api<{ membership: { status: string }; payment: unknown }>(`/memberships/${m.id}/debt-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: motivo.trim(), payment: cobro.payload, ...(approvalToken ? { approvalToken } : {}) }),
      });
      const que = decision === 'RESUME' ? 'Adeudo reanudado' : 'Adeudo olvidado';
      toast('ok', r.membership.status === 'ACTIVE' ? `${que}: ${nombre} ya puede entrar` : `${que}; queda suspendida hasta que pague`);
      onDone();
    } catch (e) {
      // D-12: olvidar dentro de una mensualidad del socio pasa solo; arriba, la API pide la firma (428).
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      else toast('error', errorText(e, 'No se pudo aplicar'));
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open size="lg" onClose={onClose} title={`Adeudo de ${nombre}`}
        sub="Está suspendida. Decide qué pasa con lo que no pagó mientras no vino."
        footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button icon={decision === 'FORGIVE' ? <Eraser /> : <CalendarClock />} loading={enviando}
            disabled={!decision || motivo.trim().length < 3 || !cobro.listo}
            onClick={() => void enviar()}>
            {decision === 'FORGIVE' ? (cobro.ahora && aPagar ? `Olvidar y cobrar ${pesos(aPagar)}` : 'Olvidar adeudo') : cobro.ahora && aPagar ? `Reanudar y cobrar ${pesos(aPagar)}` : 'Reanudar adeudo'}
          </Button></>}>
        {error ? <Callout tone="danger">{error}</Callout> : !o ? <Skeleton h={180} /> : (
          <div className="stack">
            <div className="card card-pad shadow-none">
              <div className="row-between small"><span className="muted">Plan</span><span className="strong">{o.planName}</span></div>
              <div className="row-between small mt-6"><span className="muted">Debe hoy</span><span className="strong num">{pesos(o.openCents)}</span></div>
              <div className="row-between small mt-6">
                <span className="muted">Periodos que no ha pagado desde entonces</span>
                <span className="strong">{o.missedPeriods.length}</span>
              </div>
            </div>
            <div className="choice-grid">
              <button type="button" className="choice" aria-pressed={decision === 'RESUME'} disabled={!puedeReanudar} onClick={() => setDecision('RESUME')}>
                <span className="choice-icon"><CalendarClock /></span>
                <span className="flex-1 min-w-0">
                  <span className="row-between"><span className="choice-title">Reanudar el adeudo</span>
                    <span className="strong num">{pesos(o.resumeTotalCents)}</span></span>
                  <span className="choice-text block">
                    {puedeReanudar
                      ? `Se cobran los ${o.missedPeriods.length} periodos que no vino (del ${fecha(o.missedPeriods[0]!.start)} al ${fecha(o.missedPeriods.at(-1)!.end)}) más lo que ya debía. Conserva su día de corte.`
                      : 'Su periodo sigue en curso: basta con cobrarle lo que debe.'}
                  </span>
                </span>
              </button>
              <button type="button" className="choice" aria-pressed={decision === 'FORGIVE'} disabled={!puedeOlvidar} onClick={() => setDecision('FORGIVE')}>
                <span className="choice-icon"><Eraser /></span>
                <span className="flex-1 min-w-0">
                  <span className="row-between"><span className="choice-title">Olvidar el adeudo</span>
                    <span className="strong num">{pesos(o.periodCents)}</span></span>
                  <span className="choice-text block">
                    {!o.forgiveNewPeriod ? 'Su periodo empezó hoy: condona el cargo desde el estado de cuenta.'
                      : o.missedPeriods.length === 0 ? 'Su periodo sigue en curso: no hay meses atrasados que olvidar. Cóbrale lo que debe.'
                      : !can('billing:waiver:apply') ? 'Solo la gerencia puede perdonar un adeudo.'
                      : `Se condonan ${pesos(o.openCents)} y arranca un periodo nuevo hoy, del ${fecha(o.forgiveNewPeriod.start)} al ${fecha(o.forgiveNewPeriod.end)}. Su día de corte pasa a ser hoy. Hasta una mensualidad suya no pide autorización.`}
                  </span>
                </span>
              </button>
            </div>
            {decision && (
              <>
                <Field label="Motivo" htmlFor="mot-ad" hint="Queda en la bitácora con tu nombre.">
                  <input id="mot-ad" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    placeholder={decision === 'RESUME' ? 'Acepta pagar los meses que debe' : 'Estuvo incapacitado por una lesión'} />
                </Field>
                {cobro.ui}
                {!cobro.ahora && <Callout tone="info">Sin cobrar ahora sigue suspendida: entra cuando pague {aPagar ? pesos(aPagar) : 'lo pendiente'}.</Callout>}
              </>
            )}
          </div>
        )}
      </Dialog>
      {autorizando && (
        <AutorizacionDialog permission="billing:waiver:apply" branchId={m.soldAtBranchId} operacion={{ resourceType: 'Membership', resourceId: m.id, amountCents: o?.openCents ?? null }} motivo={motivo} titulo={`Autorizar olvidar ${o ? pesos(o.openCents) : 'el adeudo'}`}
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void enviar(token); }} />
      )}
    </>
  );
}
