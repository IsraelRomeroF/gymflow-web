'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { HeartHandshake, Phone, MessageCircle, PhoneCall } from 'lucide-react';
import { api } from '@/lib/api';
import { telefono } from '@/lib/format';
import { useSession } from '@/components/session';
import { Badge, Button, ButtonLink, Card, Empty, ErrorCarga, PageHeader, Stat, EsqueletoLista } from '@/components/ui';
import { useCarga } from '@/lib/carga';
import { ContactoDialog, UltimoContacto, type Contacto } from '@/components/seguimiento';
import { hoyEn } from '@/lib/zonas';
import { RETENTION_THRESHOLDS, contactStatus } from '@gymflow/core/retention';
import { ESTADO_DE_HABITO } from '@gymflow/core/vocabulario';
import type { FollowUpLatest, OutboundMessage, OutboundMessages, RetentionAlert as Alerta, RetentionAlerts as Reporte } from '@gymflow/core/contracts';
import { enlaceWhatsapp } from '@/lib/entrega-temporal';

/** Cuántas personas se traen para llamar; si hay más, la tarjeta dice cuántas faltan. */
const TOPE = 60;

/** Qué quiere decir cada estado, para la fila que llega sin frase. La palabra y el color salen del núcleo. */
const QUE: Record<string, string> = {
  ONBOARDING_AT_RISK: 'Se inscribió y casi no ha venido: el primer mes decide si se queda.',
  SLIPPING: 'Viene menos que su costumbre.',
  DORMANT: 'Semanas sin venir, pero todavía paga.',
  LOST: 'Mucho tiempo sin venir.',
};
type Ultimo = { last: Contacto; count: number };

/**
 * RETENCIÓN: a quién llamar HOY. El socio deja de venir semanas antes de
 * dejar de pagar; esta lista viene ordenada por dónde está el retorno, no por
 * fecha, porque recepción no puede llamarle a doscientas personas.
 */
