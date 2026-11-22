'use client';

import type { ApprovalApprover, ApprovalRequestState } from '@gymflow/core/contracts';
import { hora } from '@/lib/format';
import { Callout } from '../compartido';

export type Solicitud = ApprovalRequestState;
export type Firmante = ApprovalApprover;

export const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A quién se le pidió, por nombre: «Mariana Villaseñor» o «quien puede autorizar». */
export const nombres = (firmantes: readonly Pick<Firmante, 'fullName'>[]) => firmantes.map((f) => f.fullName).join(', ') || 'quien puede autorizar';

/**
 * CÓMO SE VA A ENTERAR QUIEN FIRMA (29-05), dicho antes de pedir. Con el uso
 * en local de hoy la dueña casi nunca tiene avisos en su teléfono: prometer
 * «le llega a su teléfono» dejaba al mostrador esperando diez minutos algo
 * que nadie iba a ver. `null` cuando no hay nada que advertir.
 */
export function avisoDeAlcance(firmantes: readonly Firmante[]): string | null {
  if (firmantes.length === 0 || firmantes.some((f) => f.reach === 'push')) return null;
  const quien = nombres(firmantes);
  const plural = firmantes.length > 1;
  if (firmantes.some((f) => f.reach === 'panel')) {
    return `${quien} no ${plural ? 'tienen' : 'tiene'} avisos en su teléfono, pero ${plural ? 'alguien tiene' : 'tiene'} el panel abierto: la verá en Autorizaciones.`;
  }
  return `${quien} no ${plural ? 'tienen' : 'tiene'} avisos en su teléfono ni el panel abierto: solo la verá si abre el panel. Si urge, avísale por otro medio o que firme aquí.`;
}

/** Lo mismo, mientras se espera: lo que de verdad pasó con ESTA solicitud. */
function alcanceEnEspera(s: Solicitud, firmantes: readonly Firmante[]): string {
  const quien = nombres(firmantes);
  if (s.seenAt) return `${quien} ya la tiene a la vista en Autorizaciones desde las ${hora(s.seenAt)}.`;
  if (s.notifiedCount > 0) return `Le llegó el aviso a su teléfono. También la ve en el panel, en Autorizaciones.`;
  if (firmantes.some((f) => f.reach === 'panel')) return `${quien} tiene el panel abierto: la verá en Autorizaciones. No tiene avisos en su teléfono.`;
  return `No le llegó ningún aviso: ${quien} no tiene avisos en su teléfono. Solo la verá si abre el panel, en Autorizaciones.`;
}

/** Por qué venció (29-05): nunca «nadie la contestó» a secas. */
function porQueVencio(s: Solicitud, firmantes: readonly Firmante[]): string {
  const quien = nombres(firmantes);
  if (s.seenAt) return `${quien} la tuvo a la vista desde las ${hora(s.seenAt)} y no contestó.`;
  if (s.notifiedCount > 0) return 'Le llegó el aviso a su teléfono y no la abrió.';
  return `No la vio: ${quien} no la tuvo a la vista en Autorizaciones y no le llegó ningún aviso a su teléfono.`;
}

/** Qué pasó con la firma de una aprobada que no llegó a esta pantalla (29-03). */
function textoDeEntrega(delivery: Solicitud['delivery'], minutosFirma: number): string {
  switch (delivery) {
    case 'used': return 'Su firma ya se usó, en esta u otra pantalla. Revisa si la operación quedó registrada antes de volver a pedirla.';
    case 'expired': return `Su firma venció sin usarse (vale ${minutosFirma} minutos): con ella no se registró nada. Vuelve a pedirla.`;
    case 'ready':
    case null:
      return `La firma ya no está disponible en esta pantalla: se usó o pasaron sus ${minutosFirma} minutos. Revisa si la operación quedó registrada antes de volver a pedirla.`;
  }
}

/** Para que un estado nuevo no compile hasta decidir cómo se pinta. */
function sinPintar(x: never): never {
  throw new Error(`Desenlace de firma sin pintar: ${String(x)}`);
}

/**
 * Los cinco desenlaces de una solicitud, con un `switch` sin `default`
 * (29-09): un estado nuevo —la pregunta de la dueña en D-03, por ejemplo— no
 * compila hasta que se decide cómo se ve. Nunca «nadie la contestó» cuando
 * sí se autorizó (29-03), «venció» solo cuando el servidor lo dice (29-06) y,
 * al vencer, qué pasó del otro lado (29-05). Solo el bloque del resultado es
 * región viva: el lector de pantalla lo anuncia una vez.
 */
export function Desenlace({ s, firmantes, restan, minutos, minutosFirma }: {
  s: Solicitud; firmantes: readonly Firmante[]; restan: number | null; minutos: number; minutosFirma: number;
}) {
  const cuando = s.decidedAt ? ` a las ${hora(s.decidedAt)}` : '';
  switch (s.status) {
    case 'PENDING':
      return (
        <div role="status" className="stack-sm">
          <Callout tone="info" title="Esperando la autorización">
            {alcanceEnEspera(s, firmantes)} En cuanto la apruebe con su contraseña, esto sigue solo.
          </Callout>
          <p className="firma-cuenta">
            {restan === null ? null : restan > 0
              ? <><span className="muted">Vence en</span> <span className="num firma-cuenta-reloj">{reloj(restan)}</span></>
              : <span className="muted">Confirmando con el servidor si todavía la puede firmar…</span>}
          </p>
        </div>
      );
    case 'APPROVED':
      // Con la firma en mano la operación ya siguió sola: aquí solo se llega sin ella.
      return (
        <div role="status">
          <Callout tone="warn" title={`${s.approverName ?? 'Quien autoriza'} la autorizó${cuando}`}>{textoDeEntrega(s.delivery, minutosFirma)}</Callout>
        </div>
      );
    case 'REJECTED':
      // D-03 (fase 3) cuelga aquí: el «no» pegado a la operación y «Responder y volver a pedir».
      return (
        <Callout tone="danger" title={`${s.approverName ?? 'Quien autoriza'} no la autorizó${cuando}`}>
          {s.rejectReason && <p className="firma-cita">«{s.rejectReason}»</p>}
          <p className="small">No se registró nada. Habla con {s.approverName ?? 'quien autoriza'} o corrige la operación antes de volver a pedirla.</p>
        </Callout>
      );
    case 'EXPIRED':
      return (
        <div role="status">
          <Callout tone="warn" title={`Sin respuesta en ${minutos} minutos`}>
            {porQueVencio(s, firmantes)} No se registró nada.
          </Callout>
        </div>
      );
    case 'CANCELED':
      return (
        <div role="status">
          <Callout tone="info" title="La solicitud se canceló">Ya no se puede autorizar. Si todavía hace falta, vuelve a pedirla.</Callout>
        </div>
      );
    default:
      return sinPintar(s.status);
  }
}
