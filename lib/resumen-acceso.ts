'use client';

import { useEffect, useState } from 'react';
import type { AccessSummaryResponse } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import type { ResumenAcceso } from '@/components/acceso';

/** Lo más que acepta `GET /members/access-summary` por petición. */
export const LOTE_RESUMEN = 100;

/** Parte la lista en lotes, sin repetir ids. */
export function lotesDe<T>(xs: readonly T[], tam = LOTE_RESUMEN): T[][] {
  const unicos = [...new Set(xs)];
  const out: T[][] = [];
  for (let i = 0; i < unicos.length; i += tam) out.push(unicos.slice(i, i + tam));
  return out;
}

/**
 * Resumen de acceso POR LOTES de 100 (2-06, auditoría 8). Con «Cargar más» el
 * padrón pasa de 100 socios y la petición única respondía 422: las insignias
 * se quedaban en «…» para siempre y nadie lo notaba. Aquí cada lote va por su
 * lado, y si alguno falla, `fallo` lo dice para pintar «sin dato» con
 * reintento en lugar de «…».
 *
 * Mismo resultado que `useResumenAcceso` (`components/acceso.tsx`), que sigue
 * siendo la pieza para un socio o unos pocos.
 */
export function useResumenAccesoPorLotes(ids: readonly string[], version = ''): {
  mapa: Map<string, ResumenAcceso>; fallo: boolean; reintentar: () => void;
} {
  const [mapa, setMapa] = useState<Map<string, ResumenAcceso>>(new Map());
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  const clave = [...new Set(ids)].join(',');
  useEffect(() => {
    if (!clave) { setMapa(new Map()); setFallo(false); return; }
    let vigente = true;
    setFallo(false);
    void Promise.allSettled(lotesDe(clave.split(',')).map((lote) =>
      api<AccessSummaryResponse>(`/members/access-summary?ids=${lote.join(',')}`),
    )).then((rs) => {
      if (!vigente) return;
      const m = new Map<string, ResumenAcceso>();
      for (const r of rs) {
        if (r.status !== 'fulfilled') continue;
        for (const s of r.value.members) m.set(s.memberId, { ...s, allowWhilePastDue: r.value.allowAccessWhilePastDue });
      }
      setMapa(m);
      setFallo(rs.some((r) => r.status === 'rejected'));
    });
    return () => { vigente = false; };
  }, [clave, version, intento]);
  return { mapa, fallo, reintentar: () => setIntento((x) => x + 1) };
}