export default function RetencionPage() {
  const { branches, inScope, branchName, me, org, can } = useSession();
  // Anotar el contacto es escribir (28-04): quien solo consulta ve la lista sin «Le llamé».
  const anota = can('retention:followup:write');
  const hoy = hoyEn(org.timezone);
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  // "Todas" solo para quien opera toda la organización; los demás eligen sede.
  const todas = me.branchScopes.includes(null);
  const [sede, setSede] = useState(todas ? '' : sedes[0]?.id ?? '');
  // Con sus tres estados (26-01): sin red se dice y se reintenta.
  const reporte = useCarga(useCallback(() => api<Reporte>(`/retention/alerts?limit=${TOPE}${sede ? `&branchId=${sede}` : ''}`), [sede]));
  const r = reporte.datos ?? null;
  const error = reporte.error;

  // Seguimiento (UX7): el último contacto de cada quien. Tras llamar, la fila
  // baja a "Ya contactados" hasta que le toque el próximo paso. Si no responde,
  // nadie pasa por «no contactado»: se dice que no se sabe (26-01).
  const [llamando, setLlamando] = useState<Alerta | null>(null);
  const ids = r?.outreach.map((a) => a.memberId).join(',') ?? '';
  const seguimiento = useCarga(useCallback(() => (ids
    ? api<FollowUpLatest>(`/members/follow-ups/latest?ids=${ids}`)
      .then((x) => new Map<string, Ultimo>(x.latest.map((l) => [l.memberId, { last: l.last, count: l.count }])))
    : Promise.resolve(new Map<string, Ultimo>())), [ids]), { conservar: true });
  const contactos = seguimiento.datos ?? new Map<string, Ultimo>();
  const cargarContactos = () => { void seguimiento.recargar(); };
  // 15-08 (bloque 2.9): quien manda mensajes abre WhatsApp con el «te extrañamos» ya escrito y, en el
  // mismo toque, queda anotado como contacto (la fila baja a «Ya contactados»). Es el mismo mensaje de la
  // lista de Mensajes; sin mensaje pendiente, el icono abre el chat vacío como antes.
  const mandaMensajes = anota && can('members:message:send');
  const pedirMensajes = useCallback(() => api<OutboundMessages>(`/outbound/messages?kind=WE_MISS_YOU&limit=500${sede ? `&branchId=${sede}` : ''}`), [sede]);
  const mensajes = useCarga(mandaMensajes ? pedirMensajes : null, { conservar: true });
  const mensajeDe = new Map((mensajes.datos?.pending ?? []).filter((m) => m.kind === 'WE_MISS_YOU').map((m) => [m.memberId, m]));
  const mandado = (m: OutboundMessage) => {
    void api(`/members/${m.memberId}/outbound-messages/mark`, { method: 'POST', body: JSON.stringify({ messageId: m.id, as: 'SENT' }) })
      .catch(() => undefined)
      .then(() => { cargarContactos(); void mensajes.recargar(); });
  };
  // «Ya contactado» lo decide la regla del núcleo (`contactStatus`, con su prueba): hubo
  // contacto dentro del plazo y todavía no le toca el próximo paso.
  const contactado = (a: Alerta) => contactStatus(contactos.get(a.memberId)?.last, hoy) === 'CONTACTADO';
  const porLlamar = r?.outreach.filter((a) => !contactado(a)) ?? [];
  const yaContactados = r?.outreach.filter(contactado) ?? [];

  // Gimnasio sin socios: "nadie en riesgo" sería un falso alivio.
  const sinSocios = !!r && Object.values(r.counts).every((n) => !n);
  const T = RETENTION_THRESHOLDS;
  return (
    <div className="stack gap-20">
      <PageHeader title="Retención" sub="A quién llamar hoy, en orden de dónde está el retorno. Contactar antes del corte es retención; después ya es cobranza."
        actions={sedes.length > 1 ? (
          <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
            {todas && <option value="">Todas las sucursales</option>}
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : undefined} />
      {error && <ErrorCarga titulo="No se pudo cargar a quién llamar" mensaje={error} onReintentar={() => void reporte.recargar()} />}
      {seguimiento.error && (
        <ErrorCarga titulo="No se pudo saber a quién ya se llamó" mensaje="La lista de abajo puede incluir a quien ya contactaron. Reintenta antes de llamar." onReintentar={cargarContactos} />
      )}
      {r && (
        <div className="grid grid-4">
          {/* Las tres de la derecha suman la primera: antes faltaba «Dejaron de venir» y la cuenta no cerraba. */}
          <Stat label="En riesgo" value={r.total} note="Para llamar" danger={r.total > 0} />
          <Stat label="No arrancaron" value={r.counts.ONBOARDING_AT_RISK} note="Primer mes" />
          <Stat label="Aflojando" value={r.counts.SLIPPING} note="Vienen menos" />
          <Stat label="Dejaron de venir" value={r.counts.DORMANT} note={`${T.dormantMinDays} días o más`} />
        </div>
      )}
      {r && !sinSocios && (
        <details className="explica" data-testid="reglas-retencion">
          <summary className="tiny strong">¿Cómo se decide quién está en riesgo?</summary>
          <p className="tiny muted mt-6">
            Cada socio se compara con su propia costumbre. <strong>Aflojando</strong>: ya faltó a dos de sus visitas y lleva al menos {T.slippingMinDays} días sin venir (un puente no cuenta).
            {' '}<strong>Dejó de venir</strong>: {T.dormantMinDays} días o más sin venir, venga como viniera. <strong>No arrancó</strong>: menos de {T.onboardingMinVisits} visitas en sus primeros {T.onboardingWindowDays} días.
            {' '}A los {T.lostDays} días se da por perdido y sale de la lista. Quien tiene la membresía congelada no aparece mientras dura la pausa; vuelve {T.unfrozenGraceDays} días después de descongelar si no ha venido. Las altas sin activar tampoco: eso es cobro.
            {' '}Hoy: {r.counts.REGULAR} constantes, {r.counts.NEW} nuevos y {r.counts.LOST} perdidos.
          </p>
        </details>
      )}
      {/* Si falló, solo se dice que falló: una tarjeta vacía se leería como «nadie en riesgo» (26-01). */}
      {!(error && r === null) && (
      // Si la lista se recorta, dice cuántos hay en total.
      <Card pad={false} title="A quién llamar" sub={r && r.total > r.outreach.length ? `Se muestran las primeras ${r.outreach.length} de ${r.total}, en orden de dónde está el retorno.` : undefined}>
        {r === null ? <EsqueletoLista filas={6} /> : sinSocios ? (
          <Empty icon={<HeartHandshake />} title="Aún no tienes socios" text="Cuando registres socios, aquí verás a quién llamar."
            action={<ButtonLink href="/socios">Ir a socios</ButtonLink>} />
        ) : r.outreach.length === 0 ? (
          <Empty icon={<HeartHandshake />} title="Nadie en riesgo" text="Todos los socios vienen a su ritmo." />
        ) : (
          <>
            <ul className="list" data-testid="por-llamar">
              {porLlamar.map((a, i) => <FilaAlerta key={a.memberId} a={a} n={i + 1} c={contactos.get(a.memberId)} sedes={sedes.length} branchName={branchName} onLlamar={anota ? () => setLlamando(a) : undefined} mensaje={mensajeDe.get(a.memberId)} onMandado={mandado} />)}
              {porLlamar.length === 0 && <li className="list-item small muted">A todos se les llamó. Vuelven aquí cuando les toque el próximo paso.</li>}
            </ul>
            {yaContactados.length > 0 && (
              <details className="ya-contactados" data-testid="ya-contactados">
                <summary className="list-item small strong">Ya contactados ({yaContactados.length})</summary>
                <ul className="list">
                  {yaContactados.map((a) => <FilaAlerta key={a.memberId} a={a} c={contactos.get(a.memberId)} sedes={sedes.length} branchName={branchName} onLlamar={anota ? () => setLlamando(a) : undefined} mensaje={mensajeDe.get(a.memberId)} onMandado={mandado} />)}
                </ul>
              </details>
            )}
          </>
        )}
      </Card>
      )}
      {llamando && (
        <ContactoDialog para="socio" nombre={llamando.fullName.split(' ')[0]!} url={`/members/${llamando.memberId}/follow-ups`}
          onClose={() => setLlamando(null)} onListo={() => { setLlamando(null); cargarContactos(); }} />
      )}
    </div>
  );
}

function FilaAlerta({ a, n, c, sedes, branchName, onLlamar, mensaje, onMandado }: {
  a: Alerta; n?: number; c: Ultimo | undefined; sedes: number; branchName: (id: string | null) => string;
  /** Su «te extrañamos» pendiente (bandeja de salida): con él, WhatsApp abre con el texto y queda anotado. */
  mensaje: OutboundMessage | undefined; onMandado: (m: OutboundMessage) => void;
  /** Sin esto, quien mira no puede anotar contactos: la fila no ofrece «Le llamé». */
  onLlamar: (() => void) | undefined;
}) {
  const e = ESTADO_DE_HABITO[a.state] ?? { label: a.state, tone: 'neutral' as const };
  return (
    <li className="list-item se-apila">
      {n !== undefined && <span className="muted num" style={{ width: 22 }}>{n}</span>}
      <div className="fila-titulo flex-1 min-w-0">
        <Link href={`/socios/${a.memberId}`} className="strong small">{a.fullName}</Link> <code className="tiny muted">{a.memberCode}</code>
        <div className="tiny muted">{a.detail || QUE[a.state] || ''}{sedes > 1 && a.homeBranchId ? ` · ${branchName(a.homeBranchId)}` : ''}</div>
        <UltimoContacto c={c?.last} total={c?.count} />
      </div>
      <Badge tone={e.tone === 'neutral' ? undefined : e.tone}>{e.label}</Badge>
      <span className="small muted fila-dato" style={{ width: 120, textAlign: 'right' }}>
        {a.daysSinceLastVisit === null ? 'Nunca ha venido' : a.daysSinceLastVisit <= 0 ? 'Vino hoy' : a.daysSinceLastVisit === 1 ? 'Vino ayer' : `Hace ${a.daysSinceLastVisit} días`}
      </span>
      {a.phoneE164 && <>
        <a className="btn btn-ghost btn-icon btn-sm" href={`tel:${a.phoneE164}`} title={telefono(a.phoneE164)} aria-label="Llamar"><Phone /></a>
        <a className="btn btn-ghost btn-icon btn-sm" href={(mensaje && enlaceWhatsapp(a.phoneE164, mensaje.text)) || `https://wa.me/${a.phoneE164.replace('+', '')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"
          title={mensaje ? 'Abre WhatsApp con el mensaje ya escrito y lo deja anotado' : undefined} onClick={mensaje ? () => onMandado(mensaje) : undefined}><MessageCircle /></a>
      </>}
      {onLlamar && <Button size="sm" variant="secondary" icon={<PhoneCall />} onClick={onLlamar}>Le llamé</Button>}
    </li>
  );
}
