'use client';

import { useEffect, useState } from 'react';
import { TOLERANCIA_DE_DESCUADRE_CENTS } from '@gymflow/core';
import { LockOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, fechaHora, pesos } from '@/lib/format';
import { aCentavos, TURNO, type Caja, type Turno } from '@/lib/caja';
import { useSession, useToast, errorText } from './session';
import { Badge, Button, Callout, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo, Field, Segmented } from './ui';
import { useFormulario } from '@/lib/formulario';
import Link from 'next/link';
import type { CashAlerts, CashLimits } from '@gymflow/core/contracts';
import { InputPesos } from './input-pesos';
import { AutorizacionDialog } from './autorizacion';

/** La diferencia de un corte, dicha como la diría recepción. */
export function Diferencia({ cents }: { cents: string | null }) {
  if (cents === null) return <span className="muted">—</span>;
  const v = BigInt(cents);
  if (v === 0n) return <Badge tone="ok">Cuadró</Badge>;
  return <Badge tone={v < 0n ? 'danger' : 'warn'}>{v < 0n ? 'Faltan' : 'Sobran'} {pesos(v < 0n ? -v : v)}</Badge>;
}

/** Hasta cuánto no se revisa una diferencia (D-17): «$20.00», del núcleo. */
export const TOLERANCIA = pesos(TOLERANCIA_DE_DESCUADRE_CENTS);

/**
 * D-17 (bloque 4.3): en qué va la revisión de la diferencia de un corte.
 * Nada, si no hay qué revisar (cuadró o no pasó de $20).
 */
export function EstadoRevision({ turno }: { turno: Pick<Turno, 'varianceStatus' | 'varianceReviewedByName'> }) {
  if (turno.varianceStatus === 'PENDING') return <Badge tone="warn" dot>Por revisar</Badge>;
  if (turno.varianceStatus === 'REVIEWED') return <Badge tone="ok">Revisado{turno.varianceReviewedByName ? ` · ${turno.varianceReviewedByName}` : ''}</Badge>;
  return null;
}

/** De quién es el turno (quien lo abrió) y, si lo cortó otra persona, quién. */
export function quienResponde(t: Pick<Turno, 'responsibleName' | 'closedByName' | 'openedByUserId' | 'closedByUserId'>): string {
  const responsable = t.responsibleName ?? '—';
  return t.closedByUserId && t.closedByUserId !== t.openedByUserId ? `${responsable} · cortó ${t.closedByName ?? '—'}` : responsable;
}

const NOTAS_DE_REVISION = ['Cambio mal dado', 'Cobro sin registrar', 'Error al contar', 'Ya se repuso', 'Sin explicación: se le da seguimiento'] as const;

/**
 * LA GERENCIA REVISA UN DESCUADRE Y LO CIERRA CON SU NOTA (D-17 b). El
 * faltante es de quien abrió el turno; aquí se escribe qué se resolvió. El
 * sistema no descuenta nada: descontar del sueldo tiene límites laborales.
 */
