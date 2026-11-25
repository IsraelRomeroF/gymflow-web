'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, CalendarDays, CircleCheck, ShieldAlert } from 'lucide-react';
import type { OwnerAlert, OwnerAlerts, WeeklySummary } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { dia, fechaHora, pesos } from '@/lib/format';
import { errorText, useSession, useToast } from './session';
import { Badge, ButtonLink, Callout, Card, Stat, Switch } from './ui';

/**
 * LOS AVISOS DE LA DUEÑA DENTRO DEL PANEL (fase 4, bloque 4.2; D-05).
 *
 * Todo lo que suena en su teléfono existe también aquí, porque sin llaves en
 * el servidor o sin dirección fija el teléfono no suena. Solo para el puesto
 * Dueño: a los demás la API les responde vacío y aquí no se pinta nada.
 */
export function useAvisosDeLaDuena(): { avisos: OwnerAlerts | null; error: string | null; recargar: () => void; poner: (a: OwnerAlerts) => void } {
  const { mirada } = useSession();
  const esDuena = mirada.roles.includes('OWNER');
  const [avisos, setAvisos] = useState<OwnerAlerts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(() => {
    if (!esDuena) return;
    api<OwnerAlerts>('/owner-alerts').then((a) => { setAvisos(a); setError(null); }).catch((e) => setError(errorText(e, 'No se pudieron cargar tus avisos')));
  }, [esDuena]);
  useEffect(recargar, [recargar]);
  return { avisos: esDuena ? avisos : null, error: esDuena ? error : null, recargar, poner: setAvisos };
}

/** Cuántos avisos nuevos tiene la dueña: el número de su menú. Se revisa cada minuto con la pestaña a la vista. */
export function useAvisosNuevos(): number {
  const { mirada } = useSession();
  const esDuena = mirada.roles.includes('OWNER');
  const [nuevos, setNuevos] = useState(0);
  useEffect(() => {
    if (!esDuena) return;
    const revisar = () => {
      if (document.hidden) return;
      api<OwnerAlerts>('/owner-alerts').then((a) => setNuevos(a.visible ? a.unseen : 0)).catch(() => undefined);
    };
    revisar();
    const t = setInterval(revisar, 60_000);
    // Al abrir sus avisos se marcan como vistos: el número del menú se apaga en el acto.
    const vistos = () => setNuevos(0);
    window.addEventListener('gymflow:avisos-vistos', vistos);
    return () => { clearInterval(t); window.removeEventListener('gymflow:avisos-vistos', vistos); };
  }, [esDuena]);
  return esDuena ? nuevos : 0;
}

/** Avisa una vez por carga que la dueña tiene sus avisos a la vista. */
export function useAvisosVistos(avisos: OwnerAlerts | null): void {
  const avisado = useRef(false);
  useEffect(() => {
    if (avisado.current || !avisos?.visible || avisos.unseen === 0) return;
    avisado.current = true;
    api('/owner-alerts/seen', { method: 'POST' })
      .then(() => window.dispatchEvent(new Event('gymflow:avisos-vistos')))
      .catch(() => { avisado.current = false; });
  }, [avisos]);
}

const semana = (s: WeeklySummary): string => `${dia(s.from)} al ${dia(s.to)}`;

/**
 * LA TARJETA DEL INICIO: los avisos que no ha visto (hasta tres) y su último
 * resumen de la semana, con el camino a la pantalla completa. Si no carga no
 * estorba: los avisos siguen en su menú.
 */
export function AvisosDeLaDuenaTarjeta() {
  const { avisos } = useAvisosDeLaDuena();
  if (!avisos?.visible) return null;
  const nuevos = avisos.alerts.filter((a) => !a.seen);
  const resumen = avisos.summaries[0];
  return (
    <Card title={<span className="row gap-6"><BellRing size={16} aria-hidden />Tus avisos</span>} data-testid="avisos-duena" data-nuevos={nuevos.length}>
      {nuevos.length === 0 ? (
        <p className="row small gap-8"><CircleCheck size={16} aria-hidden />Sin avisos nuevos.</p>
      ) : (
        <ul className="stack-sm lista-limpia">
          {nuevos.slice(0, 3).map((a) => (
            <li key={a.id} className="duena-alerta small" data-aviso={a.kind}><ShieldAlert size={15} className="text-warn" aria-hidden /><span><strong>{a.title}.</strong> {a.body}</span></li>
          ))}
        </ul>
      )}
      {nuevos.length > 3 && <p className="tiny muted mt-8">Y {nuevos.length - 3} más.</p>}
      {resumen && (
        <p className="small mt-8" data-testid="resumen-semana-inicio"><CalendarDays size={14} aria-hidden /> <strong>Tu semana ({semana(resumen)}):</strong> {resumen.body}</p>
      )}
      <p className="tiny muted mt-8">
        <Link href="/avisos">Ver todos mis avisos y elegir cuáles suenan en mi teléfono</Link>.
        {!avisos.pushConfigured ? ' Hoy solo salen aquí: este servidor todavía no tiene activados los avisos al teléfono.' : avisos.devices === 0 ? ' Hoy solo salen aquí: no has activado los avisos en ningún teléfono.' : ''}
      </p>
    </Card>
  );
}

