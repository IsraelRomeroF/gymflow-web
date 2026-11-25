'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { OUTBOUND_KINDS, type OutboundMarked, type OutboundMessage, type OutboundMessages } from '@gymflow/core/contracts';
import { MOTIVO_DE_MENSAJE } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { useCarga } from '@gymflow/ui/carga';
import { enlaceWhatsapp } from '@/lib/entrega-temporal';
import { hora, telefono } from '@gymflow/ui/format';
import { errorText, useSession, useToast } from '@/components/session';
import { Badge, Button, Card, Dialog, Empty, ErrorCarga, EsqueletoLista, PageHeader } from '@/components/ui';
import { EVENTO_MENSAJES } from '@/components/campana';

/** Cuántos se traen de CADA motivo; si hay más, el grupo dice cuántos faltan. */
const TOPE = 50;
const avisarALaCampana = () => window.dispatchEvent(new Event(EVENTO_MENSAJES));

/**
 * MENSAJES (auditoría 8, bloque 2.9; 25-10, 15-08, 28-14): lo que hay que
 * mandarle hoy a cada socio, ya escrito. Un toque abre WhatsApp con el texto
 * y deja anotado quién lo mandó; nada sale solo (D-34). La lista la arma el
 * servidor cada día y esconde lo que ya no hace falta (quien pagó, quien volvió).
 */
