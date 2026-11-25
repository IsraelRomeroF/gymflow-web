'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, UserMinus, ShieldOff, ShieldCheck, ScanFace } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';
import { useSession, useToast, errorText } from './session';
import type { MemberPrivacyRequests, PrivacyBatch, PrivacyBatchSigned, PrivacyBatchSummary, PrivacyConservation, PrivacySettings } from '@gymflow/core/contracts';
import {
  CONSERVACION, ESTADO_DE_LISTA_DE_CONSERVACION, ESTADO_DE_RENGLON_DE_CONSERVACION, MOTIVOS_DE_PRIVACIDAD, MOTIVOS_PARA_SACAR_DE_LA_LISTA,
} from '@gymflow/core/privacidad';
import { Badge, Button, Callout, Card, CampoMotivo, Dialog, ErrorCarga, Field, IconTile, Skeleton, faltaMotivo } from './ui';
import { AutorizacionDialog, textoDeErrorDeFirma } from './autorizacion';
import { AdeudoAlCerrar } from './ficha/adeudo';

type Socio = { id: string; memberCode: string; firstName: string; status: string; homeBranchId: string | null; anonymizedAt?: string | null };
type Accion = 'exportar' | 'baja' | 'anonimizar';

/**
 * Datos personales del socio (LFPDPPP): entregarle todo lo que se guarda de
 * él (acceso), darlo de baja y, ya de baja, anonimizarlo (cancelación). Lo
 * contable se conserva siempre: lo exige la ley fiscal.
 */
export function PrivacidadCard({ socio, onDone }: { socio: Socio; onDone: () => void }) {
  const { can } = useSession();
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const baja = socio.status === 'ARCHIVED';
  const anonimo = !!socio.anonymizedAt;
  const acciones = [
    can('members:export') && !anonimo && 'exportar',
    can('members:archive') && !baja && 'baja',
    can('members:anonymize') && baja && !anonimo && 'anonimizar',
  ].filter(Boolean) as Accion[];
  if (acciones.length === 0) return null;

  return (
    <Card title="Datos personales y baja" sub="Derechos ARCO del socio. Lo contable se conserva siempre.">
      <div className="row wrap gap-8">
        {acciones.includes('exportar') && <Button size="sm" variant="secondary" icon={<Download />} onClick={() => setAbierta('exportar')}>Descargar sus datos</Button>}
        {acciones.includes('baja') && <Button size="sm" variant="ghost" icon={<UserMinus />} onClick={() => setAbierta('baja')}>Dar de baja</Button>}
        {acciones.includes('anonimizar') && <Button size="sm" variant="danger-ghost" icon={<ShieldOff />} onClick={() => setAbierta('anonimizar')}>Anonimizar</Button>}
      </div>
      {abierta && <AccionDialog socio={socio} accion={abierta} onClose={() => setAbierta(null)} onListo={() => { setAbierta(null); onDone(); }} />}
    </Card>
  );
}

const TEXTO: Record<Accion, { titulo: string; sub: string; boton: string; placeholder: string }> = {
  exportar: {
    titulo: 'Descargar sus datos', boton: 'Descargar',
    sub: 'Un archivo de datos (JSON) con su ficha, firmas, membresías, cobros, visitas, clases y rutinas, para entregárselo; sus notas de salud, solo si tú puedes verlas. La plantilla de su rostro no va en el archivo: se dice dónde se guarda. Queda registrado quién lo descargó.',
    placeholder: 'Lo pidió por escrito en recepción',
  },
  baja: {
    titulo: 'Dar de baja', boton: 'Dar de baja',
    sub: 'Deja de ser socio: su portal, sus credenciales y su rostro dejan de servir en el acto, y sus membresías se cancelan al cierre del día. Su historia se conserva.',
    placeholder: 'Se mudó de ciudad',
  },
  anonimizar: {
    titulo: 'Anonimizar', boton: 'Pedir autorización',
    sub: 'Se borran su nombre, teléfono, correo, notas y salud; se revoca su biometría y la plantilla de su rostro se borra en el acto. No se puede deshacer.',
    placeholder: 'Solicitud de cancelación ARCO por escrito',
  },
};

