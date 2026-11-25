'use client';

import { useEffect, useState } from 'react';
import { parsePesos } from '@/lib/pesos';
import { pesos } from '@gymflow/ui/format';
import { Field } from '../ui';

/**
 * CAMBIO EN EFECTIVO (UX5-M-05): «¿con cuánto paga?» con los billetes de un
 * toque y el cambio en grande. No se guarda: es la cuenta que hoy se hace de
 * cabeza en hora pico.
 */
export function CambioEfectivo({ totalCents, onRecibido }: { totalCents: bigint; /** Lo que tecleó el cajero, para conservar el cambio después de cobrar (MC-06). */ onRecibido?: (c: bigint | null) => void }) {
  const [paga, setPaga] = useState('');
  // Los billetes que alcanzan para pagar: $100, $200, $500, $1,000.
  const billetes = [10000n, 20000n, 50000n, 100000n].filter((b) => b >= totalCents).slice(0, 3);
  const pagaCents = parsePesos(paga);
  const cambio = pagaCents !== null ? pagaCents - totalCents : null;
  useEffect(() => { onRecibido?.(pagaCents); }, [pagaCents, onRecibido]);
  return (
    <div className="cambio">
      <div className="cambio-paga">
        <Field label="Paga con" htmlFor="cambio-paga">
          <input id="cambio-paga" className="input num cambio-campo" inputMode="decimal" placeholder="$" value={paga} onChange={(e) => setPaga(e.target.value)} />
        </Field>
        {billetes.map((b) => <button key={b.toString()} type="button" className="chip" onClick={() => setPaga((Number(b) / 100).toString())}>{pesos(b, { decimals: false })}</button>)}
        <button type="button" className="chip" onClick={() => setPaga((Number(totalCents) / 100).toString())}>Exacto</button>
      </div>
      {cambio !== null && (
        <div className="cambio-total" data-falta={cambio < 0n ? 'true' : undefined}>
          <span>{cambio < 0n ? 'Falta' : 'Cambio'}</span>
          <strong className="num">{pesos(cambio < 0n ? -cambio : cambio)}</strong>
        </div>
      )}
    </div>
  );
}
