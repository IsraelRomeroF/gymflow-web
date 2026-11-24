'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ticket } from 'lucide-react';
import type { AccessAttemptResult, MemberTrialPass, TrialPassGrantResult } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession, errorText } from './session';
import { Button, Callout } from './ui';
import type { Rechazo, RechazoResuelto } from './cobro/resolver-rechazo';

/*
 * EL PASE DE PRUEBA EN LA PUERTA (fase 3, bloque 3.3; D-08).
 *
 * Quien viene a probar todavía no es socio: la puerta le dice «sin membresía».
 * Ahí, junto a «Vender y abrir», está su pase de prueba: gratis, UNO por
 * persona (por celular) y registrado como entrada. Un toque lo da y registra
 * la entrada sobre el mismo rechazo.
 *
 * Solo aparece si se le puede dar. Si ya lo usó (él, o alguien con su mismo
 * celular) o le falta el celular, se dice por qué en vez de esconderlo: es lo
 * que recepción necesita para contestarle al «vengo a probar».
 */
export function usePaseDePrueba(rechazo: Rechazo | null, opciones: { onResuelto: (r: RechazoResuelto) => void }): {
  /** El botón, junto a las demás salidas; `null` si no se le puede dar. */
  boton: ReactNode;
  /** Por qué no se le puede dar, o qué falló al darlo. */
  aviso: ReactNode;
} {
  const { can } = useSession();
  const aplica = rechazo?.reason === 'NO_MEMBERSHIP' && can('memberships:create');
  const memberId = rechazo?.memberId ?? null;
  const [estado, setEstado] = useState<MemberTrialPass | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claveEntrada = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!aplica || !memberId) return;
    let vigente = true;
    // Si no responde, simplemente no se ofrece: la venta sigue ahí.
    api<MemberTrialPass>(`/members/${memberId}/trial-pass`).then((e) => { if (vigente) setEstado(e); }).catch(() => undefined);
    return () => { vigente = false; };
  }, [aplica, memberId]);

  if (!rechazo || !aplica) return { boton: null, aviso: null };
  const r = rechazo;

  async function dar() {
    setEnCurso(true);
    setError(null);
    try {
      const dado = await api<TrialPassGrantResult>(`/members/${r.memberId}/trial-pass`, { method: 'POST', body: JSON.stringify({ branchId: r.branchId }) });
      const i = await api<AccessAttemptResult>('/access/attempts', {
        method: 'POST',
        body: JSON.stringify({
          branchId: r.branchId, memberId: r.memberId, credentialKind: 'MANUAL', requestKey: claveEntrada.current,
          reason: 'Entra con su pase de prueba', resolvesDecisionId: r.decisionId,
        }),
      });
      if (i.outcome === 'GRANTED') {
        opciones.onResuelto({
          titulo: `${r.memberName} entra hoy con su pase de prueba.`,
          detalle: `La entrada quedó registrada. Es su único pase de prueba (celular terminado en ${dado.pass.phoneLast4}); vale hoy, en esta sucursal.`,
          veredicto: null, paymentId: null,
        });
      } else {
        claveEntrada.current = crypto.randomUUID();
        setError(`Su pase de prueba quedó dado, pero todavía no puede pasar: ${(DENIAL_REASON[i.reason ?? ''] ?? 'revisa su ficha').toLowerCase()}.`);
      }
    } catch (e) {
      setError(errorText(e, 'No se pudo dar el pase de prueba'));
      // Lo que cambió (ya lo usó, le falta el celular) se vuelve a preguntar.
      api<MemberTrialPass>(`/members/${r.memberId}/trial-pass`).then(setEstado).catch(() => undefined);
    } finally { setEnCurso(false); }
  }

  const boton = estado?.eligible
    ? <Button variant="secondary" icon={<Ticket />} loading={enCurso} onClick={() => void dar()} data-testid="pase-de-prueba">Pase de prueba (gratis)</Button>
    : null;
  // A quien ya es o fue socio no se le explica nada: no viene a probar.
  const explicable = estado && !estado.eligible && (estado.blockedBy === 'TRIAL_PASS_ALREADY_USED' || estado.blockedBy === 'TRIAL_PASS_NEEDS_PHONE');
  const aviso = error
    ? <Callout tone="warn">{error}</Callout>
    : explicable
      ? <p className="small muted" data-testid="pase-de-prueba-no">Pase de prueba: {estado.blockedText}</p>
      : estado?.eligible
        ? <p className="small muted">¿Viene a probar? Tiene un pase de prueba gratis, una sola vez.</p>
        : null;
  return { boton, aviso };
}
