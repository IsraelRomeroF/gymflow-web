'use client';

import { useCallback, useEffect, useState } from 'react';
import { HandHeart } from 'lucide-react';
import { MOTIVOS, OTRO, revisarMotivo } from '@gymflow/core/motivos';
import type { DebtWaiverResult, MemberDebt } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { concepto, pesos } from '@gymflow/ui/format';
import { useSession, useToast, errorText } from '../session';
import { Button, Callout, Dialog, Field, Opciones, Skeleton } from '../ui';
import { AutorizacionDialog } from '../autorizacion';

/**
 * EL ADEUDO AL CERRAR (fase 3, bloque 3.5 · D-12).
 *
 * Nada se borra solo: al dar de baja o cancelar, lo que el socio debe SE
 * QUEDA registrado. Quien lo hace lo ve aquí, con su importe, y elige:
 * cobrarlo (desde «Cobrar»), dejarlo (no hace nada: es lo que pasa por
 * omisión) o perdonarlo, con motivo y monto. Perdonar hasta una mensualidad
 * del socio no pide firma; arriba la firma la dueña.
 *
 * Va dentro de los diálogos «Cancelar la membresía» y «Dar de baja».
 */
export function AdeudoAlCerrar({ memberId, membershipId, branchId, al }: {
  memberId: string;
  /** Solo lo que debe de esa membresía (al cancelarla). Sin ella, todo (al darlo de baja). */
  membershipId?: string;
  branchId: string | null;
  /** «cancelar» o «darlo de baja»: completa la frase. */
  al: string;
}) {
  const { can } = useSession();
  const [deuda, setDeuda] = useState<MemberDebt | null>(null);
  const [fallo, setFallo] = useState(false);
  const [perdonando, setPerdonando] = useState(false);
  const cargar = useCallback(() => {
    const soloDe = membershipId ? `?membershipId=${membershipId}` : '';
    api<MemberDebt>(`/members/${memberId}/debt` + soloDe).then(setDeuda).catch(() => setFallo(true));
  }, [memberId, membershipId]);
  useEffect(cargar, [cargar]);

  // Sin poder ver el estado de cuenta, el aviso dice la regla sin importes.
  if (fallo) return <Callout tone="warn" title="Su deuda no se borra">Si debe algo, al {al} se queda registrado: se le cobra o lo perdona la gerencia.</Callout>;
  if (!deuda) return <Skeleton h={64} />;
  const debe = BigInt(deuda.outstandingCents);
  if (debe <= 0n) return <div data-testid="adeudo-al-cerrar"><Callout tone="ok">No debe nada.</Callout></div>;
  const disponible = BigInt(deuda.waiver.availableCents);
  return (
    <div data-testid="adeudo-al-cerrar">
      <Callout tone="warn" title={`Debe ${pesos(debe)} y esa deuda no se borra`}>
        <p>
          {deuda.charges.slice(0, 3).map((c) => `${concepto(c.concept)} (${pesos(c.balanceCents)})`).join(' · ')}
          {deuda.charges.length > 3 ? ` y ${deuda.charges.length - 3} más` : ''}.
        </p>
        <p className="mt-6">Al {al} se queda registrada, como hasta ahora la ves en su estado de cuenta. Si se la vas a cobrar, cóbrala desde «Cobrar».</p>
        {can('billing:waiver:apply') && (
          <div className="row wrap gap-8 items-center mt-8">
            <Button size="sm" variant="secondary" icon={<HandHeart />} onClick={() => setPerdonando(true)}>Perdonarla…</Button>
            <span className="tiny muted">
              {deuda.waiveAllNeedsApproval
                ? `Pasa de lo que se le puede perdonar sin firma (${pesos(disponible)}): la autoriza quien da la segunda firma.`
                : 'Cabe en una mensualidad suya: no pide autorización.'}
            </span>
          </div>
        )}
      </Callout>
      {perdonando && <PerdonarAdeudoDialog deuda={deuda} membershipId={membershipId} branchId={branchId}
        onClose={() => setPerdonando(false)} onListo={() => { setPerdonando(false); cargar(); }} />}
    </div>
  );
}

function PerdonarAdeudoDialog({ deuda, membershipId, branchId, onClose, onListo }: {
  deuda: MemberDebt; membershipId?: string | undefined; branchId: string | null; onClose: () => void; onListo: () => void;
}) {
  const toast = useToast();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [autorizando, setAutorizando] = useState(false);
  const revisado = codigo ? revisarMotivo('condonacion', { codigo, nota }) : null;
  const motivo = revisado && revisado.ok ? revisado.texto : '';

  async function enviar(token?: string) {
    if (!codigo || !motivo) return;
    setEnviando(true); setFallo(null);
    try {
      const r = await api<DebtWaiverResult>(`/members/${deuda.memberId}/debt/waiver`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode: codigo, reason: motivo, ...(membershipId ? { membershipId } : {}), ...(token ? { approvalToken: token } : {}) }),
      });
      toast('ok', `Se le perdonaron ${pesos(r.forgivenCents)}`);
      onListo();
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      else setFallo(errorText(e, 'No se pudo perdonar'));
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open onClose={onClose} title={`Perdonar ${pesos(deuda.outstandingCents)}`} error={fallo}
        sub="Es una condonación: cada cargo queda perdonado con su importe, tu nombre y el motivo. No se puede deshacer."
        footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
          <Button variant="danger" icon={<HandHeart />} loading={enviando} disabled={!motivo} onClick={() => void enviar()}>
            {deuda.waiveAllNeedsApproval ? 'Pedir autorización' : `Perdonar ${pesos(deuda.outstandingCents)}`}</Button></>}>
        <div className="stack">
          <Callout tone={deuda.waiveAllNeedsApproval ? 'warn' : 'info'}>
            {deuda.waiver.monthlyCents === null
              ? 'Este socio nunca tuvo un plan: todo perdón lo autoriza quien da la segunda firma.'
              : <>La gerencia perdona sola hasta una mensualidad del socio ({pesos(deuda.waiver.monthlyCents)}) cada {deuda.waiver.windowDays} días.
                {BigInt(deuda.waiver.usedCents) > 0n ? ` Ya se le perdonaron ${pesos(deuda.waiver.usedCents)} sin firma.` : ''}
                {deuda.waiveAllNeedsApproval ? ' Esto pasa de ese tope: pide autorización.' : ' Esto cabe: no pide autorización.'}</>}
          </Callout>
          <div>
            <p className="label mb-8" id="per-motivo">¿Por qué se le perdona?</p>
            <Opciones forma="chips" etiquetadaPor="per-motivo" value={codigo} onChange={setCodigo}
              opciones={MOTIVOS.condonacion.motivos.map((m) => ({ value: m.codigo, label: m.texto }))} />
          </div>
          <Field label={codigo === OTRO ? 'Explicación' : 'Explicación (opcional)'} htmlFor="per-nota" required={codigo === OTRO}
            hint="Queda en la bitácora con tu nombre, junto al motivo.">
            <input id="per-nota" className="input" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} placeholder="Incapacidad del 3 al 20 de noviembre" />
          </Field>
        </div>
      </Dialog>
      {autorizando && (
        <AutorizacionDialog permission="billing:waiver:apply" branchId={branchId}
          operacion={{ resourceType: 'Member', resourceId: deuda.memberId, amountCents: deuda.outstandingCents }} motivo={motivo}
          titulo={`Autorizar perdonar ${pesos(deuda.outstandingCents)}`}
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void enviar(token); }} />
      )}
    </>
  );
}
