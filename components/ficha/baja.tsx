'use client';

import { useCallback } from 'react';
import { UserMinus } from 'lucide-react';
import type { MemberStanding } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import { useCarga } from '@/lib/carga';

/**
 * «DE BAJA DESDE» en la ficha (fase 4, bloque 4.4 · D-18). Baja es quien
 * canceló su membresía o lleva el plazo del gimnasio (30 días) con la
 * membresía terminada sin renovar. Nadie lo guarda: la API lo calcula
 * (`GET /members/:id/standing`). De quien fue dado de baja en su ficha no dice
 * nada: eso ya lo dice su insignia. Si la consulta falla, no pinta nada: es
 * un dato de contexto, no una acción.
 */
export function BajaDelSocio({ memberId, version = 0 }: { memberId: string; version?: number }) {
  // `version` cambia cuando la ficha vuelve a pedir la cuenta (una venta, una cancelación): se pregunta de nuevo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const carga = useCarga(useCallback(() => api<MemberStanding>(`/members/${memberId}/standing`), [memberId, version]));
  const s = carga.datos;
  if (!s) return null;
  if (s.churn && s.churn.cause !== 'ARCHIVED') {
    return (
      <span data-testid="de-baja-desde"><UserMinus />
        De baja desde el {fecha(s.churn.since)}: {s.churn.cause === 'CANCELED' ? 'canceló su membresía' : `su membresía terminó${s.churn.endedOn ? ` el ${fecha(s.churn.endedOn)}` : ''} y no renovó`}
      </span>
    );
  }
  if (s.churnsOn) return <span data-testid="de-baja-desde"><UserMinus />Su membresía terminó: contará como baja el {fecha(s.churnsOn)} si no renueva</span>;
  return null;
}
