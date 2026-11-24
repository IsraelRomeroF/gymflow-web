'use client';

import { useCallback } from 'react';
import type { SignatureBrief } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { useCarga } from '@/lib/carga';

/**
 * RESUMEN DE LA OPERACIÓN AL FIRMAR (fase 3, bloque 3.7 · D-25). Quien firma
 * ve, junto a lo que le piden, de quién se trata en tres datos: desde cuándo
 * es socio, cuánto debe y cuántas correcciones de dinero lleva. Sin nombre
 * (ya lo dice la solicitud) y sin abrir su expediente.
 *
 * No pinta nada si la operación no toca a un socio (un retiro de caja, el
 * cierre de mes), mientras llega o si la consulta falla: es contexto, no un
 * requisito para firmar.
 */
export function ResumenAlFirmar({ resourceType, resourceId }: { resourceType: string | null | undefined; resourceId: string | null | undefined }) {
  const cargar = useCallback(() => api<SignatureBrief>(`/reports/signature-brief?resourceType=${resourceType}&resourceId=${resourceId}`), [resourceType, resourceId]);
  const carga = useCarga(resourceType && resourceId ? cargar : null);
  const m = carga.datos?.member;
  if (!m) return null;
  const debe = BigInt(m.outstandingCents);
  const vencido = BigInt(m.overdueCents);
  return (
    <p className="small muted" data-testid="resumen-al-firmar">
      Socio desde el {fecha(m.memberSince)}
      {' · '}{debe > 0n ? <>debe <strong className="num">{pesos(debe)}</strong>{vencido > 0n && vencido !== debe ? ` (${pesos(vencido)} ya vencido)` : vencido > 0n ? ' (todo vencido)' : ''}</> : 'no debe nada'}
      {' · '}{m.corrections.total === 0 ? 'sin correcciones de dinero' : `${m.corrections.last90Days} ${m.corrections.last90Days === 1 ? 'corrección' : 'correcciones'} de dinero en 90 días (${m.corrections.total} en total)`}
    </p>
  );
}
