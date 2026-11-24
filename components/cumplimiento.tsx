'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { UserMinus } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Callout, Card, ErrorCarga, Field, Skeleton } from '@/components/ui';
import type { PrivacyInbox, PrivacyRequestsSummary } from '@gymflow/core/contracts';
import { ARCO_CHANNEL, ARCO_KIND, EstadoDeSolicitud } from '@/components/arco';
import { IconTile } from './compartido';
import { EstadoCarga, useCarga } from '@/lib/carga';

/**
 * La bandeja de cumplimiento (PS-07; 21-01): todo lo VIVO, primero lo vencido y
 * lo que vence antes. Vivo es lo que espera identidad, lo que falta responder
 * y lo que procede y falta hacer efectivo.
 */
export function BandejaArco() {
  const { can } = useSession();
  const ve = can('members:consent:read');
  // Sin red no es «Nada pendiente» (26-01): son plazos de ley.
  const cargar = useCallback(() => api<PrivacyInbox>('/privacy/requests').then((r) => r.requests), []);
  const carga = useCarga(ve ? cargar : null);
  if (!ve) return null;
  const vencidas = (carga.datos ?? []).filter((r) => r.overdue).length;
  return (
    <Card pad={false} title="Solicitudes ARCO abiertas" sub="Lo que los socios pidieron y sigue vivo: por acreditar identidad, por responder o por hacer efectivo. Se atiende desde su ficha." data-testid="bandeja-arco">
      {vencidas > 0 && <div className="card-body"><Callout tone="danger">{vencidas === 1 ? 'Hay 1 solicitud fuera de plazo.' : `Hay ${vencidas} solicitudes fuera de plazo.`}</Callout></div>}
      <EstadoCarga carga={carga} titulo="No se pudieron cargar las solicitudes" relleno esqueleto={<Skeleton h={60} />}
        vacio={<p className="card-body small muted">Nada pendiente. Cuando un socio pida corregir o borrar algo, aparece aquí con su plazo.</p>}>
        {(lista) => (
            <ul className="list">
              {lista.map((r) => (
                <li key={r.id} className="list-item wrap">
                  <div className="flex-1 min-w-0">
                    <Link href={`/socios/${r.memberId}?tab=consentimientos`} className="strong small">{r.member.fullName}</Link>
                    <span className="tiny muted"> · {ARCO_KIND[r.kind] ?? r.kind} · {ARCO_CHANNEL[r.channel] ?? r.channel} · entró el {fecha(r.receivedAt)}</span>
                  </div>
                  <EstadoDeSolicitud r={r} />
                </li>
              ))}
            </ul>
        )}
      </EstadoCarga>
    </Card>
  );
}

/**
 * Las cifras de la bandeja, sin nombres (21-01; D-25): una línea para Inicio
 * de la gerencia y de la dueña. No pinta nada si no hay ninguna viva.
 * `GET /privacy/requests/summary` responde a quien abarca todo el gimnasio con
 * consentimientos o con la bitácora (la dueña).
 */
export function AvisoSolicitudesArco() {
  const { can } = useSession();
  const ve = can('members:consent:read') || can('audit:read');
  const cargar = useCallback(() => api<PrivacyRequestsSummary>('/privacy/requests/summary'), []);
  const carga = useCarga(ve ? cargar : null);
  const c = carga.datos;
  if (!ve || !c || c.open === 0) return null;
  const partes = [
    c.toAnswer > 0 && `${c.toAnswer} por responder`,
    c.toEffect > 0 && `${c.toEffect} por hacer efectiva${c.toEffect === 1 ? '' : 's'}`,
    c.identityPending > 0 && `${c.identityPending} por acreditar identidad`,
  ].filter(Boolean).join(' · ');
  return (
    <div data-testid="aviso-arco">
      <Callout tone={c.overdue > 0 ? 'danger' : 'warn'} title={c.open === 1 ? '1 solicitud de privacidad abierta' : `${c.open} solicitudes de privacidad abiertas`}>
        {partes}.{' '}
        {c.overdue > 0 ? `${c.overdue === 1 ? 'Una ya venció' : `${c.overdue} ya vencieron`}: la ley da plazo a cada una.` : c.nextDeadlineAt ? `La más próxima vence el ${fecha(c.nextDeadlineAt)}.` : ''}
        {can('members:consent:read') && <> <Link href="/consentimientos">Ver la bandeja</Link></>}
      </Callout>
    </div>
  );
}

/**
 * LAS SOLICITUDES DE PRIVACIDAD, EN CIFRAS (3.7 · D-25): lo que ve la dueña en
 * Textos de consentimiento, donde la gerencia ve la bandeja con nombres.
 * Siempre a la vista, también en cero: «ninguna abierta» es un dato.
 */
