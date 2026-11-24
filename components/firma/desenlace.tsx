'use client';

import { useState } from 'react';
import type { ApprovalApprover, ApprovalPreviousRejection, ApprovalRequestState } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { hora } from '@/lib/format';
import { Callout } from '../compartido';
import { errorText } from '../session';
import { Button, CampoMotivo, faltaMotivo } from '../ui';

export type Solicitud = ApprovalRequestState;
export type Firmante = ApprovalApprover;

/** Quién la contestó; si lo hizo con un nombramiento (D-02), de quién es apoderado. */
export const quienContesto = (s: Pick<ApprovalRequestState, 'approverName' | 'approverProxyOf'>) =>
  `${s.approverName ?? 'Quien autoriza'}${s.approverProxyOf ? ` (como apoderado de ${s.approverProxyOf})` : ''}`;

/** Un firmante de «Pueden autorizar», con de quién es apoderado si firma por un nombramiento (D-02). */
export const nombreDeFirmante = (f: Pick<Firmante, 'fullName' | 'proxyOf'>) => (f.proxyOf ? `${f.fullName} (apoderado de ${f.proxyOf})` : f.fullName);

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

/**
 * EL «NO» ANTERIOR DE ESTA OPERACIÓN (D-03): quién, a qué hora y por qué, como
 * cita. Lo ve quien pide antes de volver a pedir, y mientras espera.
 */
export function RechazoAnterior({ r, children }: { r: ApprovalPreviousRejection; children?: React.ReactNode }) {
  return (
    <Callout tone="danger" title={`${r.byName ?? 'Quien autoriza'} ya la rechazó a las ${hora(r.at)}`}>
      {r.reason && <p className="firma-cita">«{r.reason}»</p>}
      {children}
    </Callout>
  );
}

/** ¿Hay una pregunta de quien firma esperando respuesta? */
export const preguntaAbierta = (s: Pick<Solicitud, 'status' | 'question'>) => s.status === 'PENDING' && !!s.question && !s.question.answer;

/**
 * QUIEN FIRMA PREGUNTÓ EN VEZ DE RECHAZAR (D-03): la pregunta y, debajo, el
 * renglón para contestarla. La solicitud sigue viva; al contestar, su reloj
 * vuelve a empezar para que quien firma alcance a leer la respuesta.
 */
export function Contestar({ s, onContestada }: { s: Solicitud; onContestada: (s: Solicitud) => void }) {
  const [texto, setTexto] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!s.question) return null;
  const quien = s.question.byName ?? 'Quien autoriza';
  async function enviar() {
    setIntentado(true);
    if (faltaMotivo(texto)) return;
    setEnviando(true); setError(null);
    try {
      await api(`/approvals/requests/${s.id}/answer`, { method: 'POST', body: JSON.stringify({ answer: texto.trim() }) });
      onContestada(await api<Solicitud>(`/approvals/requests/${s.id}`));
      setTexto(''); setIntentado(false);
    } catch (e) { setError(errorText(e, 'No se pudo enviar tu respuesta')); } finally { setEnviando(false); }
  }
  return (
    <div className="stack-sm" data-testid="firma-pregunta">
      <Callout tone="warn" title={`${quien} pregunta antes de autorizar`}>
        <p className="firma-cita">«{s.question.text}»</p>
        <p className="small">No la rechazó: la solicitud sigue viva. Contéstale aquí y decide con tu respuesta.</p>
      </Callout>
      <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <CampoMotivo id={`fp-${s.id}`} label={`Tu respuesta para ${quien}`} autoFocus value={texto} onChange={setTexto}
          error={error ?? (intentado && faltaMotivo(texto) ? 'Escribe tu respuesta: es lo que va a leer antes de decidir.' : null)}
          hint="La ve en su tarjeta y queda en la bitácora." />
        <div className="row"><Button type="submit" loading={enviando}>Contestar</Button></div>
      </form>
    </div>
  );
}

/** Para que un estado nuevo no compile hasta decidir cómo se pinta. */
function sinPintar(x: never): never {
  throw new Error(`Desenlace de firma sin pintar: ${String(x)}`);
}

/**
 * Los cinco desenlaces de una solicitud, con un `switch` sin `default`
 * (29-09): un estado nuevo no compila hasta que se decide cómo se ve. La
 * pregunta de quien firma (D-03) no es un estado: la solicitud sigue
 * pendiente y aquí se pinta con su renglón para contestar (`onCambio`). Nunca «nadie la contestó» cuando
 * sí se autorizó (29-03), «venció» solo cuando el servidor lo dice (29-06) y,
 * al vencer, qué pasó del otro lado (29-05). Solo el bloque del resultado es
 * región viva: el lector de pantalla lo anuncia una vez.
 */
export function Desenlace({ s, firmantes, restan, minutos, minutosFirma, onCambio }: {
  s: Solicitud; firmantes: readonly Firmante[]; restan: number | null; minutos: number; minutosFirma: number;
  /** Quien pidió contestó la pregunta: lo nuevo que dice el servidor de la solicitud. */
  onCambio?: (s: Solicitud) => void;
}) {
  const cuando = s.decidedAt ? ` a las ${hora(s.decidedAt)}` : '';
  switch (s.status) {
    case 'PENDING':
      return (
        <div role="status" className="stack-sm">
          {preguntaAbierta(s) && onCambio ? <Contestar s={s} onContestada={onCambio} /> : preguntaAbierta(s) ? (
            <Callout tone="warn" title={`${s.question!.byName ?? 'Quien autoriza'} pregunta antes de autorizar`}>
              <p className="firma-cita">«{s.question!.text}»</p>
            </Callout>
          ) : (
            <Callout tone="info" title="Esperando la autorización">
              {s.question?.answer && <p className="small">Le contestaste: «{s.question.answer}».</p>}
              {s.previousRejection && <p className="small">Ve que ya la rechazó a las {hora(s.previousRejection.at)} y tu respuesta{s.reply ? `: «${s.reply}»` : ''}.</p>}
              {alcanceEnEspera(s, firmantes)} En cuanto la apruebe con su contraseña, esto sigue solo.
            </Callout>
          )}
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
          <Callout tone="warn" title={`${quienContesto(s)} la autorizó${cuando}`}>{textoDeEntrega(s.delivery, minutosFirma)}</Callout>
        </div>
      );
    case 'REJECTED':
      // D-03: el «no» queda pegado a la operación. Quien pide lo lee aquí; el pie ofrece «Responder y volver a pedir».
      return (
        <Callout tone="danger" title={`${quienContesto(s)} no la autorizó${cuando}`}>
          {s.rejectReason && <p className="firma-cita">«{s.rejectReason}»</p>}
          <p className="small">
            No se registró nada. Habla con {s.approverName ?? 'quien autoriza'} o corrige la operación. Si la vuelves a pedir, verá que ya la rechazó y tendrás que contestarle.
            Durante 30 minutos no se firma aquí en el mostrador: solo desde su teléfono.
          </p>
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