function AccionDialog({ socio, accion, onClose, onListo }: { socio: Socio; accion: Accion; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const t = TEXTO[accion];

  /** La solicitud de acceso que procede y falta entregar: la descarga la cierra (1.10, 21-03). */
  async function accesoPendiente(): Promise<string | null> {
    if (!can('members:consent:read')) return null;
    try {
      const { requests } = await api<MemberPrivacyRequests>(`/members/${socio.id}/privacy-requests`);
      return requests.find((r) => r.kind === 'ACCESS' && r.status === 'EFFECT_PENDING')?.id ?? null;
    } catch { return null; /* sin la lista, la descarga sigue; la solicitud se marca a mano */ }
  }

  async function ejecutar(approvalToken?: string) {
    setEnviando(true);
    try {
      if (accion === 'exportar') {
        const solicitud = await accesoPendiente();
        const datos = await api<unknown>(`/members/${socio.id}/export?reason=${encodeURIComponent(motivo.trim())}${solicitud ? `&requestId=${solicitud}` : ''}`);
        const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = `datos-${socio.memberCode}.json`; a.click();
        URL.revokeObjectURL(url);
        toast('ok', solicitud ? 'Archivo descargado: su solicitud de acceso quedó hecha' : 'Archivo descargado');
      } else if (accion === 'baja') {
        await api(`/members/${socio.id}/archive`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
        toast('ok', `${socio.firstName} quedó dado de baja`);
      } else {
        await api(`/members/${socio.id}/anonymize`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim(), approvalToken }) });
        toast('ok', 'Socio anonimizado');
      }
      onListo();
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      else toast('error', errorText(e, 'No se pudo'));
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open onClose={onClose} title={t.titulo} sub={t.sub}
        footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant={accion === 'exportar' ? 'primary' : 'danger'} loading={enviando} disabled={motivo.trim().length < 3}
            onClick={() => (accion === 'anonimizar' ? setAutorizando(true) : void ejecutar())}>{t.boton}</Button></>}>
        <div className="stack">
          {accion === 'anonimizar' && <Callout tone="warn">Los cargos, pagos y asistencias se quedan con su código de socio, que ya no dirá quién es.</Callout>}
          {/* Lo que hace la baja con su deuda (D-12, bloque 3.5; edición puntual): ya no se anula nada. Se ve, y se cobra, se deja o se perdona con monto. */}
          {accion === 'baja' && <AdeudoAlCerrar memberId={socio.id} branchId={socio.homeBranchId} al="darlo de baja" />}
          <CampoMotivo id="arco-mot" autoFocus value={motivo} onChange={setMotivo} placeholder={accion === 'exportar' ? undefined : t.placeholder}
            motivos={accion === 'exportar' ? MOTIVOS_DE_PRIVACIDAD.descargarDatos : undefined} />
        </div>
      </Dialog>
      {autorizando && (
        <AutorizacionDialog permission="members:anonymize" branchId={socio.homeBranchId} operacion={{ resourceId: socio.id }} motivo={motivo} titulo="Autorizar la anonimización"
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void ejecutar(token); }} />
      )}
    </>
  );
}

// ── Conservación (D-32; bloque 3.9) ─────────────────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** `2026-11` → «noviembre de 2026». */
const mesDe = (periodo: string) => `${MESES[Number(periodo.slice(5, 7)) - 1] ?? periodo} de ${periodo.slice(0, 4)}`;
const personas = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** Los renglones que se pintan de una vez; el resto se cuenta. */
const RENGLONES_A_LA_VISTA = 50;

/**
 * CONSERVACIÓN DE DATOS (D-32): cuánto se guarda de quien se va.
 *
 *  · el rostro deja de reconocerse el día de la baja y se borra a los 30 días;
 *  · lo demás se anonimiza a los 24 meses (o el plazo del gimnasio), pero solo
 *    cuando el dueño firma la lista del mes. La gerencia puede sacar a alguien
 *    de la lista con un motivo; la lista no borra nada por sí sola.
 *
 * La ve la gerencia (ajusta el plazo y revisa la lista) y quien da la segunda
 * firma (la firma). Reemplaza a «Plazo de supresión de exsocios».
 */
