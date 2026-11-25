'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { errorText, useSession, useToast } from '@/components/session';
import { useCarga } from '@gymflow/ui/carga';

type Coach = { id: string; fullName: string; branchIds: string[] };

/**
 * El coach del socio (2026-10-09; D-29, fase 3). Recepción lo elige AL ALTA;
 * aquí, en la ficha, lo pone o lo cambia solo la gerencia
 * (`members:coach:assign`). Recepción ve quién es, sin poder cambiarlo. El
 * coach solo ve a los socios que tiene asignados; sin coach asignado, cuenta
 * quien le asignó su rutina vigente.
 */
export function CoachDelSocio({ memberId, coachUserId, homeBranchId, onCambio }: {
  memberId: string; coachUserId: string | null; homeBranchId: string | null; onCambio: (id: string | null) => void;
}) {
  const { me, can } = useSession();
  const toast = useToast();
  const elige = can('members:coach:assign');
  // Quien inscribe ve la lista de coaches (la usa al alta): aquí le sirve para decir el nombre.
  const veNombres = elige || can('members:create');
  const [guardando, setGuardando] = useState(false);
  // Sin red no es «El gimnasio aún no tiene coaches» (26-01).
  const cargar = useCallback(() => api<{ coaches: Coach[] }>('/members/coaches').then((r) => r.coaches), []);
  const carga = useCarga(veNombres ? cargar : null);
  const coaches = carga.datos ?? null;

  if (!elige) {
    const nombre = coachUserId ? coaches?.find((c) => c.id === coachUserId)?.fullName ?? null : null;
    return (
      <span className="small" data-testid="coach-socio-lectura">
        {coachUserId === me.userId ? 'Tú' : coachUserId ? nombre ?? 'Asignado' : <span className="muted">Sin coach asignado</span>}
        {veNombres && <span className="tiny muted"> · lo cambia la gerencia</span>}
      </span>
    );
  }
  if (carga.error) return <span className="small muted">No se pudo cargar la lista de coaches. <button type="button" className="enlace-en-linea" onClick={() => void carga.recargar()}>Reintentar</button></span>;
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
