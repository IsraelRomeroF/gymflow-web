'use client';

import { useState } from 'react';
import { LockOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@/lib/format';
import { aCentavos, TURNO, type Caja, type Turno } from '@/lib/caja';
import { useToast, errorText } from './session';
import { Badge, Button, Callout, Dialog, Field, Segmented } from './ui';

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