export default function MensajesPage() {
  const { branches, inScope, branchName, org } = useSession();
  const toast = useToast();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sede, setSede] = useState('');
  const lista = useCarga(useCallback(() => api<OutboundMessages>(`/outbound/messages?limit=${TOPE}${sede ? `&branchId=${sede}` : ''}`), [sede]), { conservar: true });
  const { recargar } = lista;
  const l = lista.datos ?? null;
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [descartar, setDescartar] = useState<OutboundMessage | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  // Al volver de WhatsApp (o de otra pestaña) la lista se pone al día: lo que alguien más mandó ya no sale.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') void recargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [recargar]);

  /** Lo quita de pendientes en pantalla; si se mandó, lo sube a «Mandados hoy». */
  const quitar = (m: OutboundMessage, quedo?: OutboundMessage) => lista.poner((antes) => {
    const a = antes!;
    if (!a.pending.some((x) => x.id === m.id)) return a;
    return {
      ...a, total: a.total - 1, counts: { ...a.counts, [m.kind]: Math.max(0, a.counts[m.kind] - 1) },
      pending: a.pending.filter((x) => x.id !== m.id),
      sentToday: quedo && quedo.status === 'SENT' ? [quedo, ...a.sentToday] : a.sentToday,
    };
  });

  /** El toque abre WhatsApp (es el enlace) y aquí queda anotado. Un segundo toque mientras se anota no lo manda dos veces. */
  async function mandado(m: OutboundMessage) {
    if (enCurso) return;
    setEnCurso(m.id);
    try {
      const r = await api<OutboundMarked>(`/members/${m.memberId}/outbound-messages/mark`, { method: 'POST', body: JSON.stringify({ messageId: m.id, as: 'SENT' }) });
      quitar(m, r.message);
      toast('ok', `Quedó anotado el mensaje a ${m.memberName.split(' ')[0]}.`);
      avisarALaCampana();
      // Y se vuelve a pedir: entran los siguientes del grupo, y una recarga que venía en camino ya no pisa este cambio.
      void recargar();
    } catch (e) {
      // Lo más común: ya pagó o alguien más lo mandó. Se dice y la lista se pone al día.
      toast('error', errorText(e, 'No se pudo anotar el mensaje'));
      void recargar();
    } finally { setEnCurso(null); }
  }

  async function noMandar(m: OutboundMessage) {
    setEnCurso(m.id); setFallo(null);
    try {
      await api<OutboundMarked>(`/members/${m.memberId}/outbound-messages/mark`, { method: 'POST', body: JSON.stringify({ messageId: m.id, as: 'DISMISSED' }) });
      quitar(m);
      setDescartar(null);
      avisarALaCampana();
      void recargar();
    } catch (e) { setFallo(errorText(e, 'No se pudo quitar el mensaje')); } finally { setEnCurso(null); }
  }

  const grupos = OUTBOUND_KINDS.map((k) => ({ k, items: l?.pending.filter((m) => m.kind === k) ?? [] })).filter((g) => g.items.length > 0);
  return (
    <div className="stack gap-20">
      <PageHeader title="Mensajes" sub="Lo que hay que mandarle hoy a cada socio, ya escrito. Un toque abre WhatsApp con el mensaje; tú lo envías desde ahí."
        actions={sedes.length > 1 ? (
          <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
            <option value="">Todas mis sucursales</option>
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : undefined} />
      {lista.error && <ErrorCarga titulo="No se pudo cargar la lista de mensajes" mensaje={lista.error} onReintentar={() => void recargar()} />}
      {!lista.error && l === null && <Card pad={false}><EsqueletoLista filas={6} /></Card>}
      {l && l.total === 0 && (
        <Card>
          <Empty icon={<MessageCircle />} title="Nada por mandar"
            text="Cuando a un socio se le acerque un pago, se le venza, se le suspenda la membresía, se le termine el plan o deje de venir, aquí sale su mensaje listo." />
        </Card>
      )}
      {/* La bandeja por urgencia: cada motivo con su contador, lo más grave arriba. */}
      {grupos.map(({ k, items }) => {
        const motivo = MOTIVO_DE_MENSAJE[k]!;
        return (
          <Card key={k} pad={false} data-testid={`grupo-${k}`}
            title={<span id={`grupo-${k}`} className="mensajes-ancla">{motivo.plural} <Badge tone={motivo.tone}>{l!.counts[k]}</Badge></span>}
            footer={l!.counts[k] > items.length ? <span className="small muted">Se muestran {items.length} de {l!.counts[k]}. Al mandarlos salen los siguientes.</span> : undefined}>
            <ul className="list">
              {items.map((m) => {
                const enlace = enlaceWhatsapp(m.phoneE164, m.text);
                return (
                  <li key={m.id} className="list-item mensaje-fila" data-testid="mensaje">
                    <div className="mensaje-quien min-w-0">
                      <Link href={`/socios/${m.memberId}`} className="strong small">{m.memberName}</Link> <code className="tiny muted">{m.memberCode}</code>
                      <div className="tiny muted">{m.detail}{sedes.length > 1 && m.branchId ? ` · ${branchName(m.branchId)}` : ''} · {telefono(m.phoneE164)}</div>
                    </div>
                    <p className="mensaje-previo mensaje-texto">{m.text}</p>
                    <div className="row gap-6 mensaje-acciones">
                      {enlace
                        // Abre WhatsApp con el mensaje escrito y, en el mismo toque, queda anotado (igual que «Mandar alta digital»).
                        ? <a className="btn btn-primary btn-sm" href={enlace} target="_blank" rel="noreferrer" aria-disabled={enCurso === m.id}
                            onClick={() => void mandado(m)}><MessageCircle />Mandar por WhatsApp</a>
                        : <span className="tiny muted">Su celular no sirve para WhatsApp: corrígelo en su ficha.</span>}
                      <Button size="sm" variant="ghost" onClick={() => { setFallo(null); setDescartar(m); }}>No mandar</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      {l && l.sentToday.length > 0 && (
        <Card pad={false} title={<>Mandados hoy <Badge tone="ok">{l.sentToday.length}</Badge></>} data-testid="mandados-hoy">
          <ul className="list">
            {l.sentToday.map((m) => {
              const enlace = enlaceWhatsapp(m.phoneE164, m.text);
              return (
                <li key={m.id} className="list-item mensaje-fila">
                  <div className="mensaje-quien min-w-0">
                    <Link href={`/socios/${m.memberId}`} className="strong small">{m.memberName}</Link> <code className="tiny muted">{m.memberCode}</code>
                    <div className="tiny muted">
                      {MOTIVO_DE_MENSAJE[m.kind]?.label}{m.resolvedAt ? ` · ${hora(m.resolvedAt, org.timezone)}` : ''}{m.resolvedByName ? ` · ${m.resolvedByName}` : ''}
                    </div>
                  </div>
                  <details className="mensaje-mandado">
                    <summary className="tiny muted">Ver lo que se mandó</summary>
                    <p className="mensaje-previo mensaje-texto">{m.text}</p>
                  </details>
                  {/* Si la pestaña de WhatsApp se cerró sin enviar: se abre otra vez con el mismo texto, sin anotar de nuevo. */}
                  {enlace && <a className="btn btn-ghost btn-sm" href={enlace} target="_blank" rel="noreferrer">Abrir de nuevo</a>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {descartar && (
        <Dialog open onClose={() => setDescartar(null)} title={`¿No mandarle este mensaje a ${descartar.memberName.split(' ')[0]}?`} error={fallo}
          sub="Sale de la lista y no vuelve por este mismo motivo. Queda anotado que decidiste no mandarlo."
          footer={<>
            <Button variant="secondary" onClick={() => setDescartar(null)}>Cancelar</Button>
            <Button variant="danger" loading={enCurso === descartar.id} onClick={() => void noMandar(descartar)}>No mandar</Button>
          </>}>
          <p className="mensaje-previo">{descartar.text}</p>
        </Dialog>
      )}
    </div>
  );
}
