'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, History, ShieldCheck, X } from 'lucide-react';
import type { ApprovalHistory, ApprovalHistoryItem, ApprovalInbox, ApprovalInboxItem } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { hace, hora, pesos } from '@/lib/format';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, ErrorCarga, faltaMotivo, Field, PageHeader, EsqueletoLista, Tabs, type Tono } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { AvisosEnTelefono } from '@/components/push';
import { textoDeErrorDeFirma } from '@/components/autorizacion';
import { FIRMAS } from '@/modules/registro';

type Solicitud = ApprovalInboxItem;

/** Qué se está autorizando, en palabras de la dueña. */
const QUE: Record<string, string> = {
  'payments:reverse': 'Revertir un pago', 'payments:refund': 'Reembolsar', 'billing:waiver:apply': 'Condonar una deuda',
  'billing:charge:void': 'Anular un cargo', 'billing:discount:apply': 'Descuento mayor a su tope', 'cash:withdraw': 'Retirar efectivo',
  'members:anonymize': 'Anonimizar a un socio (ARCO)', 'memberships:visitpack:adjust': 'Ajustar visitas de un paquete',
  // Desde el bloque 0.9 el cierre de mes también se pide al teléfono (20-01).
  'reports:month:close': 'Cerrar el mes',
};

/**
 * AUTORIZACIONES A DISTANCIA: lo que el mostrador pide y esta persona puede
 * firmar. Pensada para el teléfono de la dueña: se aprueba con la propia
 * contraseña, sin ir al mostrador.
 *
 * Dos pestañas (20-05): «Pendientes» y «Resueltas hoy». Antes una solicitud
 * vencida o rechazada desaparecía sin más y nadie sabía qué se firmó hoy.
 * Quien no da la segunda firma solo tiene «Resueltas hoy», con lo que pidió.
 */
export default function AutorizacionesPage() {
  const { branchName, can } = useSession();
  const toast = useToast();
  const firma = FIRMAS.some((p) => can(p));
  const [pestana, setPestana] = useState<'pendientes' | 'resueltas'>(firma ? 'pendientes' : 'resueltas');
  const [lista, setLista] = useState<Solicitud[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aprobar, setAprobar] = useState<Solicitud | null>(null);
  const [rechazar, setRechazar] = useState<Solicitud | null>(null);

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
                      {s.reason && <p className="small">Motivo: <span className="strong">{s.reason}</span></p>}
                      {s.amountCents && <p className="num resuelta-importe">{pesos(s.amountCents)}</p>}
                      <div className="row wrap gap-8">
                        <Button icon={<Check />} onClick={() => setAprobar(s)}>Autorizar</Button>
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
      {aprobar && <Aprobar s={aprobar} onClose={() => setAprobar(null)} onListo={() => { setAprobar(null); toast('ok', 'Autorizado. La operación se completa en cuanto la pantalla que la pidió la reciba (tiene 5 minutos). Queda en «Resueltas hoy».'); cargar(); }} />}
      {rechazar && <Rechazar s={rechazar} onClose={() => setRechazar(null)} onListo={() => { setRechazar(null); toast('ok', 'No autorizada. Quien la pidió lo ve en su pantalla si sigue abierta, y queda en la bitácora y en «Resueltas hoy».'); cargar(); }} />}
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
  const quien = s.approverName ?? 'Quien autoriza';
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

function Aprobar({ s, onClose, onListo }: { s: Solicitud; onClose: () => void; onListo: () => void }) {
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
        <p className="small muted">Confirma que eres tú: la firma queda en la bitácora con tu nombre, solo para esta operación y este importe.</p>
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