export function Conservacion() {
  const { can } = useSession();
  const ve = can('members:anonymize') || can('approvals:grant');
  const carga = useCarga(ve ? cargarConservacion : null);
  if (!ve) return null;
  const c = carga.datos;
  const recargar = () => { void carga.recargar(); };

  return (
    <Card pad={false} title="Conservación de datos" data-testid="conservacion"
      sub="Cuánto se guarda de quien se da de baja. Lo contable (pagos y recibos) se conserva siempre.">
      {carga.error ? <div className="card-body"><ErrorCarga titulo="No se pudo consultar la conservación de datos" mensaje={carga.error} onReintentar={recargar} /></div>
        : !c ? <div className="card-body"><Skeleton h={120} /></div>
        : (
          <>
            <div className="card-body stack">
              <Plazos c={c} onGuardado={recargar} />
              <Rostros c={c} />
            </div>
            <ListaDelMes c={c} onCambio={recargar} />
            {c.history.length > 0 && <Historia listas={c.history} />}
          </>
        )}
    </Card>
  );
}

/**
 * LA LISTA POR FIRMAR, para quien firma (la dueña): sale en Autorizaciones
 * solo cuando hay una lista en espera con alguien dentro. Sin lista, nada.
 */
export function ListaPorFirmar() {
  const { can } = useSession();
  const firma = can('approvals:grant');
  const carga = useCarga(firma ? cargarConservacion : null);
  const c = carga.datos;
  if (!firma || !c?.batch || c.batch.counts.listed === 0) return null;
  return (
    <div className="mb-20">
      <Card pad={false} title="Lista de exsocios por anonimizar" data-testid="lista-por-firmar"
        sub={`Se arma una vez al mes con quien lleva ${c.batch.monthsAfterArchive} meses de baja. Nada se borra sin tu firma.`}>
        {/* 3.14: aquí la lista es lo primero de la tarjeta; su aviso no va pegado a la cabecera. */}
        <div className="lista-por-firmar-cuerpo"><ListaDelMes c={c} onCambio={() => { void carga.recargar(); }} /></div>
      </Card>
    </div>
  );
}

const cargarConservacion = () => api<PrivacyConservation>('/privacy/conservation');

