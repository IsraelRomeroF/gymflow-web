'use client';

import { useCallback, useState } from 'react';
import { FileQuestion, Plus, Printer, ShieldCheck } from 'lucide-react';
import type { MemberConsentText, MemberPrivacyRequests, PrivacyRequest, PrivacyRequestReceipt } from '@gymflow/core/contracts';
import {
  ACCION_POR_SOLICITUD, CANAL_DE_SOLICITUD_ARCO, CONSECUENCIA_DE_RETIRAR, ESTADO_DE_SOLICITUD_ARCO, MOTIVOS_DE_PRIVACIDAD, PLAZOS_ARCO,
  REVOCABLES_EN_RECEPCION, SOLICITUDES_CON_PERMISO, TIPOS_DE_SOLICITUD_ARCO, TIPO_DE_SOLICITUD_ARCO_PERSONAL, venceResponder,
  type TipoDeSolicitudArco,
} from '@gymflow/core/privacidad';
import { api } from '@/lib/api';
import { fecha, fechaHora } from '@/lib/format';
import { CONSENT_TYPE } from '@/lib/labels';
import { useFormulario } from '@/lib/formulario';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, Empty, ErrorCarga, Field, Opciones, Skeleton, faltaMotivo, ERROR_MOTIVO } from '@/components/ui';
import { EstadoCarga, useCarga } from '@/lib/carga';

export type SolicitudArco = PrivacyRequest;

/** Qué pide y por dónde llegó: las palabras son las del núcleo, las mismas del portal y de la constancia. */
export const ARCO_KIND = TIPO_DE_SOLICITUD_ARCO_PERSONAL;
export const ARCO_CHANNEL = CANAL_DE_SOLICITUD_ARCO;

/** La insignia de una solicitud: en qué va y qué plazo corre. Sirve a la ficha y a la bandeja. */
export function EstadoDeSolicitud({ r }: { r: SolicitudArco }) {
  if (r.status === 'IDENTITY_PENDING') return <Badge tone="warn" dot>{ESTADO_DE_SOLICITUD_ARCO.IDENTITY_PENDING.personal}</Badge>;
  if (r.status === 'OPEN') return <Badge tone={r.overdue ? 'danger' : 'warn'} dot>{r.overdue ? `Vencida el ${fecha(r.dueAt)}` : `Vence el ${fecha(r.dueAt)}`}</Badge>;
  if (r.status === 'EFFECT_PENDING') {
    return <Badge tone={r.overdue ? 'danger' : 'info'} dot>{r.overdue ? `Procede · debió quedar el ${fecha(r.effectiveDueAt)}` : `Procede · hacerlo antes del ${fecha(r.effectiveDueAt)}`}</Badge>;
  }
  if (r.outcome === 'DENIED') return <Badge dot>No procede · {fecha(r.resolvedAt)}</Badge>;
  return <Badge tone="ok" dot>Resuelta {fecha(r.effectedAt ?? r.resolvedAt)}</Badge>;
}

/**
 * SOLICITUDES ARCO del socio (PS-07; ciclo completo, auditoría 8 bloque 1.10).
 * Cada una lleva su folio, cuándo entró, si ya se acreditó quién la pide, el
 * plazo que corre (20 días hábiles para responder, 15 más para hacerlo) y la
 * respuesta que recibió el socio.
 */
