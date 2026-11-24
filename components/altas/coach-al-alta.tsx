'use client';

import { useCallback } from 'react';
import type { CoachOptions } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { Field } from '@/components/ui';

/**
 * «SU COACH», AL ALTA (D-29, fase 3, bloque 3.8).
 *
 * Quien da de alta (en el mostrador o al aprobar un alta por QR) elige el
 * coach del socio aquí. Es opcional y es el único momento en que recepción lo
 * elige: después lo cambia la gerencia, o el coach se suma con el código que
 * el socio le dicta. Si el gimnasio no tiene coaches, no se pregunta nada.
 */
export function CoachAlAlta({ id, value, onChange, branchId }: {
  id: string; value: string; onChange: (coachUserId: string) => void;
  /** Sucursal del alta: sus coaches van primero. */
  branchId?: string | null;
}) {
  const carga = useCarga(useCallback(() => api<CoachOptions>('/members/coaches').then((r) => r.coaches), []));
  // Sin red el alta sigue: el coach es opcional y la gerencia lo pone después.
  if (!carga.datos || carga.datos.length === 0) return null;
  const orden = [...carga.datos].sort((a, b) => Number(!!branchId && b.branchIds.includes(branchId)) - Number(!!branchId && a.branchIds.includes(branchId)));
  return (
    <Field label="Su coach" htmlFor={id} hint="Opcional. Su coach verá su ficha y le armará su rutina. Después del alta solo lo cambia la gerencia.">
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} data-testid="coach-al-alta">
        <option value="">Sin coach por ahora</option>
        {orden.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
      </select>
    </Field>
  );
}
