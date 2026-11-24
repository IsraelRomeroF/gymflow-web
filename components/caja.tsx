'use client';

import { useEffect, useState } from 'react';
import { LockOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@/lib/format';
import { aCentavos, TURNO, type Caja, type Turno } from '@/lib/caja';
import { useSession, useToast, errorText } from './session';
import { Badge, Button, Callout, CampoMotivo, Dialog, Field, Segmented } from './ui';
import type { CashLimits } from '@gymflow/core/contracts';
import { InputPesos } from './input-pesos';
import { AutorizacionDialog } from './autorizacion';

/** La diferencia de un corte, dicha como la diría recepción. */
export function Diferencia({ cents }: { cents: string | null }) {
  if (cents === null) return <span className="muted">—</span>;
  const v = BigInt(cents);
  if (v === 0n) return <Badge tone="ok">Cuadró</Badge>;
  return <Badge tone={v < 0n ? 'danger' : 'warn'}>{v < 0n ? 'Faltan' : 'Sobran'} {pesos(v < 0n ? -v : v)}</Badge>;
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
    <Dialog open onClose={onClose} title={`Abrir turno · ${caja.name}`} sub="El turno queda a tu nombre: respondes por lo que entra y sale del cajón hasta el corte."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<LockOpen />} loading={enviando} disabled={cents === null} onClick={() => void abrir()}>Abrir turno</Button></>}>
      <div className="stack">
        <Field label="Turno" htmlFor="turno">
          <Segmented value={turno} onChange={setTurno} options={(['MORNING', 'EVENING', 'NIGHT'] as const).map((v) => ({ value: v, label: TURNO[v] }))} />
        </Field>
        <Field label="Fondo inicial" htmlFor="fondo" hint="El efectivo con el que arranca el cajón para dar cambio. Cuéntalo antes de escribirlo.">
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
        {' '}<Button size="sm" variant="ghost" onClick={abrir}>Cambiar…</Button>
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
