'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GymChangeRequestList } from '@gymflow/core/contracts';
import { DATO_DEL_GIMNASIO } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { useSession } from './session';
import { Callout } from './ui';

/**
 * «GYMFLOW CONTESTÓ TU SOLICITUD», ARRIBA DEL PANEL (D-27, bloque 4.6).
 *
 * Los datos y la marca del gimnasio los cambia GymFlow; la dueña o la
 * gerencia los piden desde «Mi gimnasio». Cuando GymFlow aplica o rechaza una
 * solicitud, quien la pidió lo ve aquí en su siguiente pantalla, con el
 * enlace a la respuesta. Al abrir «Mi gimnasio» el aviso se da por visto.
 * Solo pregunta por quien puede pedir cambios; a nadie más le sale nada.
 */
export function AvisoDeSolicitudes() {
  const ruta = usePathname();
  const { can, mirada } = useSession();
  const pide = mirada.roles.includes('OWNER') || can('settings:org') || can('settings:branch');
  const [lista, setLista] = useState<GymChangeRequestList | null>(null);
  useEffect(() => {
    if (!pide) return;
    // Si no carga, no estorba: es un aviso, no la pantalla.
    api<GymChangeRequestList>('/gym-change-requests').then(setLista).catch(() => setLista(null));
  }, [pide, ruta]);
  // En «Mi gimnasio» la respuesta ya está a la vista: no se repite arriba.
  if (!pide || !lista || lista.unseen === 0 || ruta === '/gimnasio') return null;
  const nuevas = lista.requests.filter((s) => s.mine && s.status !== 'PENDING' && !s.seen);
  const primera = nuevas[0];
  if (!primera) return null;
  const rechazada = primera.status === 'REJECTED';
  const dato = `${DATO_DEL_GIMNASIO[primera.field] ?? 'un dato'}${primera.branchName ? ` (${primera.branchName})` : ''}`;
  return (
    <div className="mb-16" data-testid="aviso-solicitud" data-solicitud={primera.status}>
      <Callout tone={rechazada ? 'warn' : 'ok'} title={rechazada ? 'GymFlow no aplicó el cambio que pediste' : 'GymFlow aplicó el cambio que pediste'}>
        <p>{dato}{primera.response ? `: «${primera.response}»` : rechazada ? '.' : ': ya quedó registrado.'}</p>
        {nuevas.length > 1 && <p className="tiny muted">Y {nuevas.length - 1} {nuevas.length === 2 ? 'respuesta más' : 'respuestas más'}.</p>}
        <Link href="/gimnasio" className="btn btn-secondary btn-sm callout-accion">Ver en Mi gimnasio</Link>
      </Callout>
    </div>
  );
}
