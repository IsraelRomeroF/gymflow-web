'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { errorText, useSession, useToast } from '@/components/session';
import { useCarga } from '@/lib/carga';

type Coach = { id: string; fullName: string; branchIds: string[] };

/**
 * El coach del socio (2026-10-09). Quien inscribe (gerencia y recepción) lo
 * elige aquí; el coach solo ve a los socios que tiene asignados. Sin coach
 * asignado, cuenta quien le asignó su rutina vigente.
 */
export function CoachDelSocio({ memberId, coachUserId, homeBranchId, onCambio }: {
  memberId: string; coachUserId: string | null; homeBranchId: string | null; onCambio: (id: string | null) => void;
}) {
  const { me, can } = useSession();
  const toast = useToast();
  const elige = can('members:create');
  const [guardando, setGuardando] = useState(false);
  // Sin red no es «El gimnasio aún no tiene coaches» (26-01).
  const cargar = useCallback(() => api<{ coaches: Coach[] }>('/members/coaches').then((r) => r.coaches), []);
  const carga = useCarga(elige ? cargar : null);
  const coaches = carga.datos ?? null;

  if (!elige) return <span className="small">{coachUserId === me.userId ? 'Tú' : coachUserId ? 'Asignado' : <span className="muted">Sin coach asignado</span>}</span>;
  if (carga.error) return <span className="small muted">No se pudo cargar la lista de coaches. <button type="button" className="row-link" onClick={() => void carga.recargar()}>Reintentar</button></span>;
  if (coaches === null) return <span className="small muted">…</span>;
  if (coaches.length === 0) return <span className="small muted">El gimnasio aún no tiene coaches</span>;
  // Primero los de su sucursal de casa.
  const orden = [...coaches].sort((a, b) => Number(!!homeBranchId && b.branchIds.includes(homeBranchId)) - Number(!!homeBranchId && a.branchIds.includes(homeBranchId)));

  async function cambiar(id: string) {
    setGuardando(true);
    try {
      await api(`/members/${memberId}/coach`, { method: 'PUT', body: JSON.stringify({ coachUserId: id || null }) });
      onCambio(id || null);
      toast('ok', id ? `Asignado a ${coaches!.find((c) => c.id === id)?.fullName ?? 'su coach'}` : 'Sin coach asignado');
    } catch (e) { toast('error', errorText(e, 'No se pudo asignar el coach')); } finally { setGuardando(false); }
  }
  return (
    <select className="select w-auto" aria-label="Coach asignado" data-testid="coach-socio" disabled={guardando} value={coachUserId ?? ''} onChange={(e) => void cambiar(e.target.value)}>
      <option value="">Sin coach asignado</option>
      {orden.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
    </select>
  );
}