function Plazos({ c, onGuardado }: { c: PrivacyConservation; onGuardado: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [meses, setMeses] = useState(String(c.monthsAfterArchive));
  const [enviando, setEnviando] = useState(false);
  const n = Number(meses);
  const valido = meses.trim() !== '' && Number.isInteger(n) && n >= CONSERVACION.mesesMinimos && n <= CONSERVACION.mesesMaximos;

  async function guardar(valor: number | null) {
    setEnviando(true);
    try {
      const r = await api<PrivacySettings>('/privacy/settings', { method: 'PUT', body: JSON.stringify({ monthsAfterArchive: valor }) });
      setMeses(String(r.effectiveMonths));
      toast('ok', `Plazo guardado: ${r.effectiveMonths} meses después de la baja`);
      onGuardado();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar el plazo')); } finally { setEnviando(false); }
  }

  return (
    <div className="stack-sm">
      <p className="small">
        Los datos personales de un exsocio se anonimizan <strong>{c.monthsAfterArchive} meses después de su baja</strong>
        {c.monthsIsDefault ? ' (el plazo de GymFlow; puedes fijar otro)' : ' (el plazo que fijó este gimnasio)'}.
        Cada mes se arma una lista con quienes ya lo cumplieron y el dueño la firma una sola vez: sin esa firma no se anonimiza a nadie.
      </p>
      {can('settings:org') && (
        <div className="row wrap gap-8 conservacion-plazo">
          <Field label="Meses después de la baja" htmlFor="con-meses" hint={`De ${CONSERVACION.mesesMinimos} a ${CONSERVACION.mesesMaximos}. Sin plazo propio rigen ${CONSERVACION.mesesTrasLaBaja}.`}>
            <input id="con-meses" className="input num" inputMode="numeric" value={meses} onChange={(e) => setMeses(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </Field>
          <Button variant="secondary" loading={enviando} disabled={!valido || (n === c.monthsAfterArchive && !c.monthsIsDefault)} onClick={() => void guardar(n)}>Guardar plazo</Button>
          {!c.monthsIsDefault && <Button variant="ghost" disabled={enviando} onClick={() => void guardar(null)}>Volver a {CONSERVACION.mesesTrasLaBaja} meses</Button>}
        </div>
      )}
    </div>
  );
}

function Rostros({ c }: { c: PrivacyConservation }) {
  return (
    <div className="row gap-8">
      <IconTile tone={c.faces.waiting > 0 ? 'warn' : 'neutral'}><ScanFace /></IconTile>
      <p className="small flex-1 min-w-0">
        El rostro de quien se da de baja <strong>deja de reconocerse ese mismo día</strong> y se borra a los {c.faceDaysAfterArchive} días si no regresa; si regresa antes, vuelve a reconocerse sin registrarlo otra vez.{' '}
        {c.faces.waiting === 0 ? 'Hoy no hay rostros de exsocios guardados.'
          : c.faces.nextDeletionOn
            ? `Hoy hay ${personas(c.faces.waiting, 'rostro de exsocio guardado', 'rostros de exsocios guardados')}; el próximo se borra el ${fecha(c.faces.nextDeletionOn)}.`
            : `Hoy hay ${personas(c.faces.waiting, 'rostro de exsocio guardado', 'rostros de exsocios guardados')}; los ${c.faceDaysAfterArchive} días empiezan a contar con el próximo cierre del día.`}
        {c.startedOn && c.faces.waiting > 0 && ` A quien ya estaba de baja el ${fecha(c.startedOn)}, los ${c.faceDaysAfterArchive} días le cuentan desde ese día.`}
      </p>
    </div>
  );
}

function ListaDelMes({ c, onCambio }: { c: PrivacyConservation; onCambio: () => void }) {
  const toast = useToast();
  const [firmando, setFirmando] = useState(false);
  const [sacando, setSacando] = useState<PrivacyBatch['items'][number] | null>(null);
  const [todos, setTodos] = useState(false);
  const lista = c.batch;
  if (!lista) {
    return <p className="card-body small muted pt-0" data-testid="conservacion-sin-lista">No hay lista en espera de firma: nadie más ha cumplido el plazo desde la última.</p>;
  }
  const enLista = lista.items.filter((i) => i.status === 'LISTED');
  const fuera = lista.items.filter((i) => i.status === 'EXCLUDED');
  const visibles = todos ? enLista : enLista.slice(0, RENGLONES_A_LA_VISTA);

  return (
    <div data-testid="conservacion-lista">
      <div className="card-body stack-sm pt-0">
        <Callout tone="warn" title={`Lista de ${mesDe(lista.period)}: ${personas(enLista.length, 'exsocio por anonimizar', 'exsocios por anonimizar')}`}>
          Se dieron de baja el {fecha(lista.cutoffOn)} o antes ({lista.monthsAfterArchive} meses). Al firmarla se borran su nombre, teléfono, correo, notas y salud, y su rostro si seguía guardado. No se puede deshacer. Sus pagos y recibos se conservan con su código de socio.
          {c.canSign ? '' : ' La firma el dueño, una sola vez; mientras no la firme, no se anonimiza a nadie.'}
        </Callout>
        {c.canSign && (
          <div className="row wrap gap-8">
            <Button variant="danger" icon={<ShieldCheck />} disabled={enLista.length === 0} onClick={() => setFirmando(true)} data-testid="conservacion-firmar">
              Firmar la lista de {mesDe(lista.period)}
            </Button>
            {enLista.length === 0 && <span className="small muted">No queda nadie en la lista.</span>}
          </div>
        )}
      </div>
      <ul className="list">
        {visibles.map((i) => (
          <li key={i.memberId} className="list-item">
            <IconTile tone="warn"><UserMinus /></IconTile>
            <div className="flex-1 min-w-0">
              {c.canExclude ? <Link href={`/socios/${i.memberId}`} className="strong small">{i.fullName ?? i.memberCode}</Link> : <span className="strong small">{i.fullName ?? i.memberCode}</span>}{' '}
              <span className="tiny muted"><code>{i.memberCode}</code> · baja el {fecha(i.archivedOn)}</span>
            </div>
            {c.canExclude && <Button size="sm" variant="ghost" onClick={() => setSacando(i)}>Sacar de la lista</Button>}
          </li>
        ))}
        {fuera.map((i) => (
          <li key={i.memberId} className="list-item">
            <IconTile tone="neutral"><UserMinus /></IconTile>
            <div className="flex-1 min-w-0">
              <span className="small">{i.fullName ?? i.memberCode}</span>{' '}
              <span className="tiny muted"><code>{i.memberCode}</code> · {ESTADO_DE_RENGLON_DE_CONSERVACION.EXCLUDED.toLowerCase()}: {i.note}</span>
            </div>
          </li>
        ))}
      </ul>
      {enLista.length > visibles.length && (
        <div className="card-body"><Button size="sm" variant="ghost" onClick={() => setTodos(true)}>Ver los {enLista.length - visibles.length} que faltan</Button></div>
      )}
      {firmando && (
        <FirmarLista lista={lista} cuantos={enLista.length} onClose={() => setFirmando(false)}
          onListo={(firmada) => {
            setFirmando(false);
            const faltan = firmada.counts.listed;
            toast('ok', `Lista firmada: ${personas(firmada.counts.anonymized, 'exsocio anonimizado', 'exsocios anonimizados')}${firmada.counts.skipped ? `, ${firmada.counts.skipped} sin tocar (regresaron o ya no cumplen)` : ''}${faltan ? `; ${faltan} se terminan con el cierre de esta noche` : ''}`);
            onCambio();
          }} />
      )}
      {sacando && <SacarDeLaLista lista={lista} renglon={sacando} onClose={() => setSacando(null)} onListo={() => { setSacando(null); onCambio(); }} />}
    </div>
  );
}

function FirmarLista({ lista, cuantos, onClose, onListo }: { lista: PrivacyBatch; cuantos: number; onClose: () => void; onListo: (firmada: PrivacyBatch) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (!password) return;
    setEnviando(true); setError(null);
    try {
      const r = await api<PrivacyBatchSigned>('/privacy/conservation/sign', { method: 'POST', body: JSON.stringify({ batchId: lista.id, password }) });
      onListo(r.batch);
    } catch (e) {
      setError(textoDeErrorDeFirma(e, 'No se pudo firmar la lista'));
    } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Firmar la lista de ${mesDe(lista.period)}`} error={error}
      sub={`${personas(cuantos, 'exsocio se anonimiza', 'exsocios se anonimizan')} con esta firma. No se puede deshacer.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={<ShieldCheck />} loading={enviando} disabled={!password} onClick={() => void enviar()}>Firmar y anonimizar</Button></>}>
      <form className="stack" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <p className="small muted">Confirma que eres tú: la firma queda en la bitácora con tu nombre y vale solo para esta lista. A quien haya regresado al gimnasio desde que se armó no se le toca.</p>
        <Field label="Tu contraseña" htmlFor="con-pw">
          <input id="con-pw" className="input" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function SacarDeLaLista({ lista, renglon, onClose, onListo }: { lista: PrivacyBatch; renglon: PrivacyBatch['items'][number]; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setEnviando(true); setError(null);
    try {
      await api('/privacy/conservation/exclude', { method: 'POST', body: JSON.stringify({ batchId: lista.id, memberId: renglon.memberId, reason: motivo.trim() }) });
      toast('ok', `${renglon.fullName ?? renglon.memberCode} salió de la lista de ${mesDe(lista.period)}`);
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo sacar de la lista')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} size="sm" title={`Sacar de la lista · ${renglon.fullName ?? renglon.memberCode}`} error={error}
      sub="No se anonimiza con esta lista. Sigue dado de baja y volverá a salir en la del mes siguiente."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} disabled={faltaMotivo(motivo)} onClick={() => void enviar()}>Sacar de la lista</Button></>}>
      <CampoMotivo id="con-mot" autoFocus value={motivo} onChange={setMotivo} motivos={MOTIVOS_PARA_SACAR_DE_LA_LISTA} />
    </Dialog>
  );
}

function Historia({ listas }: { listas: PrivacyBatchSummary[] }) {
  return (
    <div data-testid="conservacion-historia">
      <p className="card-body tiny muted pt-0">Listas anteriores</p>
      <ul className="list">
        {listas.map((l) => (
          <li key={l.id} className="list-item">
            <div className="flex-1 min-w-0">
              <span className="strong small">{mesDe(l.period)}</span>{' '}
              <span className="tiny muted">
                {l.status === 'SIGNED'
                  ? `${personas(l.counts.anonymized, 'anonimizado', 'anonimizados')}${l.counts.excluded ? ` · ${l.counts.excluded} fuera de la lista` : ''}${l.counts.skipped ? ` · ${l.counts.skipped} sin tocar` : ''}${l.counts.listed ? ` · ${l.counts.listed} por terminar esta noche` : ''} · firmó ${l.signedByName ?? 'el dueño'} el ${fecha(l.signedAt)}`
                  : 'Nadie la firmó: no se anonimizó a nadie'}
              </span>
            </div>
            <Badge tone={l.status === 'SIGNED' ? 'ok' : 'neutral'}>{ESTADO_DE_LISTA_DE_CONSERVACION[l.status]}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