export function SolicitudesArco({ memberId }: { memberId: string }) {
  const { can } = useSession();
  const toast = useToast();
  const [nueva, setNueva] = useState(false);
  const [identidad, setIdentidad] = useState<SolicitudArco | null>(null);
  const [resolver, setResolver] = useState<SolicitudArco | null>(null);
  const [efecto, setEfecto] = useState<SolicitudArco | null>(null);
  const [constancia, setConstancia] = useState<SolicitudArco | null>(null);
  // Sin red no es «Sin solicitudes» (26-01): cada una corre un plazo de ley.
  const ve = can('members:consent:read');
  const registra = can('members:privacy:request');
  const resuelve = can('members:update');
  const cargarLista = useCallback(() => api<MemberPrivacyRequests>(`/members/${memberId}/privacy-requests`).then((r) => r.requests), [memberId]);
  const carga = useCarga(ve ? cargarLista : null);
  const cargar = () => { void carga.recargar(); };
  if (!ve) return null;
  const vivas = (carga.datos ?? []).filter((r) => r.status !== 'CLOSED');
  const hecho = (mensaje: string) => { cargar(); toast('ok', mensaje); };
  return (
    <Card pad={false} title="Solicitudes ARCO" sub={`Acceso, rectificación, cancelación u oposición. Se responde en ${PLAZOS_ARCO.responder.habiles} días hábiles y, si procede, se hace efectivo en ${PLAZOS_ARCO.hacerEfectiva.habiles} más; la fecha de entrada es la prueba.`}
      actions={registra ? <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setNueva(true)}>Registrar solicitud</Button> : undefined}>
      <EstadoCarga carga={carga} titulo="No se pudieron cargar sus solicitudes" relleno esqueleto={<Skeleton h={60} />}
        vacio={<Empty icon={<FileQuestion />} title="Sin solicitudes" text="Cuando el socio pida corregir o borrar algo, regístralo aquí para que corra el plazo." />}>
        {(lista) => (
          <ul className="list">
            {lista.map((r) => (
              <li key={r.id} className="list-item items-start wrap" data-testid="solicitud-arco">
                <div className="flex-1 min-w-0">
                  <p className="strong small">{ARCO_KIND[r.kind] ?? r.kind}{r.consentType ? `: ${CONSENT_TYPE[r.consentType] ?? r.consentType}` : ''}</p>
                  <p className="tiny muted"><code>{r.folio}</code> · {ARCO_CHANNEL[r.channel] ?? r.channel} · entró el {fecha(r.receivedAt)}{r.identityNote ? ` · identidad: ${r.identityNote}` : ''}</p>
                  {r.note && <p className="small muted">«{r.note}»</p>}
                  {r.resolution && <p className="small">Respuesta: {r.resolution}</p>}
                  {r.effectNote && <p className="tiny muted">Hecho el {fecha(r.effectedAt)}: {r.effectNote}</p>}
                  {r.status === 'EFFECT_PENDING' && <p className="tiny muted">Falta: {ACCION_POR_SOLICITUD[r.kind].texto}.</p>}
                </div>
                <div className="row gap-8 wrap">
                  <EstadoDeSolicitud r={r} />
                  <Button size="sm" variant="ghost" icon={<Printer />} onClick={() => setConstancia(r)}>Constancia</Button>
                  {r.status === 'IDENTITY_PENDING' && registra && <Button size="sm" onClick={() => setIdentidad(r)}>Acreditar identidad</Button>}
                  {r.status === 'OPEN' && resuelve && <Button size="sm" onClick={() => setResolver(r)}>Resolver</Button>}
                  {r.status === 'EFFECT_PENDING' && resuelve && <Button size="sm" onClick={() => setEfecto(r)}>Ya quedó hecho</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </EstadoCarga>
      {vivas.some((r) => r.overdue) && <div className="card-body pt-0"><Callout tone="danger">Hay solicitudes fuera de plazo: {PLAZOS_ARCO.responder.habiles} días hábiles para responder y {PLAZOS_ARCO.hacerEfectiva.habiles} más para hacer efectivo lo que procede.</Callout></div>}
      {nueva && <NuevaSolicitud memberId={memberId} onClose={() => setNueva(false)} onHecho={(r) => { setNueva(false); hecho(r.status === 'IDENTITY_PENDING' ? 'Solicitud registrada: falta acreditar su identidad para que corra el plazo' : 'Solicitud registrada: el plazo ya corre'); setConstancia(r); }} />}
      {identidad && <AcreditarIdentidad solicitud={identidad} onClose={() => setIdentidad(null)} onHecho={() => { setIdentidad(null); hecho('Identidad acreditada: el plazo ya corre'); }} />}
      {resolver && <ResolverSolicitud solicitud={resolver} onClose={() => setResolver(null)} onHecho={(r) => { setResolver(null); hecho(r.status === 'EFFECT_PENDING' ? 'Solicitud resuelta: procede. Cuando quede hecho, márcalo aquí' : 'Solicitud resuelta: el socio ya tiene la respuesta en su portal'); }} />}
      {efecto && <HacerEfectiva solicitud={efecto} onClose={() => setEfecto(null)} onHecho={() => { setEfecto(null); hecho('Solicitud cerrada: quedó hecho'); }} />}
      {constancia && <ConstanciaDialog solicitud={constancia} onClose={() => setConstancia(null)} />}
    </Card>
  );
}

const PERMISOS = REVOCABLES_EN_RECEPCION.map((t) => ({ value: t, label: CONSENT_TYPE[t] ?? t }));

function NuevaSolicitud({ memberId, onClose, onHecho }: { memberId: string; onClose: () => void; onHecho: (r: SolicitudArco) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<TipoDeSolicitudArco | null>(null);
  const [channel, setChannel] = useState<'FRONT_DESK' | 'EMAIL' | 'WRITTEN'>('FRONT_DESK');
  const [consentType, setConsentType] = useState<(typeof REVOCABLES_EN_RECEPCION)[number] | null>(null);
  const [note, setNote] = useState('');
  const [verificada, setVerificada] = useState(false);
  const pidePermiso = !!kind && SOLICITUDES_CON_PERMISO.includes(kind);
  const enMostrador = channel === 'FRONT_DESK';
  const f = useFormulario({
    kind: !kind && 'Elige qué pide',
    consentType: kind === 'REVOCATION' && !consentType && 'Elige qué permiso quiere retirar',
    identidad: enMostrador && !verificada && 'Confirma que verificaste su identidad',
  }, { obligatorios: ['kind'] });

  async function guardar() {
    try {
      const r = await api<SolicitudArco>(`/members/${memberId}/privacy-requests`, {
        method: 'POST',
        body: JSON.stringify({
          kind, channel, ...(note.trim() ? { note: note.trim() } : {}), ...(pidePermiso && consentType ? { consentType } : {}),
          ...(verificada ? { identityVerified: true, identityNote: enMostrador ? 'En persona o con su INE' : 'Con su INE' } : {}),
        }),
      });
      onHecho(r);
    } catch (e) { toast('error', errorText(e, 'No se pudo registrar')); }
  }
  return (
    <Dialog open onClose={onClose} title="Registrar solicitud ARCO"
      sub={verificada || !enMostrador ? `Queda la fecha de hoy como entrada. ${verificada ? `Vence el ${fecha(venceResponder(new Date()).toISOString())} (${PLAZOS_ARCO.responder.habiles} días hábiles).` : 'El plazo corre cuando se acredite su identidad.'}` : `Queda la fecha de hoy como entrada. Hay ${PLAZOS_ARCO.responder.habiles} días hábiles para responder.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button loading={f.enviando} onClick={() => void f.enviar(guardar)}>Registrar</Button></>}>
      <div className="stack">
        <Field label="Qué pide" {...f.campo('kind')}>
          <Opciones forma="chips" etiqueta="Qué pide" value={kind} onChange={setKind} opciones={TIPOS_DE_SOLICITUD_ARCO.map((k) => ({ value: k, label: ARCO_KIND[k] ?? k }))} />
        </Field>
        {pidePermiso && (
          <Field label={kind === 'REVOCATION' ? 'Qué permiso retira' : 'De qué permiso se opone (si es uno en particular)'} required={kind === 'REVOCATION'} error={f.error('consentType')}
            hint="Si procede, se retira en el mismo acto de resolverla.">
            <Opciones forma="chips" etiqueta="Permiso" value={consentType} onChange={setConsentType} opciones={PERMISOS} />
          </Field>
        )}
        <Field label="Por dónde llegó">
          <Opciones forma="chips" etiqueta="Por dónde llegó" value={channel} onChange={setChannel}
            opciones={(['FRONT_DESK', 'EMAIL', 'WRITTEN'] as const).map((k) => ({ value: k, label: ARCO_CHANNEL[k] ?? k }))} />
        </Field>
        <Field label="Qué dijo (opcional)" htmlFor="arco-n"><input id="arco-n" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quiere que se borre su correo…" /></Field>
        <div data-error={f.error('identidad') ? '' : undefined}>
          <label className="check">
            <input type="checkbox" checked={verificada} onChange={(e) => setVerificada(e.target.checked)} />
            <span>Verifiqué su identidad (con su INE o porque lo conozco en persona)</span>
          </label>
          {f.error('identidad') && <p className="field-error">{f.error('identidad')}</p>}
          {!enMostrador && !verificada && <p className="tiny muted mt-6">Sin marcarla, la solicitud queda «Falta acreditar identidad» y el plazo no corre: cualquiera puede escribir pidiendo los datos de otra persona.</p>}
        </div>
      </div>
    </Dialog>
  );
}

function AcreditarIdentidad({ solicitud, onClose, onHecho }: { solicitud: SolicitudArco; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [como, setComo] = useState('');
  const f = useFormulario({ como: como.trim().length < 2 && 'Di cómo la acreditó' }, { obligatorios: ['como'] });
  async function guardar() {
    try {
      await api(`/privacy/requests/${solicitud.id}/identity`, { method: 'POST', body: JSON.stringify({ note: como.trim() }) });
      onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); }
  }
  return (
    <Dialog open onClose={onClose} size="sm" title="Acreditar identidad" sub={`${ARCO_KIND[solicitud.kind] ?? solicitud.kind} · entró el ${fecha(solicitud.receivedAt)}. Desde hoy corren los ${PLAZOS_ARCO.responder.habiles} días hábiles para responder.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button icon={<ShieldCheck />} loading={f.enviando} onClick={() => void f.enviar(guardar)}>Acreditar</Button></>}>
      <CampoMotivo id="arco-id" label="Cómo acreditó que es el titular" hint="Queda en la solicitud y en la bitácora con tu nombre." autoFocus maxLength={120}
        value={como} onChange={setComo} motivos={['Vino con su INE', 'Lo conozco en persona', 'Mandó copia de su INE']} error={f.error('como')} />
    </Dialog>
  );
}

function ResolverSolicitud({ solicitud, onClose, onHecho }: { solicitud: SolicitudArco; onClose: () => void; onHecho: (r: SolicitudArco) => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<'GRANTED' | 'DENIED' | null>(null);
  const [texto, setTexto] = useState('');
  const [consentType, setConsentType] = useState(solicitud.consentType);
  const pidePermiso = SOLICITUDES_CON_PERMISO.includes(solicitud.kind);
  const accion = ACCION_POR_SOLICITUD[solicitud.kind];
  const f = useFormulario({
    outcome: !outcome && 'Elige si procede o no procede',
    consentType: outcome === 'GRANTED' && solicitud.kind === 'REVOCATION' && !consentType && 'Elige qué permiso se retira',
    texto: faltaMotivo(texto) && (outcome === 'DENIED' ? 'Escribe por qué no procede: es lo que leerá el socio' : 'Escribe la respuesta: es lo que leerá el socio'),
  }, { obligatorios: ['outcome', 'texto'] });
  async function resolver() {
    try {
      const r = await api<SolicitudArco>(`/privacy/requests/${solicitud.id}/resolve`, {
        method: 'POST', body: JSON.stringify({ outcome, resolution: texto.trim(), ...(pidePermiso && consentType ? { consentType } : {}) }),
      });
      onHecho(r);
    } catch (e) { toast('error', errorText(e, 'No se pudo resolver')); }
  }
  const retira = outcome === 'GRANTED' && pidePermiso && !!consentType;
  return (
    <Dialog open onClose={onClose} title={`Resolver: ${ARCO_KIND[solicitud.kind] ?? solicitud.kind}`} sub={`Folio ${solicitud.folio}. Entró el ${fecha(solicitud.receivedAt)}; vence el ${fecha(solicitud.dueAt)}.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button icon={<ShieldCheck />} loading={f.enviando} onClick={() => void f.enviar(resolver)}>{retira ? 'Retirar el permiso y responder' : 'Marcar resuelta'}</Button></>}>
      <div className="stack">
        {solicitud.note && <p className="small muted">El socio dijo: «{solicitud.note}»</p>}
        <Field label="¿Procede?" {...f.campo('outcome')}>
          <Opciones forma="segmentado" etiqueta="¿Procede?" value={outcome} onChange={setOutcome} opciones={[{ value: 'GRANTED', label: 'Procede' }, { value: 'DENIED', label: 'No procede' }]} />
        </Field>
        {outcome === 'GRANTED' && pidePermiso && (
          <Field label="Qué permiso se retira" required={solicitud.kind === 'REVOCATION'} error={f.error('consentType')}>
            <Opciones forma="chips" etiqueta="Permiso" value={consentType} onChange={setConsentType} opciones={PERMISOS} />
          </Field>
        )}
        {outcome === 'GRANTED' && (
          retira
            ? <Callout tone="warn" title="Se retira ahora mismo">{CONSECUENCIA_DE_RETIRAR[consentType!]?.personal} La solicitud queda hecha en este acto.</Callout>
            : <Callout tone="info" title={`Después hay ${PLAZOS_ARCO.hacerEfectiva.habiles} días hábiles para hacerlo`}>
              {accion.texto}.{' '}
              {solicitud.kind === 'ACCESS' && <>Usa «Descargar sus datos» en esta ficha: la solicitud se cierra sola al descargarlos.</>}
              {solicitud.kind === 'CANCELLATION' && <>Se cierra sola cuando lo anonimices desde «Datos personales y baja».</>}
              {(solicitud.kind === 'RECTIFICATION' || (solicitud.kind === 'OPPOSITION' && !consentType)) && <>Cuando quede, vuelve aquí y marca «Ya quedó hecho».</>}
            </Callout>
        )}
        <CampoMotivo id="arco-r" label={outcome === 'DENIED' ? 'Por qué no procede' : 'Qué se hizo'} hint="Es la respuesta que el socio lee en su portal; también queda en la bitácora con tu nombre."
          renglones={3} maxLength={500} value={texto} onChange={setTexto} error={f.error('texto') ? (f.error('texto') ?? ERROR_MOTIVO) : null}
          motivos={outcome === 'DENIED' ? MOTIVOS_DE_PRIVACIDAD.noProcede : undefined}
          placeholder={outcome === 'DENIED' ? undefined : 'Se corrigió el apellido en la ficha'} />
      </div>
    </Dialog>
  );
}

function HacerEfectiva({ solicitud, onClose, onHecho }: { solicitud: SolicitudArco; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const f = useFormulario({ nota: faltaMotivo(nota) && 'Escribe qué se hizo: el socio lo lee en su portal' }, { obligatorios: ['nota'] });
  async function guardar() {
    try {
      await api(`/privacy/requests/${solicitud.id}/effect`, { method: 'POST', body: JSON.stringify({ note: nota.trim() }) });
      onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo cerrar')); }
  }
  return (
    <Dialog open onClose={onClose} size="sm" title="Ya quedó hecho" sub={`${ARCO_KIND[solicitud.kind] ?? solicitud.kind} · procede desde el ${fecha(solicitud.resolvedAt)}; había que hacerlo antes del ${fecha(solicitud.effectiveDueAt)}.`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button icon={<ShieldCheck />} loading={f.enviando} onClick={() => void f.enviar(guardar)}>Cerrar solicitud</Button></>}>
      <CampoMotivo id="arco-e" label="Qué se hizo" hint="El socio lo lee en su portal; queda en la bitácora con tu nombre." autoFocus maxLength={500} value={nota} onChange={setNota} error={f.error('nota')}
        placeholder={solicitud.kind === 'RECTIFICATION' ? 'Se corrigió su correo en la ficha' : undefined} />
    </Dialog>
  );
}

/** La constancia para imprimir o dictar: folio, qué pidió, cuándo entró y hasta cuándo se le responde. */
function ConstanciaDialog({ solicitud, onClose }: { solicitud: SolicitudArco; onClose: () => void }) {
  const cargar = useCallback(() => api<PrivacyRequestReceipt>(`/privacy/requests/${solicitud.id}/receipt`), [solicitud.id]);
  const carga = useCarga(cargar);
  const c = carga.datos;
  return (
    <Dialog open onClose={onClose} title="Constancia de la solicitud" sub="Entrégasela impresa o díctale el folio: con él puede preguntar por su solicitud."
      footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<Printer />} disabled={!c} onClick={() => window.print()}>Imprimir</Button></>}>
      {carga.error ? <ErrorCarga titulo="No se pudo cargar la constancia" mensaje={carga.error} onReintentar={() => void carga.recargar()} />
        : !c ? <Skeleton h={160} />
        : (
          <div className="stack-sm" data-testid="constancia-arco">
            <p className="strong">{c.gym.tradeName} <span className="tiny muted">· {c.gym.legalName}</span></p>
            <dl className="kv">
              <dt>Folio</dt><dd><code>{c.folio}</code></dd>
              <dt>Titular</dt><dd>{c.member.fullName} · <code>{c.member.memberCode}</code></dd>
              <dt>Qué pide</dt><dd>{ARCO_KIND[c.request.kind] ?? c.request.kind}{c.request.consentType ? `: ${CONSENT_TYPE[c.request.consentType] ?? c.request.consentType}` : ''}</dd>
              <dt>Recibida</dt><dd>{fechaHora(c.request.receivedAt)} · {ARCO_CHANNEL[c.request.channel] ?? c.request.channel}</dd>
              <dt>Identidad</dt><dd>{c.request.identityVerifiedAt ? `Acreditada el ${fecha(c.request.identityVerifiedAt)}${c.request.identityNote ? ` (${c.request.identityNote})` : ''}` : 'Falta acreditarla: el plazo aún no corre'}</dd>
              <dt>Respuesta</dt><dd>{c.request.resolvedAt
                ? `${c.request.outcome === 'DENIED' ? 'No procede' : 'Procede'} · ${fecha(c.request.resolvedAt)}${c.request.resolution ? `: ${c.request.resolution}` : ''}`
                : c.request.identityVerifiedAt ? `A más tardar el ${fecha(c.request.dueAt)} (${c.deadlines.answerBusinessDays} días hábiles)` : `${c.deadlines.answerBusinessDays} días hábiles desde que se acredite la identidad`}</dd>
              {c.request.outcome === 'GRANTED' && <><dt>Queda hecho</dt><dd>{c.request.effectedAt ? `El ${fecha(c.request.effectedAt)}${c.request.effectNote ? `: ${c.request.effectNote}` : ''}` : `A más tardar el ${fecha(c.request.effectiveDueAt)} (${c.deadlines.effectBusinessDays} días hábiles)`}</dd></>}
            </dl>
            <p className="tiny muted">Constancia emitida el {fechaHora(c.issuedAt)}. La respuesta también se le avisa en su portal de socio.</p>
          </div>
        )}
    </Dialog>
  );
}

/**
 * Retirar un permiso desde la ficha (PS-07), con motivo y diciendo ANTES lo
 * que pasa: es el mismo acto que desde el portal, con los mismos efectos.
 */
export function RetirarConsentimientoDialog({ memberId, consentId, consentType, nombre, onClose, onHecho }: { memberId: string; consentId: string; consentType?: string; nombre: string; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO }, { obligatorios: ['motivo'] });
  async function retirar() {
    try {
      await api(`/members/${memberId}/consents/${consentId}/revoke`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', `Se retiró «${nombre}»`);
      onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo retirar')); }
  }
  const consecuencia = consentType ? CONSECUENCIA_DE_RETIRAR[consentType]?.personal : null;
  return (
    <Dialog open onClose={onClose} size="sm" title={`Retirar «${nombre}»`} sub="Queda la fecha del retiro; la firma original se conserva como evidencia."
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(retirar)}>Retirar</Button></>}>
      <div className="stack">
        {consecuencia && <Callout tone="warn" title="Lo que pasa al retirarlo">{consecuencia}</Callout>}
        <CampoMotivo id="ret-m" value={motivo} onChange={setMotivo} motivos={MOTIVOS_DE_PRIVACIDAD.retirarConsentimiento} error={f.error('motivo')} autoFocus />
      </div>
    </Dialog>
  );
}

/** «Leer»: el texto exacto que firmó, para enseñárselo en el mostrador (3-21). */
export function LeerFirmaDialog({ memberId, consentId, onClose }: { memberId: string; consentId: string; onClose: () => void }) {
  const cargar = useCallback(() => api<MemberConsentText>(`/members/${memberId}/consents/${consentId}`), [memberId, consentId]);
  const carga = useCarga(cargar);
  const c = carga.datos;
  return (
    <Dialog open onClose={onClose} size="lg" title={c ? CONSENT_TYPE[c.consentType] ?? c.consentType : 'Lo que firmó'} sub={c ? `Versión ${c.documentVersion} · firmado el ${fechaHora(c.grantedAt)}` : undefined}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      {carga.error ? <ErrorCarga titulo="No se pudo cargar el texto" mensaje={carga.error} onReintentar={() => void carga.recargar()} />
        : !c ? <Skeleton h={200} />
        : c.documentText ? <div className="doc doc-lectura">{c.documentText}</div>
        : <Callout tone="warn" title="Esta firma no guardó su texto">Se registró antes de que el gimnasio publicara ese texto. La versión firmada es la {c.documentVersion}.</Callout>}
    </Dialog>
  );
}
