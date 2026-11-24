'use client';

import { useEffect, useState } from 'react';
import { Banknote, HandCoins, Landmark } from 'lucide-react';
import type { CreditReturnResult, OpenCashSessionsLite } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { hora, pesos } from '@/lib/format';
import { useSession, useToast, errorText } from '../session';
import { Button, Callout, CampoMotivo, Dialog, Field, Opciones } from '../ui';
import { InputPesos } from '../input-pesos';
import { AutorizacionDialog } from '../autorizacion';

/**
 * DEVOLVER SALDO A FAVOR (fase 3, bloque 3.5 · D-13).
 *
 * Lo pagado y no usado de un plan cancelado (o un excedente) queda a favor
 * del socio y cubre lo que deba. Si pide que se le devuelva en dinero, se
 * hace aquí: en efectivo de la caja abierta o por transferencia con su
 * referencia, y SIEMPRE con autorización (lo firma quien da la segunda firma).
 */
type Turno = OpenCashSessionsLite['sessions'][number];
type Como = 'CASH' | 'SPEI_TRANSFER';

export function DevolverSaldoAFavor({ memberId, branchId, creditCents, onDone }: {
  memberId: string; branchId: string | null; creditCents: string; onDone: () => void;
}) {
  const { can } = useSession();
  const [abierto, setAbierto] = useState(false);
  if (!branchId || BigInt(creditCents) <= 0n || !can('payments:refund')) return null;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<HandCoins />} onClick={() => setAbierto(true)} data-testid="devolver-saldo">Devolver saldo a favor</Button>
      {abierto && <DevolverSaldoDialog memberId={memberId} branchId={branchId} creditCents={creditCents} onClose={() => setAbierto(false)} onListo={() => { setAbierto(false); onDone(); }} />}
    </>
  );
}

function DevolverSaldoDialog({ memberId, branchId, creditCents, onClose, onListo }: {
  memberId: string; branchId: string; creditCents: string; onClose: () => void; onListo: () => void;
}) {
  const toast = useToast();
  const { activoEn, me } = useSession();
  const total = BigInt(creditCents);
  const conCaja = activoEn('cash', branchId);
  const [como, setComo] = useState<Como>('CASH');
  const [cents, setCents] = useState<bigint | null>(total);
  const [referencia, setReferencia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [cajaId, setCajaId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [autorizando, setAutorizando] = useState(false);
  // Una llave por diálogo: el doble clic o el reintento no sacan dinero dos veces.
  const [llave] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!conCaja) { setTurnos([]); return; }
    api<OpenCashSessionsLite>(`/cash-sessions/open-lite?branchId=${branchId}`).then((r) => {
      setTurnos(r.sessions);
      if (r.sessions.length === 1) setCajaId(r.sessions[0]!.id);
    }).catch((e) => setFallo(errorText(e, 'No se pudieron cargar las cajas abiertas: cierra y vuelve a intentarlo')));
  }, [branchId, conCaja]);

  const efectivo = como === 'CASH';
  const sinTurno = efectivo && conCaja && turnos !== null && turnos.length === 0;
  const importeBien = cents !== null && cents > 0n && cents <= total;
  const valido = importeBien && motivo.trim().length >= 3 && !sinTurno
    && (efectivo ? (!conCaja || (turnos !== null && (!!cajaId || turnos.length <= 1))) : referencia.trim().length >= 3);

  async function enviar(token?: string) {
    if (!valido || cents === null) return;
    setEnviando(true); setFallo(null);
    try {
      const r = await api<CreditReturnResult>(`/members/${memberId}/credit/return`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: cents.toString(), method: como, branchId, reason: motivo.trim(), requestKey: llave,
          ...(efectivo && cajaId ? { cashSessionId: cajaId } : {}),
          ...(!efectivo ? { returnRef: referencia.trim() } : {}),
          ...(token ? { approvalToken: token } : {}),
        }),
      });
      toast('ok', `Se le devolvieron ${pesos(r.returnedCents)}${BigInt(r.creditCents) > 0n ? `; le quedan ${pesos(r.creditCents)} a favor` : ''}`);
      onListo();
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      else setFallo(errorText(e, 'No se pudo devolver'));
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open onClose={onClose} title="Devolver saldo a favor" error={fallo}
        sub={`Tiene ${pesos(total)} a favor. Devolverlo en dinero siempre lo autoriza otra persona, con su contraseña.`}
        footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="danger" loading={enviando} disabled={!valido} onClick={() => setAutorizando(true)}>Pedir autorización</Button></>}>
        <div className="stack">
          <Field label="Importe a devolver" htmlFor="saf-importe" required hint={`Hasta ${pesos(total)}. Lo que no se devuelva sigue a su favor.`}
            error={cents !== null && !importeBien ? `Debe ser mayor que cero y no pasar de ${pesos(total)}.` : null}>
            <div className="input-money"><span>$</span><InputPesos id="saf-importe" valueCents={cents} onChange={(c) => setCents(c)} /></div>
          </Field>
          <div>
            <p className="label mb-8" id="saf-como">¿Cómo se le devuelve?</p>
            <Opciones forma="tarjetas" etiquetadaPor="saf-como" value={como} onChange={setComo}
              opciones={[
                { value: 'CASH' as const, label: 'Efectivo', icono: <Banknote />, texto: conCaja ? 'Sale de la caja abierta hoy, con su folio.' : 'Esta sucursal no lleva Caja: se le entrega en mano.' },
                { value: 'SPEI_TRANSFER' as const, label: 'Transferencia', icono: <Landmark />, texto: 'Desde la cuenta del gimnasio. Se anota su clave de rastreo.' },
              ]} />
          </div>
          {sinTurno && <Callout tone="warn" title="No hay ninguna caja abierta">Abre turno para devolver efectivo, o devuélvelo por transferencia.</Callout>}
          {efectivo && turnos && turnos.length > 1 && (
            <Field label="Caja" htmlFor="saf-caja" required hint="Hay varias abiertas: el efectivo sale del corte de la que elijas.">
              <select id="saf-caja" className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                <option value="">Elige la caja…</option>
                {turnos.map((t) => {
                  const quien = t.openedByUserId === me.userId ? 'tu turno' : `turno de ${t.openedByName ?? 'otra persona'}`;
                  return <option key={t.id} value={t.id}>{t.registerCode} · {t.registerName} — {quien}, desde {hora(t.openedAt)}</option>;
                })}
              </select>
            </Field>
          )}
          {!efectivo && (
            <Field label="Referencia de la devolución" htmlFor="saf-ref" required hint="La clave de rastreo de la transferencia con la que se le devolvió.">
              <input id="saf-ref" className="input" value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
            </Field>
          )}
          <CampoMotivo id="saf-motivo" value={motivo} onChange={setMotivo} maxLength={220}
            motivos={['Canceló y pidió su dinero', 'Pagó de más']} />
        </div>
      </Dialog>
      {autorizando && cents !== null && (
        <AutorizacionDialog permission="payments:refund" branchId={branchId}
          operacion={{ resourceType: 'Member', resourceId: memberId, amountCents: cents }} motivo={motivo.trim()}
          titulo={`Autorizar devolver ${pesos(cents)} de saldo a favor`}
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void enviar(token); }} />
      )}
    </>
  );
}