export function RevisarDialog({ turno, caja, onClose, onListo }: { turno: Turno; caja: string; onClose: () => void; onListo: (revisado: Turno) => void }) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const f = useFormulario({ nota: faltaMotivo(nota) && ERROR_MOTIVO });
  const v = BigInt(turno.varianceCents ?? '0');

  async function cerrar() {
    setEnviando(true); setFallo(null);
    try {
      const r = await api<Turno>(`/cash-sessions/${turno.id}/variance/review`, { method: 'POST', body: JSON.stringify({ note: nota.trim() }) });
      toast('ok', 'Descuadre revisado');
      onListo(r);
    } catch (e) { setFallo(errorText(e, 'No se pudo cerrar la revisión')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Revisar el descuadre · ${caja}`} sub={`Corte del ${fecha(turno.businessDate)}${turno.closedAt ? `, cerrado el ${fechaHora(turno.closedAt)}` : ''}.`} error={fallo}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button><Button loading={enviando} onClick={() => void f.enviar(cerrar)}>Cerrar la revisión</Button></>}>
      <div className="stack">
        <Callout tone={v < 0n ? 'danger' : 'warn'} title={v < 0n ? `Faltaron ${pesos(-v)}` : `Sobraron ${pesos(v)}`}>
          El turno es de <strong>{turno.responsibleName ?? 'quien lo abrió'}</strong>, que lo abrió
          {turno.closedByUserId && turno.closedByUserId !== turno.openedByUserId ? <>; lo cortó {turno.closedByName ?? 'otra persona'}</> : null}.
          {turno.varianceReason ? <> Al cortar se explicó: «{turno.varianceReason}».</> : null}
        </Callout>
        <CampoMotivo id="rv-nota" label="Qué se resolvió" value={nota} onChange={setNota} error={f.error('nota')} motivos={NOTAS_DE_REVISION} renglones={3} autoFocus maxLength={500}
          hint="Queda en el corte y en la bitácora, con tu nombre. El sistema no descuenta nada del sueldo: solo deja dicho de quién fue y qué se resolvió." />
      </div>
    </Dialog>
  );
}

/** El turno que corresponde a la hora: así nadie tiene que pensarlo al abrir. */
export function turnoPorHora(d = new Date()): NonNullable<Turno['shiftLabel']> {
  const h = d.getHours();
  return h < 14 ? 'MORNING' : h < 21 ? 'EVENING' : 'NIGHT';
}

/**
 * Abrir turno con el FONDO real y la etiqueta del turno. Lo usan Caja y Mi
 * turno: el camino de un clic abría con $0 y el corte terminaba siempre con
 * sobrante (MC-01).
 */
export function AbrirDialog({ caja, onClose, onListo }: { caja: Pick<Caja, 'id' | 'name'>; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [fondo, setFondo] = useState('');
  const [turno, setTurno] = useState(turnoPorHora());
  const [enviando, setEnviando] = useState(false);
  const cents = aCentavos(fondo || '0');

  async function abrir() {
    if (cents === null) return;
    setEnviando(true);
    try {
      await api('/cash-sessions', { method: 'POST', body: JSON.stringify({ cashRegisterId: caja.id, openingFloatCents: cents.toString(), shiftLabel: turno }) });
      toast('ok', `Turno abierto en ${caja.name}`);
      onListo();
    } catch (e) {
      toast('error', errorText(e, 'No se pudo abrir el turno'));
    } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Abrir turno · ${caja.name}`} sub="El turno queda a tu nombre: respondes por lo que entra y sale del cajón hasta el corte, lo cierre quien lo cierre."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<LockOpen />} loading={enviando} disabled={cents === null} onClick={() => void abrir()}>Abrir turno</Button></>}>
      <div className="stack">
        <Field label="Turno" htmlFor="turno">
          <Segmented value={turno} onChange={setTurno} options={(['MORNING', 'EVENING', 'NIGHT'] as const).map((v) => ({ value: v, label: TURNO[v] }))} />
        </Field>
        <Field label="Fondo inicial" htmlFor="fondo" hint="El efectivo con el que arranca el cajón para dar cambio. Cuéntalo antes de escribirlo: cada turno declara el suyo, no se copia el del corte anterior.">
          <div className="input-money"><span>$</span>
            <input id="fondo" className="input" inputMode="decimal" autoFocus placeholder="0.00" value={fondo} onChange={(e) => setFondo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void abrir(); }} />
          </div>
        </Field>
        {cents === null && <Callout tone="warn">Escribe una cantidad en pesos, por ejemplo 500 o 1,250.50.</Callout>}
      </div>
    </Dialog>
  );
}

/**
 * LOS TOPES DEL CAJÓN (fase 3, bloque 3.5 · D-15): hasta cuánto se anota de
 * fondo y de gasto sin autorización en un turno, y cuánto puede retirar o
 * depositar recepción por turno. Son del gimnasio. Cambiarlos es de la
 * gerencia y SIEMPRE lo autoriza quien da la segunda firma: son sus propios topes.
 */
