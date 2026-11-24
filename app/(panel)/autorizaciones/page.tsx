'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, History, MessageCircleQuestion, ShieldCheck, X } from 'lucide-react';
import { APPROVAL_QUESTION_SUGGESTIONS } from '@gymflow/core';
import type { ApprovalHistory, ApprovalHistoryItem, ApprovalInbox, ApprovalInboxItem } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { hace, hora, pesos } from '@/lib/format';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, ErrorCarga, faltaMotivo, Field, PageHeader, EsqueletoLista, Tabs, type Tono } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { AvisosEnTelefono } from '@/components/push';
import { ListaPorFirmar } from '@/components/privacidad';
import { textoDeErrorDeFirma } from '@/components/autorizacion';
import { ResumenAlFirmar } from '@/components/resumen-al-firmar';
import { FIRMAS } from '@/modules/registro';
import { AvisoDeApoderado, TarjetaDeApoderado, useApoderado } from '@/components/firma/apoderado';

type Solicitud = ApprovalInboxItem;

/** Qué se está autorizando, en palabras de la dueña. */
const QUE: Record<string, string> = {
  'payments:reverse': 'Revertir un pago', 'payments:refund': 'Reembolsar', 'billing:waiver:apply': 'Condonar una deuda',
  'billing:charge:void': 'Anular un cargo', 'billing:discount:apply': 'Descuento mayor a su tope', 'cash:withdraw': 'Retirar efectivo',
  'members:anonymize': 'Anonimizar a un socio (ARCO)', 'memberships:visitpack:adjust': 'Ajustar visitas de un paquete',
  // Desde el bloque 0.9 el cierre de mes también se pide al teléfono (20-01).
  'reports:month:close': 'Cerrar el mes',
  // Fase 3 · bloque 3.3 (D-06): la gerencia no está y un socio sin rostro espera en la puerta.
  'access:entry:authorize': 'Dejar entrar a un socio sin su rostro registrado',
};

/**
 * AUTORIZACIONES A DISTANCIA: lo que el mostrador pide y esta persona puede
 * firmar. Pensada para el teléfono de la dueña: se aprueba con la propia
 * contraseña, sin ir al mostrador.
 *
 * Dos pestañas (20-05): «Pendientes» y «Resueltas hoy». Antes una solicitud
 * vencida o rechazada desaparecía sin más y nadie sabía qué se firmó hoy.
 * Quien no da la segunda firma solo tiene «Resueltas hoy», con lo que pidió.
 *
 * D-03 (bloque 3.2): si la operación ya se rechazó, la tarjeta lo dice («2.ª
 * vez · ya la rechazaste a las 15:26») con la respuesta que quien pide tuvo
 * que escribir; y además de autorizar o no, se puede «Preguntar»: la
 * solicitud sigue viva y la respuesta llega a esta misma tarjeta.
 *
 * D-02 (bloque 3.1): aquí la dueña nombra, cambia y revoca a su apoderado
 * temporal; y el apoderado ve con qué autoridad firma y hasta cuándo. Lo que
 * es solo de la dueña (la lista de conservación) no le sale al apoderado.
 */
