'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GymflowAccount } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, pesos } from '@gymflow/ui/format';
import { useSession } from './session';
import { Callout } from './ui';

/**
 * LO QUE GYMFLOW LE AVISA AL DUEÑO, ARRIBA DE SU PANEL (D-37, bloque 3.11).
 *
 * Antes nadie le avisaba al gimnasio que tenía una factura de GymFlow: el día
 * que se suspendía, su recepción simplemente no podía entrar. Ahora el dueño
 * ve aquí la factura emitida, la vencida con el día en que el servicio se
 * suspende si no se paga, y los cambios anunciados de su mensualidad.
 *
 * Solo el dueño lo ve. Al tenerlo a la vista se avisa al servidor
 * (`POST /gymflow-account/seen`): es la constancia de que el aviso le llegó,
 * y desde ella cuentan los 15 días de la suspensión automática.
 */
export function useCuentaConGymflow(): { cuenta: GymflowAccount | null; recargar: () => void } {
  const { mirada } = useSession();
  const esDueno = mirada.roles.includes('OWNER');
  const [cuenta, setCuenta] = useState<GymflowAccount | null>(null);
  const recargar = useCallback(() => {
    if (!esDueno) return;
    // Si no carga, no estorba: es un aviso, no la pantalla.
    api<GymflowAccount>('/gymflow-account').then(setCuenta).catch(() => setCuenta(null));
  }, [esDueno]);
  useEffect(recargar, [recargar]);
  return { cuenta: esDueno ? cuenta : null, recargar };
}

/** Avisa una sola vez por carga que el dueño tiene los avisos a la vista. */
export function useAvisosVistos(cuenta: GymflowAccount | null): void {
  const avisado = useRef(false);
  useEffect(() => {
    if (avisado.current || !cuenta?.visible || !cuenta.notices.some((n) => !n.seen)) return;
    avisado.current = true;
    api('/gymflow-account/seen', { method: 'POST' }).catch(() => { avisado.current = false; });
  }, [cuenta]);
}

export function AvisoDeGymflow() {
  const ruta = usePathname();
  const { cuenta } = useCuentaConGymflow();
  useAvisosVistos(cuenta);
  // En su propia pantalla ya está todo: no se repite arriba.
  if (!cuenta?.visible || ruta === '/cuenta-gymflow') return null;
  const vencida = cuenta.status.code === 'VENCIDA';
  const avisos = cuenta.notices.filter((n) => n.kind !== 'INVOICE_ISSUED' || !vencida);
  if (avisos.length === 0 && !vencida) return null;
  const principal = avisos[0];
  return (
    <div className="mb-16" data-testid="aviso-gymflow" data-cobro={cuenta.status.code}>
      <Callout tone={vencida ? 'danger' : 'warn'} title={vencida ? `Debes ${pesos(cuenta.status.pendingCents)} a GymFlow` : principal?.title ?? 'Aviso de GymFlow'}>
        {vencida && cuenta.suspendsOn && <p>Si el pago no se registra, <strong>el servicio se suspende el {fecha(cuenta.suspendsOn)}</strong>: nadie del gimnasio podrá entrar al sistema hasta que se pague. Tus datos se conservan.</p>}
        {vencida && !cuenta.suspendsOn && <p>La factura ya venció. Si no se paga, el servicio se suspende a los {cuenta.suspendsAfterDays} días de atraso.</p>}
        {!vencida && principal && <p>{principal.body}</p>}
        {avisos.length > 1 && <p className="tiny muted">Y {avisos.length - 1} {avisos.length === 2 ? 'aviso más' : 'avisos más'}.</p>}
        <Link href="/cuenta-gymflow" className="btn btn-secondary btn-sm callout-accion">Ver mi cuenta con GymFlow</Link>
      </Callout>
    </div>
  );
}
