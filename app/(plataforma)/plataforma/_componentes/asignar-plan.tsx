'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { pesos } from '@gymflow/ui/format';
import { useToast, errorText } from '@/components/session';
import { Button, Callout, Dialog, Field, irAlPrimerError } from '@/components/ui';
import { usePlataforma } from '../../layout';
import type { Detalle } from './tipos';

/** El plan contratado de una marca (ADR-039): al asignarlo, lo contratado pasa a ser lo que incluye. */
export function AsignarPlan({ marca, onClose, onHecho }: { marca: Detalle; onClose: () => void; onHecho: () => void }) {
  const { plans, modules } = usePlataforma();
  const toast = useToast();
  const [planId, setPlanId] = useState<string>(marca.plan?.id ?? '');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const elegido = plans.find((p) => p.id === planId) ?? null;
  const nombre = (k: string) => modules.find((m) => m.key === k)?.name ?? k;
  const [intentado, setIntentado] = useState(false);
  const sinCambio = planId === (marca.plan?.id ?? '');
  const faltaMotivo = motivo.trim().length < 3;
  async function asignar() {
    setIntentado(true);
    if (sinCambio || faltaMotivo) { irAlPrimerError(); return; }
    setEnviando(true);
    try {
      await api(`/platform/organizations/${marca.id}/plan`, { method: 'PUT', body: JSON.stringify({ planId: planId || null, reason: motivo.trim() }) });
      toast('ok', elegido ? `Plan ${elegido.name} asignado.` : 'La marca queda a la medida.'); onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo asignar el plan')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Plan de ${marca.tradeName}`} sub="Al asignar un plan, lo contratado pasa a ser exactamente lo que incluye. Lo que la marca tenía fuera del plan deja de estar contratado: se vuelve a agregar después si lo paga."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} onClick={() => void asignar()}>{elegido ? 'Asignar plan' : 'Dejar a la medida'}</Button></>}>
      <div className="stack">
        {plans.length === 0 && <Callout tone="warn">No hay planes vigentes. Créalos en <Link href="/plataforma/planes">Planes</Link>; mientras tanto la marca se contrata módulo por módulo.</Callout>}
        <div className="stack-sm">
          <label className="choice items-center">
            <input type="radio" name="plan" checked={planId === ''} onChange={() => setPlanId('')} />
            <span className="flex-1"><span className="choice-title block">A la medida</span><span className="choice-text block">Sin plan: cada módulo se contrata y se cobra por separado.</span></span>
          </label>
          {plans.map((p) => (
            <label key={p.id} className="choice items-center" data-plan={p.name}>
              <input type="radio" name="plan" checked={planId === p.id} onChange={() => setPlanId(p.id)} />
              <span className="flex-1">
                <span className="choice-title block">{p.name} <span className="muted small">· {p.monthlyCents === null ? 'sin precio' : `${pesos(p.monthlyCents)} al mes`}</span></span>
                <span className="choice-text block">Lo básico{p.modules.length ? ` + ${p.modules.map(nombre).join(', ')}` : ''}{p.description ? ` · ${p.description}` : ''}</span>
              </span>
            </label>
          ))}
        </div>
        {intentado && sinCambio && <Callout tone="warn">Elige un plan distinto del que ya tiene.</Callout>}
        <Field label="Motivo" htmlFor="ap-m" required error={intentado && faltaMotivo ? 'Escribe el motivo: queda en la bitácora.' : null} hint="Queda en la bitácora de la marca."><input id="ap-m" className="input" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Contrató el plan Completo" /></Field>
      </div>
    </Dialog>
  );
}