export default function AutorizacionesPage() {
  const { branchName, can } = useSession();
  const toast = useToast();
  const firma = FIRMAS.some((p) => can(p));
  // Por su puesto (la dueña) o por un nombramiento vigente (su apoderado, D-02).
  const duena = can('approvals:grant');
  const apoderado = useApoderado(firma);
  const comoApoderadoDe = apoderado.estado?.mine ? apoderado.estado.current?.grantedByName ?? 'quien te nombró' : null;
  const [pestana, setPestana] = useState<'pendientes' | 'resueltas'>(firma ? 'pendientes' : 'resueltas');
  const [lista, setLista] = useState<Solicitud[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aprobar, setAprobar] = useState<Solicitud | null>(null);
  const [rechazar, setRechazar] = useState<Solicitud | null>(null);
  const [preguntar, setPreguntar] = useState<Solicitud | null>(null);

  const cargar = useCallback(() => {
    if (!firma) return;
    // `seen=1`: esta pantalla las está mostrando; quien espera en el mostrador lee «la vio a las…» (29-05).
    // Un error NO se muestra como "nada pendiente" (UXG-04).
    // Con la pestaña oculta no se las está mostrando a nadie: se consulta sin marcarlas.
    api<ApprovalInbox>(`/approvals/inbox${document.hidden ? '' : '?seen=1'}`).then((r) => { setLista(r.requests); setError(null); })
      .catch((e) => setError(errorText(e, 'No se pudo revisar si hay autorizaciones pendientes')));
  }, [firma]);
  useEffect(() => {
    cargar();
    // Llegan mientras la pantalla está abierta: se revisa cada 5 s si se ve.
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 5000);
    const alVolver = () => { if (!document.hidden) cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [cargar]);

  return (
    <>
      <PageHeader title="Autorizaciones"
        sub={firma ? 'Lo que el mostrador te pide autorizar. Apruébalo aquí con tu contraseña; allá la operación sigue sola.' : 'Lo que pediste autorizar hoy y en qué quedó.'}
        actions={firma ? <AvisosEnTelefono /> : undefined} />
      {/* Bloque 3.9 (D-32): la lista mensual de exsocios por anonimizar, solo si hay una en espera de firma. */}
      {duena && <ListaPorFirmar />}
      <AvisoDeApoderado estado={apoderado.estado} />
      {firma && (
        <Tabs value={pestana} onChange={setPestana} tabs={[
          { value: 'pendientes', label: 'Pendientes', icon: <ShieldCheck size={16} />, count: lista?.length ?? 0 },
          { value: 'resueltas', label: 'Resueltas hoy', icon: <History size={16} /> },
        ]} />
      )}
      {pestana === 'resueltas' ? <Resueltas /> : (
        <>
          {error && <Callout tone="danger">{error}</Callout>}
          {lista === null ? (error ? null : <div className="card"><EsqueletoLista filas={3} /></div>) : lista.length === 0 ? (
            <Card><Empty icon={<ShieldCheck />} title="Nada pendiente" text="Cuando alguien te pida autorizar una devolución, un retiro o una condonación, aparece aquí. Lo que ya contestaste está en «Resueltas hoy»." /></Card>
          ) : (
            <div className="stack">
              {lista.map((s) => {
                const minutos = Math.max(0, Math.round(s.secondsLeft / 60));
                return (
                  <Card key={s.id} title={QUE[s.permission] ?? s.permission} sub={`Pide ${s.requesterName ?? 'alguien del personal'} · ${hace(s.createdAt)}${s.branchId ? ` · ${branchName(s.branchId)}` : ''}`}
                    actions={<Badge tone="warn" dot>Vence en {minutos} min</Badge>}>
                    <div className="stack-sm">
                      <p className="strong">{s.context ?? s.summary}</p>
                      {s.context && <p className="small muted">{s.summary}</p>}
                      {/* Bloque 3.7 (D-25): de quién se trata, en tres datos y sin abrir su expediente. */}
                      <ResumenAlFirmar resourceType={s.resourceType} resourceId={s.resourceId} />
                      {s.reason && <p className="small">Motivo: <span className="strong">{s.reason}</span></p>}
                      {s.amountCents && <p className="num resuelta-importe">{pesos(s.amountCents)}</p>}
                      <Historia s={s} />
                      <div className="row wrap gap-8">
                        <Button icon={<Check />} onClick={() => setAprobar(s)}>Autorizar</Button>
                        {!(s.question && !s.question.answer) && (
                          <Button variant="secondary" icon={<MessageCircleQuestion />} onClick={() => setPreguntar(s)}>Preguntar</Button>
                        )}
                        <Button variant="secondary" icon={<X />} onClick={() => setRechazar(s)}>No autorizar</Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
      {duena && <TarjetaDeApoderado estado={apoderado.estado} onCambio={apoderado.recargar} />}
      {aprobar && <Aprobar s={aprobar} comoApoderadoDe={comoApoderadoDe} onClose={() => setAprobar(null)} onListo={() => { setAprobar(null); toast('ok', 'Autorizado. La operación se completa en cuanto la pantalla que la pidió la reciba (tiene 5 minutos). Queda en «Resueltas hoy».'); cargar(); }} />}
      {rechazar && <Rechazar s={rechazar} onClose={() => setRechazar(null)} onListo={() => { setRechazar(null); toast('ok', 'No autorizada. Quien la pidió lo ve en su pantalla si sigue abierta, y queda en «Resueltas hoy». Si te la vuelven a pedir verás tu «no» y su respuesta; durante 30 minutos nadie la firma en el mostrador.'); cargar(); }} />}
      {preguntar && <Preguntar s={preguntar} onClose={() => setPreguntar(null)} onListo={() => { setPreguntar(null); toast('ok', 'Pregunta enviada. La solicitud sigue viva y su respuesta llega a esta tarjeta.'); cargar(); }} />}
    </>
  );
}

const ordinal = (n: number) => `${n}.ª vez`;

/**
 * LO QUE YA PASÓ CON ESTA OPERACIÓN (D-03): el «no» anterior con la respuesta
 * que quien pide tuvo que escribir, y la pregunta con su contestación.
 */
function Historia({ s }: { s: Solicitud }) {
  const userId = useSession().me.userId;
  const pide = s.requesterName ?? 'Quien la pide';
  // Con más de una persona que firma (apoderado, D-02), el «no» o la pregunta pueden ser de la otra.
  const r = s.previousRejection;
  const mio = !r?.byUserId || r.byUserId === userId;
  const q = s.question;
  const miPregunta = !q?.byUserId || q.byUserId === userId;
  return (
    <>
      {s.previousRejection ? (
        <Callout tone="warn" title={`${ordinal(Math.max(2, s.attempt))} · ${mio ? 'Ya la rechazaste' : `${s.previousRejection.byName ?? 'Otra persona'} ya la rechazó`} a las ${hora(s.previousRejection.at)}`}>
          {s.previousRejection.reason && <p className="small">{mio ? 'Tu motivo' : 'Su motivo'}: «{s.previousRejection.reason}»</p>}
          <p className="firma-cita" data-testid="firma-respuesta">{pide} responde: «{s.reply ?? ''}»</p>
        </Callout>
      ) : s.attempt > 1 ? (
        <p className="small muted">{ordinal(s.attempt)} que te la piden en esta hora.</p>
      ) : null}
      {s.question && (
        <Callout tone={s.question.answer ? 'info' : 'warn'} title={`${miPregunta ? 'Preguntaste' : `${s.question.byName ?? 'Otra persona'} preguntó`} a las ${hora(s.question.at)}: «${s.question.text}»`}>
          {s.question.answer
            ? <p className="firma-cita" data-testid="firma-contestacion">{pide} contesta: «{s.question.answer}»</p>
            : <p className="small">Esperando su respuesta. Puedes autorizar o no autorizar sin esperarla.</p>}
        </Callout>
      )}
    </>
  );
}

const DESENLACE: Record<ApprovalHistoryItem['status'], { texto: string; tono: Tono }> = {
  APPROVED: { texto: 'Autorizada', tono: 'ok' },
  REJECTED: { texto: 'No autorizada', tono: 'danger' },
  EXPIRED: { texto: 'Venció sin respuesta', tono: 'warn' },
  CANCELED: { texto: 'Cancelada', tono: 'neutral' },
};

/** En qué quedó, en una frase: quién, a qué hora y qué pasó después. */
function enQueQuedo(s: ApprovalHistoryItem): string {
  const a = hora(s.resolvedAt);
  // D-02: «Ana Ruiz, como apoderada de …» no se puede decir sin saber su género; se dice «como apoderado de».
  const quien = `${s.approverName ?? 'Quien autoriza'}${s.approverProxyOf ? ` (como apoderado de ${s.approverProxyOf})` : ''}`;
  switch (s.status) {
    case 'APPROVED': {
      const firma = s.delivery === 'used' ? ' La operación se registró con esa firma.'
        : s.delivery === 'expired' ? ' La firma venció sin usarse: no se registró nada.'
        : s.delivery === 'ready' ? ' La firma está lista: falta que la pantalla que la pidió la use.' : '';
      return `${quien} la autorizó a las ${a}.${firma}`;
    }
    case 'REJECTED': return `${quien} no la autorizó a las ${a}${s.rejectReason ? `: «${s.rejectReason}»` : '.'}`;
    case 'EXPIRED':
      return `Venció a las ${a}. ${s.seenAt ? `Estuvo a la vista en esta bandeja desde las ${hora(s.seenAt)} y nadie contestó.` : s.notifiedCount > 0 ? 'Llegó el aviso al teléfono y nadie la abrió.' : 'Nadie la vio: no estuvo a la vista en esta bandeja y no salió ningún aviso al teléfono.'}`;
    case 'CANCELED': return `${s.requesterName ?? 'Quien la pidió'} la canceló a las ${a}.`;
  }
}

/**
 * «RESUELTAS HOY» (20-05): lo aprobado, rechazado, vencido y cancelado de las
 * últimas 24 horas. La dueña ve todo lo que podía firmar; quien pide, lo suyo.
 */
function Resueltas() {
  const { branchName } = useSession();
  const [datos, setDatos] = useState<ApprovalHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    api<ApprovalHistory>('/approvals/history').then((r) => { setDatos(r); setError(null); })
      .catch((e) => setError(errorText(e, 'No se pudo consultar lo resuelto hoy')));
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  if (error && !datos) return <ErrorCarga titulo="No se pudo consultar lo resuelto hoy" mensaje={error} onReintentar={cargar} />;
  if (!datos) return <div className="card"><EsqueletoLista filas={3} /></div>;
  if (datos.requests.length === 0) {
    return (
      <Card><Empty icon={<History />} title="Nada resuelto en las últimas 24 horas"
        text={datos.scope === 'all' ? 'Lo que autorices, rechaces o dejes vencer aparece aquí, con lo que pasó después.' : 'Las autorizaciones que pidas aparecen aquí con su respuesta.'} /></Card>
    );
  }
  return (
    <Card title="Resueltas hoy" sub={`Últimas ${datos.windowHours} horas · ${datos.scope === 'all' ? 'todo lo que podías firmar' : 'lo que pediste'}`}>
      <div data-testid="resueltas">
        {datos.requests.map((s) => (
          <div key={s.id} className="resuelta">
            <div className="stack-sm">
              <p className="strong">{QUE[s.permission] ?? s.permission} · {s.context ?? s.summary}</p>
              <p className="small muted">
                {s.mine ? 'La pediste tú' : `La pidió ${s.requesterName ?? 'alguien del personal'}`} · {hace(s.createdAt)}{s.branchId ? ` · ${branchName(s.branchId)}` : ''}
                {s.reason ? <> · Motivo: {s.reason}</> : null}
              </p>
              {s.previousRejection && (
                <p className="small muted">Ya se había rechazado a las {hora(s.previousRejection.at)}{s.previousRejection.reason ? `: «${s.previousRejection.reason}»` : ''}. Respuesta: «{s.reply ?? ''}»</p>
              )}
              {s.question && (
                <p className="small muted">Pregunta: «{s.question.text}»{s.question.answer ? ` · Respuesta: «${s.question.answer}»` : ' · sin respuesta'}</p>
              )}
              <p className="small">{enQueQuedo(s)}</p>
            </div>
            <div className="stack-sm">
              <Badge tone={DESENLACE[s.status].tono} dot>{DESENLACE[s.status].texto}</Badge>
              {s.amountCents && <span className="num strong">{pesos(s.amountCents)}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Aprobar({ s, comoApoderadoDe, onClose, onListo }: { s: Solicitud; comoApoderadoDe: string | null; onClose: () => void; onListo: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setEnviando(true); setError(null);
    try {
      await api(`/approvals/requests/${s.id}/approve`, { method: 'POST', body: JSON.stringify({ password }) });
      onListo();
    } catch (e) {
      // Con la pausa por intentos fallidos, el mensaje dice hasta qué hora (24-11).
      setError(textoDeErrorDeFirma(e, 'No se pudo autorizar'));
    } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Autorizar: ${QUE[s.permission] ?? s.permission}`} sub={`${s.summary}${s.amountCents ? ` · ${pesos(s.amountCents)}` : ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<ShieldCheck />} loading={enviando} disabled={!password} onClick={() => void enviar()}>Autorizar</Button></>}>
      <form className="stack" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <p className="small muted">
          Confirma que eres tú: la firma queda en la bitácora con tu nombre{comoApoderadoDe ? `, como apoderado de ${comoApoderadoDe}` : ''}, solo para esta operación y este importe.
        </p>
        <Field label="Tu contraseña" htmlFor="ap-pw">
          <input id="ap-pw" className="input" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function Rechazar({ s, onClose, onListo }: { s: Solicitud; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  // El principal queda encendido: si falta el motivo, el campo lo dice (26-02, 26-09; adopción 2.12).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function enviar() {
    try {
      await api(`/approvals/requests/${s.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      onListo();
    } catch (e) { toast('error', errorText(e, 'No se pudo')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} title="No autorizar" sub={s.summary}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(enviar)}>No autorizar</Button></>}>
      <CampoMotivo id="rz-m" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')}
        placeholder="Primero confirma su identificación" hint="Lo ve quien la pidió y queda en la bitácora." />
    </Dialog>
  );
}

/**
 * «PREGUNTAR» EN VEZ DE «NO AUTORIZAR» (D-03): para pedir un dato ya no hay
 * que rechazar y obligar a empezar de nuevo. La solicitud sigue viva y su
 * reloj vuelve a empezar; quien la pidió contesta en su pantalla.
 */
function Preguntar({ s, onClose, onListo }: { s: Solicitud; onClose: () => void; onListo: () => void }) {
  const [pregunta, setPregunta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario({ pregunta: faltaMotivo(pregunta) && 'Escribe tu pregunta o elige una de abajo.' });
  async function enviar() {
    setError(null);
    try {
      await api(`/approvals/requests/${s.id}/ask`, { method: 'POST', body: JSON.stringify({ question: pregunta.trim() }) });
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo enviar la pregunta')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} title="Preguntar antes de decidir" sub={s.context ?? s.summary} error={error}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button loading={f.enviando} onClick={() => void f.enviar(enviar)}>Preguntar</Button></>}>
      <CampoMotivo id="pg-q" label={`Tu pregunta para ${s.requesterName ?? 'quien la pidió'}`} autoFocus value={pregunta} onChange={setPregunta} error={f.error('pregunta')}
        motivos={APPROVAL_QUESTION_SUGGESTIONS} hint="No la rechazas: la solicitud sigue viva y su reloj vuelve a empezar. La respuesta llega a esta tarjeta." />
    </Dialog>
  );
}