export function TopesDelCajon() {
  const toast = useToast();
  const { org } = useSession();
  const [topes, setTopes] = useState<CashLimits | null>(null);
  const [editando, setEditando] = useState(false);
  const [chico, setChico] = useState<bigint | null>(null);
  const [retiro, setRetiro] = useState<bigint | null>(null);
  const [motivo, setMotivo] = useState('');
  const [autorizando, setAutorizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(() => { api<CashLimits>('/cash/limits').then(setTopes).catch(() => undefined); }, []);
  if (!topes) return null;

  function abrir() { setChico(BigInt(topes!.pettyLimitCents)); setRetiro(BigInt(topes!.withdrawalShiftLimitCents)); setMotivo(''); setFallo(null); setEditando(true); }
  const dentro = (v: bigint | null, max: string) => v !== null && v >= 0n && v <= BigInt(max);
  const valido = dentro(chico, topes.max.pettyLimitCents) && dentro(retiro, topes.max.withdrawalShiftLimitCents) && motivo.trim().length >= 3;

  async function guardar(token?: string) {
    setEnviando(true); setFallo(null);
    try {
      const r = await api<CashLimits>('/cash/limits', {
        method: 'PUT',
        body: JSON.stringify({ pettyLimitCents: chico!.toString(), withdrawalShiftLimitCents: retiro!.toString(), reason: motivo.trim(), ...(token ? { approvalToken: token } : {}) }),
      });
      setTopes(r); setEditando(false);
      toast('ok', 'Topes del cajón actualizados');
    } catch (e) { setFallo(errorText(e, 'No se pudieron cambiar los topes')); } finally { setEnviando(false); }
  }

  return (
    <>
      <Callout tone="info" title="Topes del cajón">
        Fondo y gastos: hasta {pesos(topes.pettyLimitCents)} por turno con motivo y sin autorización. Retiros y depósitos: siempre con autorización;
        recepción, hasta {pesos(topes.withdrawalShiftLimitCents)} por turno.{topes.isDefault ? ' Son los de fábrica.' : ''}
        {' '}<button type="button" className="enlace-en-linea strong" onClick={abrir}>Cambiar…</button>
      </Callout>
      {editando && !autorizando && (
        <Dialog open onClose={() => setEditando(false)} title="Topes del cajón" error={fallo}
          sub="Valen para todas las sucursales. Cambiarlos siempre lo autoriza otra persona, con su contraseña."
          footer={<><Button variant="secondary" onClick={() => setEditando(false)} disabled={enviando}>Cancelar</Button>
            <Button loading={enviando} disabled={!valido} onClick={() => setAutorizando(true)}>Pedir autorización</Button></>}>
          <div className="stack">
            <Field label="Fondo y gastos sin autorización, por turno" htmlFor="tp-chico" required hint={`Hasta ${pesos(topes.max.pettyLimitCents)}. En $0, todo gasto pide autorización.`}
              error={chico !== null && !dentro(chico, topes.max.pettyLimitCents) ? `No puede pasar de ${pesos(topes.max.pettyLimitCents)}.` : null}>
              <div className="input-money"><span>$</span><InputPesos id="tp-chico" valueCents={chico} onChange={(c) => setChico(c)} /></div>
            </Field>
            <Field label="Retiros y depósitos de recepción, por turno" htmlFor="tp-retiro" required hint={`Hasta ${pesos(topes.max.withdrawalShiftLimitCents)}. Siempre con autorización; arriba de esto los hace la gerencia.`}
              error={retiro !== null && !dentro(retiro, topes.max.withdrawalShiftLimitCents) ? `No puede pasar de ${pesos(topes.max.withdrawalShiftLimitCents)}.` : null}>
              <div className="input-money"><span>$</span><InputPesos id="tp-retiro" valueCents={retiro} onChange={(c) => setRetiro(c)} /></div>
            </Field>
            <CampoMotivo id="tp-motivo" value={motivo} onChange={setMotivo} motivos={['Lo pidió la dueña', 'El gasto diario ya no cabe']} />
          </div>
        </Dialog>
      )}
      {autorizando && (
        <AutorizacionDialog permission="cash:limits:set" branchId={null} operacion={{ resourceType: 'CashLimits', resourceId: org.id }} motivo={motivo.trim()}
          titulo="Autorizar el cambio de los topes del cajón"
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void guardar(token); }} />
      )}
    </>
  );
}

/**
 * «RETIRO DEL DUEÑO» CUANDO HAY UNA CAJA ABIERTA (pendiente de 3.7; bloque 4.3).
 * Va dentro del diálogo de Movimientos que anota el retiro: si el dinero sale
 * de un cajón, se registra desde Caja, donde el retiro del cajón y su anotación
 * en Movimientos se hacen juntos. Anotarlo solo en Movimientos no mueve el
 * cajón y el corte daría faltante a nombre de quien abrió. Sin caja abierta
 * (o sin permiso de ver cortes) no dice nada.
 */
export function AvisoRetiroDesdeCaja() {
  const { can, activo } = useSession();
  const [abiertas, setAbiertas] = useState<CashAlerts['open'] | null>(null);
  const ve = can('cash:session:read') && activo('cash');
  useEffect(() => { if (ve) api<CashAlerts>('/cash/alerts').then((a) => setAbiertas(a.open)).catch(() => undefined); }, [ve]);
  if (!abiertas || abiertas.length === 0) return null;
  const cuales = abiertas.slice(0, 3).map((a) => `${a.registerName} (${a.branchName})`).join(', ');
  return (
    <div data-testid="retiro-desde-caja">
      <Callout tone="info" title="¿El efectivo sale de una caja abierta?">
        Hay {abiertas.length === 1 ? 'una caja abierta' : `${abiertas.length} cajas abiertas`}: {cuales}{abiertas.length > 3 ? ' y más' : ''}.
        Si el dinero sale de ahí, {can('cash:withdraw')
          ? <>regístralo en <Link href="/caja" className="strong">Caja</Link> → «Retiro o gasto» → «Retiro del dueño»</>
          : <>pide en el mostrador que lo registren en Caja → «Retiro o gasto» → «Retiro del dueño», y autorízalo</>}:
        saca el efectivo del cajón y lo anota aquí en el mismo paso. Si lo registras aquí, el cajón no se mueve y el corte dará faltante.
      </Callout>
    </div>
  );
}