/** Un aviso con su detalle: lo que el teléfono no dice (quién abrió, quién cambió el precio). */
export function AvisoDeLaLista({ aviso, sede }: { aviso: OwnerAlert; sede: string | null }) {
  return (
    <li className="stack-sm" data-aviso={aviso.kind} data-visto={aviso.seen ? 'si' : 'no'}>
      <div className="row-between gap-12 flex-wrap">
        <span className="strong">{aviso.title}{!aviso.seen && <> <Badge tone="warn" dot>Nuevo</Badge></>}</span>
        <span className="tiny muted">{fechaHora(aviso.occurredAt)}{sede ? ` · ${sede}` : ''}</span>
      </div>
      <p className="small">{aviso.body}</p>
      {aviso.lines.length > 0 && (
        <ul className="duena-renglones small">
          {aviso.lines.map((l) => <li key={l.label}><span className="muted">{l.label}</span><span>{l.value}</span></li>)}
        </ul>
      )}
      <p className="tiny muted">
        {aviso.pushDevices > 0 ? `Sonó en ${aviso.pushDevices} ${aviso.pushDevices === 1 ? 'teléfono' : 'teléfonos'}.` : 'No sonó en ningún teléfono: quedó aquí.'}
        {aviso.url !== '/avisos' && <> <Link href={aviso.url}>Ir a resolverlo</Link>.</>}
      </p>
    </li>
  );
}

const cuantos = (n: number, uno: string, varios: string): string => `${n.toLocaleString('es-MX')} ${n === 1 ? uno : varios}`;