export function SolicitudesEnCifras() {
  const carga = useCarga(useCallback(() => api<PrivacyRequestsSummary>('/privacy/requests/summary'), []));
  const c = carga.datos;
  return (
    <Card title="Solicitudes de privacidad" sub="Lo que tus socios pidieron sobre sus datos (acceso, corrección, cancelación u oposición), en cifras y sin nombres." data-testid="arco-en-cifras">
      {carga.error ? <ErrorCarga titulo="No se pudieron cargar las solicitudes" mensaje={carga.error} onReintentar={() => void carga.recargar()} />
        : !c ? <Skeleton h={72} /> : c.open === 0 ? <p className="small muted">Ninguna solicitud abierta.</p> : (
          <div className="stack-sm">
            <div className="row-between"><span className="muted">Abiertas</span><span className="num strong">{c.open}</span></div>
            <div className="row-between"><span className="muted">Por acreditar identidad</span><span className="num strong">{c.identityPending}</span></div>
            <div className="row-between"><span className="muted">Por responder</span><span className="num strong">{c.toAnswer}</span></div>
            <div className="row-between"><span className="muted">Por hacer efectivas</span><span className="num strong">{c.toEffect}</span></div>
            <div className="row-between"><span className="muted">Con el plazo vencido</span><span className={`num strong${c.overdue > 0 ? ' text-danger' : ''}`}>{c.overdue}</span></div>
            {c.nextDeadlineAt && <p className="tiny muted">El plazo más próximo vence el {fecha(c.nextDeadlineAt)}. Las atiende la gerencia.</p>}
          </div>
        )}
    </Card>
  );
}

type Candidatos = { monthsAfterArchive: number | null; members: Array<{ id: string; firstName: string; lastName: string; memberCode: string; archivedAt: string }> };

/**
 * PLAZO DE SUPRESIÓN (PS-08): meses tras la baja para proponer la anonimización.
 * Propone, no borra: anonimizar sigue exigiendo dos firmas desde la ficha.
 */
export function PlazoSupresion() {
  const { can } = useSession();
  const toast = useToast();
  const [meses, setMeses] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Sin red no es «sin plazo» con el campo vacío: guardar así lo habría borrado (26-01).
  const ve = can('members:consent:read');
  const cargarPlazo = useCallback(() => {
    const fuente = can('members:anonymize') ? '/privacy/candidates' : '/privacy/settings';
    return api<Candidatos | { monthsAfterArchive: number | null }>(fuente).then((r): Candidatos => ('members' in r ? r : { ...r, members: [] }));
  }, [can]);
  const carga = useCarga(ve ? cargarPlazo : null);
  const c = carga.datos ?? null;
  useEffect(() => { if (c) setMeses(c.monthsAfterArchive ? String(c.monthsAfterArchive) : ''); }, [c]);
  const cargar = () => { void carga.recargar(); };
  if (!ve) return null;

  async function guardar() {
    setEnviando(true);
    try {
      const n = meses.trim() === '' ? null : Number(meses);
      await api('/privacy/settings', { method: 'PUT', body: JSON.stringify({ monthsAfterArchive: n }) });
      toast('ok', n ? `Plazo guardado: ${n} meses tras la baja` : 'Sin plazo: nadie se propone solo');
      cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setEnviando(false); }
  }

  return (
    <Card pad={false} title="Plazo de supresión de exsocios" sub="Cuántos meses después de la baja se propone anonimizar. Propone, no borra: cada anonimización lleva dos firmas." data-testid="plazo-supresion">
      <div className="card-body stack-sm">
        {carga.error ? <ErrorCarga titulo="No se pudo consultar el plazo" mensaje={carga.error} onReintentar={cargar} />
          : !c ? <Skeleton h={40} />
          : can('settings:org') ? (
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <Field label="Meses tras la baja" htmlFor="sup-m" hint="Vacío = sin plazo. 24 es un valor razonable.">
              <input id="sup-m" className="input num" inputMode="numeric" style={{ width: 120 }} value={meses} onChange={(e) => setMeses(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="p. ej. 24" />
            </Field>
            <Button variant="secondary" loading={enviando} onClick={() => void guardar()}>Guardar</Button>
          </div>
        ) : <p className="small muted">{c?.monthsAfterArchive ? `Plazo: ${c.monthsAfterArchive} meses tras la baja.` : 'Sin plazo fijado: lo define la gerencia.'}</p>}
      </div>
      {can('members:anonymize') && !carga.error && (c === null ? <div className="card-body"><Skeleton h={40} /></div>
        : c.members.length === 0 ? <p className="card-body small muted pt-0">{c.monthsAfterArchive ? 'Ningún exsocio ha cumplido el plazo.' : 'Fija un plazo para que aparezcan candidatos.'}</p>
          : (
            <ul className="list">
              {c.members.map((m) => (
                <li key={m.id} className="list-item">
                  <IconTile tone="warn"><UserMinus /></IconTile>
                  <div className="flex-1 min-w-0"><Link href={`/socios/${m.id}`} className="strong small">{m.firstName} {m.lastName}</Link> <span className="tiny muted"><code>{m.memberCode}</code> · baja el {fecha(m.archivedAt)}</span></div>
                  <Link className="btn btn-secondary btn-sm" href={`/socios/${m.id}`}>Anonimizar en su ficha</Link>
                </li>
              ))}
            </ul>
          ))}
    </Card>
  );
}
