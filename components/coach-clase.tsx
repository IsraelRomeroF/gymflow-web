'use client';

import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { errorText, useToast } from '@/components/session';
import { useCarga } from '@gymflow/ui/carga';

export type CoachDeClase = { id: string; fullName: string; branchIds: string[] };

/**
 * Los coaches del gimnasio (2026-10-09). Primero los de la sucursal dada.
 * Sin red no es «No hay coaches dados de alta» (26-01): `error` lo dice y
 * `recargar` lo reintenta.
 */
export function useCoachesDeClases(branchId?: string): { coaches: CoachDeClase[] | null; error: string | null; recargar: () => Promise<void> } {
  const carga = useCarga(useCallback(() => api<{ coaches: CoachDeClase[] }>('/classes/coaches').then((r) => r.coaches), []));
  const coaches = useMemo(() => (carga.datos
    ? [...carga.datos].sort((a, b) => Number(!!branchId && b.branchIds.includes(branchId)) - Number(!!branchId && a.branchIds.includes(branchId)))
    : null), [carga.datos, branchId]);
  return { coaches, error: carga.error, recargar: carga.recargar };
}

/**
 * Quién imparte: en un horario (cambia sus clases futuras) o en UNA clase (un
 * suplente). El socio lo ve en su portal.
 */
export function ElegirCoach({ url, valor, branchId, onCambio, id, etiqueta = 'Quién la imparte', sinVacio = false }: {
  url: string; valor: string | null; branchId?: string; onCambio: (coachUserId: string | null, nombre: string | null) => void; id: string; etiqueta?: string;
  /** El coach que pone suplente en SU sesión tiene que nombrar a alguien (D-28): dejarla sin coach es de quien arma el horario. */
  sinVacio?: boolean;
}) {
  const toast = useToast();
  const { coaches, error, recargar } = useCoachesDeClases(branchId);
  const [guardando, setGuardando] = useState(false);
  if (error) return <span className="small muted">No se pudo cargar la lista de coaches. <button type="button" className="enlace-en-linea" onClick={() => void recargar()}>Reintentar</button></span>;
  if (coaches === null) return <span className="small muted">…</span>;
  async function cambiar(nuevo: string) {
    setGuardando(true);
    try {
      await api(url, { method: 'PUT', body: JSON.stringify({ coachUserId: nuevo || null }) });
      const nombre = coaches!.find((c) => c.id === nuevo)?.fullName ?? null;
      onCambio(nuevo || null, nombre);
      toast('ok', nombre ? `La imparte ${nombre}` : 'Sin coach asignado');
    } catch (e) { toast('error', errorText(e, 'No se pudo cambiar el coach')); } finally { setGuardando(false); }
  }
  return (
    <label className="row gap-8 items-center small" htmlFor={id}>
      <span className="muted">{etiqueta}</span>
      <select id={id} className="select w-auto" disabled={guardando || coaches.length === 0} value={valor ?? ''} onChange={(e) => void cambiar(e.target.value)} data-testid="elegir-coach">
        {(!sinVacio || valor === null) && <option value="">{coaches.length === 0 ? 'No hay coaches dados de alta' : 'Sin coach asignado'}</option>}
        {coaches.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
      </select>
    </label>
  );
}