/** EL RESUMEN DE UNA SEMANA, completo: las cifras que el teléfono resume en una línea. */
export function ResumenDeLaSemana({ resumen }: { resumen: WeeklySummary }) {
  const f = resumen.figures;
  const esperan = f.awaiting.approvals + f.awaiting.privacyNotice + f.awaiting.exMembersList;
  return (
    <div className="stack" data-testid="resumen-semana" data-semana={resumen.from}>
      <div className="grid grid-4">
        <Stat label="Entradas" value={f.entries.total.toLocaleString('es-MX')} note={`La semana anterior: ${f.entries.previous.toLocaleString('es-MX')}`} />
        <Stat label="Altas y bajas" value={`${f.members.joined} / ${f.members.left}`} note={`${cuantos(f.members.joined, 'socio nuevo', 'socios nuevos')} · ${cuantos(f.members.left, 'baja', 'bajas')}`} />
        <Stat label="Cobrado" value={pesos(f.money.collectedCents, { decimals: false })} note={`La semana anterior: ${pesos(f.money.previousCollectedCents, { decimals: false })}`} />
        <Stat label="Por cobrar hoy" value={pesos(f.money.outstandingCents, { decimals: false })} note={`De eso, atrasado: ${pesos(f.money.overdueCents, { decimals: false })}`} />
      </div>
      <ul className="duena-renglones small">
        <li><span>Cortes con diferencia</span><span>{f.cash.variances === 0 ? 'Ninguno' : `${f.cash.variances} · faltó ${pesos(f.cash.shortCents)} · sobró ${pesos(f.cash.overCents)}${f.cash.pendingReview > 0 ? ` · ${f.cash.pendingReview} por revisar` : ''}`}</span></li>
        <li><span>Firmas pedidas</span><span>{f.signatures.requested} · {f.signatures.approved} autorizadas · {f.signatures.rejected} rechazadas</span></li>
        <li><span>Espera tu firma hoy</span><span>{esperan === 0 ? 'Nada' : [
          f.awaiting.approvals > 0 ? cuantos(f.awaiting.approvals, 'autorización', 'autorizaciones') : null,
          f.awaiting.privacyNotice > 0 ? 'el aviso de privacidad' : null,
          f.awaiting.exMembersList > 0 ? 'la lista de exsocios' : null,
        ].filter(Boolean).join(' · ')}</span></li>
        <li><span>Devoluciones</span><span>{f.money.refunds.count === 0 ? 'Ninguna' : `${f.money.refunds.count} · ${pesos(-BigInt(f.money.refunds.cents))}`}</span></li>
        <li><span>Descuentos</span><span>{f.money.discounts}</span></li>
        <li><span>Ventas con fecha anterior</span><span>{f.money.backdatedSales}</span></li>
        {f.money.lostDebtCents !== '0' && <li><span>Deuda dada por perdida</span><span>{pesos(f.money.lostDebtCents)}</span></li>}
        <li><span>Entradas por excepción</span><span>{f.exceptions.manualEntries}{f.exceptions.overLimit > 0 ? ` · ${cuantos(f.exceptions.overLimit, 'vez se pasó el tope', 'veces se pasó el tope')}` : ''}</span></li>
        <li><span>Entradas autorizadas sin rostro</span><span>{f.exceptions.withoutFace}</span></li>
        {f.exceptions.sharedPhoneChanges > 0 && <li><span>Cambios de celular a un número compartido</span><span>{f.exceptions.sharedPhoneChanges}</span></li>}
        <li><span>Bitácora</span><span className={f.audit.intact === false ? 'text-danger strong' : undefined}>{f.audit.intact === null ? 'No se pudo verificar' : f.audit.intact ? 'Íntegra' : 'NO verifica: revísala'}</span></li>
      </ul>
      {resumen.people.length > 0 && (
        <div>
          <p className="tiny strong">Descuentos y devoluciones por persona</p>
          <ul className="duena-renglones small" data-testid="resumen-por-persona">
            {resumen.people.map((p) => (
              <li key={p.name}><span>{p.name}</span><span>{cuantos(p.discounts, 'descuento', 'descuentos')} · {cuantos(p.refunds, 'devolución', 'devoluciones')} <span className="muted">· lo normal: {p.usual.toLocaleString('es-MX')} por semana</span></span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * QUÉ AVISOS RECIBO (D-05: «cada aviso se puede apagar»). Un interruptor por
 * tipo. Apagado, el aviso deja de sonar en el teléfono y sigue saliendo aquí.
 */
export function PreferenciasDeAvisos({ avisos, onCambio }: { avisos: OwnerAlerts; onCambio: (a: OwnerAlerts) => void }) {
  const toast = useToast();
  const [guardando, setGuardando] = useState<string | null>(null);
  async function cambiar(kind: OwnerAlerts['preferences'][number]['kind'], enabled: boolean) {
    setGuardando(kind);
    try {
      await api('/owner-alerts/preferences', { method: 'PUT', body: JSON.stringify({ kind, enabled }) });
      onCambio({ ...avisos, preferences: avisos.preferences.map((p) => (p.kind === kind ? { ...p, enabled } : p)) });
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setGuardando(null); }
  }
  return (
    <div className="stack" data-testid="preferencias-avisos">
      {!avisos.pushConfigured && <Callout tone="info">Este servidor todavía no tiene activados los avisos al teléfono: por ahora todo sale solo aquí, en el panel. Lo que elijas queda guardado para cuando se activen.</Callout>}
      <ul className="stack lista-limpia avisos-interruptores">
        {avisos.preferences.map((p) => (
          <li key={p.kind} data-preferencia={p.kind}>
            <Switch checked={p.enabled} disabled={guardando === p.kind} onChange={(v) => void cambiar(p.kind, v)}>
              <span className="strong">{p.label}</span>
              <span className="tiny muted"> · {p.description} En el panel: {p.inPanel}.</span>
            </Switch>
          </li>
        ))}
      </ul>
      <div>
        <p className="tiny strong">Llegan siempre mientras este teléfono tenga los avisos activos</p>
        <ul className="duena-renglones small">
          {avisos.always.map((a) => <li key={a.label}><span>{a.label}</span><span className="muted">{a.description}</span></li>)}
        </ul>
      </div>
      <p className="tiny muted">Apagar un aviso solo calla el teléfono: sigue saliendo aquí. Cada cambio queda en la bitácora.</p>
    </div>
  );
}

/** El camino a la pantalla, para «Mis sesiones». */
export function EnlaceAMisAvisos() {
  const { mirada } = useSession();
  if (!mirada.roles.includes('OWNER')) return null;
  return <div data-testid="enlace-mis-avisos"><ButtonLink href="/avisos" size="sm" variant="ghost" icon={<BellRing />}>Elegir qué avisos recibo</ButtonLink></div>;
}
