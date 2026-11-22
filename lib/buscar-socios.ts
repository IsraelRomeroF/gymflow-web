'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { MemberSearchResponse, MemberSummary } from '@gymflow/core/contracts';

/**
 * Lo que la búsqueda devuelve de cada socio: el resumen completo del contrato
 * del núcleo (2-13). Los buscadores que solo pintan nombre y código usan lo
 * que necesitan; la tarjeta del socio lo usa entero.
 */
export type SocioHallado = MemberSummary;

/**
 * ¿Lo tecleado es el código exacto de este socio? Es lo que manda un lector de
 * código de barras ("CEN-00027" y Enter en milisegundos): con un solo socio
 * así, el mostrador puede actuar sin que nadie elija de una lista (5-01).
 */
export function esCodigoExacto(q: string, s: { memberCode: string }): boolean {
  return q.trim().toUpperCase() === s.memberCode.toUpperCase();
}

/**
 * El socio cuyo código es EXACTAMENTE lo tecleado, si hay uno solo (5-01).
 * Uno vigente gana a una ficha dada de baja con el mismo código.
 */
export function codigoExacto<T extends { memberCode: string; status?: string }>(rs: readonly T[], q: string): T | null {
  const exactos = rs.filter((m) => esCodigoExacto(q, m));
  const vivos = exactos.filter((m) => m.status !== 'ARCHIVED');
  if (vivos.length === 1) return vivos[0]!;
  return vivos.length === 0 && exactos.length === 1 ? exactos[0]! : null;
}

/**
 * BUSCAR SOCIOS mientras se teclea: LA búsqueda del panel (bloque 2.1). Antes
 * había tres escritas a mano —la de `/socios`, la de Ctrl K y esta— con tres
 * retardos y tres maneras de fallar. Un solo lugar para el retardo, el mínimo
 * de dos letras y la diferencia entre «nadie coincide» y «sin red».
 *
 * `hallados` es null mientras no hay búsqueda; `fallo` dice que la red falló.
 * `consulta` es lo que contestan `hallados`, y `enEspera` dice que ya se
 * tecleó otra cosa y su respuesta no ha llegado (5-01, auditoría 8): sobre
 * una lista en espera no se actúa, porque es de la búsqueda anterior. Una
 * respuesta lenta de una tecla vieja no pisa a una más reciente, y la lista
 * anterior se conserva (atenuada por quien la pinta) hasta que llega la nueva.
 *
 * `limit`: seis por omisión (las listas cortas de Clases y Rutinas); el
 * mostrador pide veinte. `activa: false` apaga la búsqueda (quien no ve el padrón).
 */
export function useBuscarSocios(q: string, opts: { limit?: number; delay?: number; activa?: boolean } = {}): {
  hallados: SocioHallado[] | null; consulta: string | null; enEspera: boolean; fallo: boolean; buscando: boolean; reintentar: () => void;
} {
  const [hallados, setHallados] = useState<SocioHallado[] | null>(null);
  const [consulta, setConsulta] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [intento, setIntento] = useState(0);
  const limit = opts.limit ?? 6; const delay = opts.delay ?? 200; const activa = opts.activa ?? true;
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || !activa) { setHallados(null); setConsulta(null); setFallo(false); setBuscando(false); return; }
    let vigente = true;
    setBuscando(true);
    const id = setTimeout(() => {
      api<MemberSearchResponse>(`/members/search?q=${encodeURIComponent(t)}&limit=${limit}`)
        .then((r) => { if (vigente) { setHallados(r.results); setConsulta(t); setFallo(false); } })
        .catch((e) => {
          // Sin sesión, el marco ya lleva al login con el motivo y esta pantalla (24-06).
          if (e instanceof ApiError && e.status === 401) return;
          if (vigente) { setHallados(null); setConsulta(null); setFallo(true); }
        })
        .finally(() => { if (vigente) setBuscando(false); });
    }, delay);
    return () => { vigente = false; clearTimeout(id); };
  }, [q, limit, delay, activa, intento]);
  const enEspera = activa && q.trim().length >= 2 && consulta !== q.trim() && !fallo;
  return { hallados, consulta, enEspera, fallo, buscando, reintentar: () => setIntento((x) => x + 1) };
}
