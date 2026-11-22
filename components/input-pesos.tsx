'use client';

import { useState } from 'react';
import { parsePesos, textoPesos } from '@/lib/pesos';

/**
 * CAMPO DE DINERO único (fase 4): el usuario teclea pesos, el sistema recibe
 * centavos como BigInt o null si no es un importe. Antes cada pantalla tenía
 * su propia expresión regular.
 */
export function InputPesos({ id, valueCents, onChange, placeholder, autoFocus, style, ariaLabel, disabled }: {
  id?: string; valueCents: bigint | null; onChange: (cents: bigint | null, texto: string) => void;
  placeholder?: string; autoFocus?: boolean; style?: React.CSSProperties; ariaLabel?: string; disabled?: boolean;
}) {
  const [texto, setTexto] = useState(() => textoPesos(valueCents));
  return (
    <input id={id} className="input num" inputMode="decimal" placeholder={placeholder ?? '0.00'} autoFocus={autoFocus} style={style} aria-label={ariaLabel} disabled={disabled}
      value={texto} onChange={(e) => { setTexto(e.target.value); onChange(parsePesos(e.target.value), e.target.value); }}
      onBlur={() => { const c = parsePesos(texto); if (c !== null) setTexto(textoPesos(c)); }} />
  );
}
