'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus, Save, FileSignature, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { telefono } from '@/lib/format';
import { MEMBER_STATUS } from '@/lib/labels';
import { useSession, useToast, errorText, erroresPorCampo } from './session';
import { Badge, Button, Callout, CampoFecha, Dialog, ErrorCarga, Field, Segmented, Switch } from './ui';
import type { MemberSummary } from '@gymflow/core/contracts';
import { hoyEn } from '@/lib/zonas';
import { Coincidencias, useIdentidad } from './captacion/identidad';
import { ElegirResponsable, responsableElegido, SIN_ELEGIR, type Eleccion } from './altas/responsable';
import { CoachAlAlta } from './altas/coach-al-alta';

type Doc = { id: string; consentType: string; version: string; status: string; title: string };
type Texto = Doc & { bodyText: string };
type Candidato = { candidateId: string; score: number; explanation: string };
type Resumen = Pick<MemberSummary, 'id' | 'firstName' | 'lastName' | 'memberCode' | 'phoneE164' | 'status'>;

/** Los dos textos sin los que no hay socio (el backend los exige). */
const OBLIGATORIOS = ['PRIVACY_NOTICE', 'HOUSE_RULES'] as const;

type Datos = {
  firstName: string; lastName: string; phoneE164: string; email: string; birthDate: string;
  emergencyContactName: string; emergencyContactPhone: string;
};
const vacio: Datos = { firstName: '', lastName: '', phoneE164: '', email: '', birthDate: '', emergencyContactName: '', emergencyContactPhone: '' };

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
/**
 * Hoy en el GIMNASIO (AAAA-MM-DD), no en la computadora (bloque 2.4; pendiente
 * de 0.7): de madrugada, o con el equipo en otra zona, «ese mes todavía no
 * llega» y el máximo de «Socio desde» se decidían con otro día que el del servidor.
 */
function useHoy(): string {
  const { org } = useSession();
  return hoyEn(org.timezone);
}

/**
 * «¿DESDE CUÁNDO VIENE?» (2-01, ADR-029, D-11): parte de lo mínimo del alta.
 * Hoy, o «ya venía» con mes y año (cuenta desde el día 1). Es la antigüedad
 * que usan la pantalla de excepción y Retención; antes el mostrador no la
 * preguntaba y todo socio decía «socio desde hace 1 día».
 */
type Desde = { cuando: 'hoy' | 'antes'; mes: string; anio: string };
function desdeAJoinedAt(d: Desde): string | null {
  return d.cuando === 'antes' && d.mes && d.anio ? `${d.anio}-${d.mes}-01` : null;
}
function desdeListo(d: Desde, hoy: string): boolean {
  if (d.cuando === 'hoy') return true;
  if (!d.mes || !d.anio) return false;
  return `${d.anio}-${d.mes}` <= hoy.slice(0, 7);
}
function DesdeCuando({ d, set, error }: { d: Desde; set: (d: Desde) => void; error?: string | null }) {
  const hoy = useHoy();
  const anios = Array.from({ length: 41 }, (_, i) => String(Number(hoy.slice(0, 4)) - i));
  const futuro = d.cuando === 'antes' && !!d.mes && !!d.anio && !desdeListo(d, hoy);
  return (
    <>
      <p className="section-label mt-8">¿Desde cuándo viene?</p>
      <Segmented value={d.cuando} onChange={(cuando) => set({ ...d, cuando })}
        options={[{ value: 'hoy', label: 'Es nuevo: desde hoy' }, { value: 'antes', label: 'Ya venía' }]} />
      {d.cuando === 'antes' && (
        <div className="grid grid-2 gap-12">
          <Field label="Mes" htmlFor="sf-desde-mes" required error={error ?? (futuro ? 'Ese mes todavía no llega' : null)} hint="Mes y año bastan: cuenta desde el día 1.">
            <select id="sf-desde-mes" className="select" value={d.mes} onChange={(e) => set({ ...d, mes: e.target.value })} aria-invalid={!!error || futuro}>
              <option value="">Elige el mes…</option>
              {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
            </select>
          </Field>
          <Field label="Año" htmlFor="sf-desde-anio" required>
            <select id="sf-desde-anio" className="select" value={d.anio} onChange={(e) => set({ ...d, anio: e.target.value })}>
              <option value="">Elige el año…</option>
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
        </div>
      )}
    </>
  );
}

/**
 * Un campo que el servidor ocultó a quien edita (2.13): se ve que existe y que
 * no es para su puesto. No es un campo vacío: escribir ahí daba 403.
 */
function NoVisible({ id }: { id: string }) {
  return <input id={id} className="input" disabled readOnly value="" placeholder="No visible para tu puesto" data-testid="campo-no-visible" />;
}
const AVISO_NO_VISIBLE = 'Lo cambia el personal de su sucursal.';

/** Años cumplidos el día `hoy` (los dos `AAAA-MM-DD`). */
function edadEl(nacimiento: string, hoy: string): number {
  return Number(hoy.slice(0, 4)) - Number(nacimiento.slice(0, 4)) - (hoy.slice(5) < nacimiento.slice(5) ? 1 : 0);
}

function Campos({ d, set, errores = {}, limpiar, contactoOculto = false, minimo = false }: {
  d: Datos; set: (d: Datos) => void; errores?: Record<string, string>; limpiar?: (k: string) => void;
  /** El servidor ocultó teléfono, correo y contacto de emergencia (`hidden: ['contact']`): no se editan. */
  contactoOculto?: boolean;
  /**
   * ALTA MÍNIMA (D-11, bloque 3.4): con fila, solo nombre y un medio de
   * contacto. Nacimiento y contacto de emergencia quedan detrás de «Agregar más
   * datos»; lo que no se llene se completa después desde la ficha.
   */
  minimo?: boolean;
}) {
  const [mas, setMas] = useState(!minimo);
  // Si el servidor marcó un error en un campo que está plegado, se abre para que se vea.
  const hayErrorOculto = !!(errores.birthDate || errores.emergencyContactName || errores.emergencyContactPhone);
  const verMas = mas || hayErrorOculto;
  // Al corregir un campo, su error se va (UX5-G-03).
  const f = (k: keyof Datos) => (e: React.ChangeEvent<HTMLInputElement>) => { set({ ...d, [k]: e.target.value }); limpiar?.(k); };
  const err = (k: keyof Datos) => errores[k] ?? null;
  return (
    <>
      <div className="grid grid-2 gap-12">
        <Field error={err('firstName')} label="Nombre(s)" htmlFor="sf-fn" required><input id="sf-fn" className="input" autoFocus value={d.firstName} onChange={f('firstName')} aria-invalid={!!err('firstName')} /></Field>
        <Field error={err('lastName')} label="Apellidos" htmlFor="sf-ln" required><input id="sf-ln" className="input" value={d.lastName} onChange={f('lastName')} aria-invalid={!!err('lastName')} /></Field>
        {contactoOculto
          ? <>
              <Field label="Celular" htmlFor="sf-ph" hint={AVISO_NO_VISIBLE}><NoVisible id="sf-ph" /></Field>
              <Field label="Correo" htmlFor="sf-em"><NoVisible id="sf-em" /></Field>
            </>
          : <>
              <Field error={err('phoneE164')} label="Celular" htmlFor="sf-ph" hint="Celular o correo: al menos uno, para avisarle de sus pagos."><input id="sf-ph" className="input" inputMode="tel" placeholder="10 dígitos" value={d.phoneE164} onChange={f('phoneE164')} aria-invalid={!!err('phoneE164')} /></Field>
              <Field error={err('email')} label="Correo" htmlFor="sf-em"><input id="sf-em" className="input" type="email" value={d.email} onChange={f('email')} aria-invalid={!!err('email')} /></Field>
            </>}
        {verMas && <Field error={err('birthDate')} label="Nacimiento" htmlFor="sf-bd"><CampoFecha id="sf-bd" value={d.birthDate} onChange={(v) => { set({ ...d, birthDate: v }); limpiar?.('birthDate'); }} aria-invalid={!!err('birthDate')} /></Field>}
      </div>
      {!verMas && (
        <div className="mas-datos-fila">
          <button type="button" className="btn btn-ghost btn-sm" data-testid="mas-datos" onClick={() => setMas(true)}><Plus />Agregar más datos</button>
          <span className="hint"> Nacimiento y contacto de emergencia se pueden completar después, desde su ficha.</span>
        </div>
      )}
      {verMas && <p className="section-label mt-8">En caso de emergencia</p>}
      {verMas && <div className="grid grid-2 gap-12">
        {contactoOculto
          ? <>
              <Field label="Nombre" htmlFor="sf-en" hint={AVISO_NO_VISIBLE}><NoVisible id="sf-en" /></Field>
              <Field label="Teléfono" htmlFor="sf-ep"><NoVisible id="sf-ep" /></Field>
            </>
          : <>
              <Field error={err('emergencyContactName')} label="Nombre" htmlFor="sf-en"><input id="sf-en" className="input" value={d.emergencyContactName} onChange={f('emergencyContactName')} aria-invalid={!!err('emergencyContactName')} /></Field>
              <Field error={err('emergencyContactPhone')} label="Teléfono" htmlFor="sf-ep"><input id="sf-ep" className="input" inputMode="tel" value={d.emergencyContactPhone} onChange={f('emergencyContactPhone')} aria-invalid={!!err('emergencyContactPhone')} /></Field>
            </>}
      </div>}
    </>
  );
}

/**
 * ALTA EN EL MOSTRADOR — para quien no llenó el formulario en su teléfono.
 *
 * Los textos se muestran COMPLETOS y se guardan con la firma, igual que en el
 * alta digital: el canal queda como "asistido" y con el nombre de quien lo
 * atendió. Antes el único camino era llenar el formulario del socio en el
 * equipo de recepción, y la evidencia decía "desde su teléfono", que era falso.
 */
export function NuevoSocioDialog({ nombreInicial, contactoInicial: contactoSuelto, prospecto, onClose, onCreado }: {
  nombreInicial?: string; contactoInicial?: { phoneE164?: string | null; email?: string | null; firstName?: string; lastName?: string };
  /**
   * «Inscribir» desde un interesado (bloque 2.4): el alta nace con sus datos y
   * en SU sucursal (10-06), y el servidor lo convierte en la misma operación
   * que crea al socio (10-07): ya no hay una segunda llamada que falle en silencio.
   */
  prospecto?: { id: string; firstName: string; lastName: string; phoneE164: string | null; email: string | null; branchId: string; source: string | null };
  onClose: () => void; onCreado: (id: string) => void;
}) {
  const { branches, inScope, activoEn } = useSession();
  const router = useRouter();
  const toast = useToast();
  const hoy = useHoy();
  const contactoInicial = prospecto ?? contactoSuelto;
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [partes] = useState(() => (nombreInicial ?? '').trim().split(/\s+/));
  const [d, setD] = useState<Datos>({
    // Si ya se sabe cuál es el nombre y cuáles los apellidos (un prospecto), no se adivina partiendo en el primer espacio.
    ...vacio, firstName: contactoInicial?.firstName ?? partes[0] ?? '', lastName: contactoInicial?.lastName ?? partes.slice(1).join(' '),
    phoneE164: (contactoInicial?.phoneE164 ?? '').replace(/^\+52/, ''), email: contactoInicial?.email ?? '',
  });
  // El socio nace en la sede del interesado; quien ve varias la puede cambiar.
  const [sede, setSede] = useState((prospecto && sedes.some((b) => b.id === prospecto.branchId) ? prospecto.branchId : sedes[0]?.id) ?? '');
  const [textos, setTextos] = useState<Texto[] | null>(null);
  const [falloTextos, setFalloTextos] = useState<string | null>(null);
  const [intentoTextos, setIntentoTextos] = useState(0);
  // Un solo «acepto» para el aviso y el reglamento (D-11): cada texto se puede leer completo antes.
  const [aceptado, setAceptado] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  // D-09: su celular ya es el de otro socio; se comparte anotando quién responde por el número.
  const [responsable, setResponsable] = useState<Eleccion>(SIN_ELEGIR);
  // D-10: es menor y viene con su papá, mamá o tutor; la aceptación queda a nombre del tutor.
  const [tutor, setTutor] = useState({ nombre: '', telefono: '' });
  // D-11: el rostro, ahora o después. Solo se ofrece donde Biometría está encendida.
  const [rostro, setRostro] = useState<'despues' | 'ahora'>('despues');
  const [coach, setCoach] = useState('');
  const [duplicados, setDuplicados] = useState<Array<Candidato & { socio: Resumen | null }> | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reactivando, setReactivando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [desde, setDesde] = useState<Desde>({ cuando: 'hoy', mes: '', anio: '' });
  // ¿Ya existe? Un interesado en seguimiento o un alta digital por revisar (los socios los dice el alta al guardar).
  const { people } = useIdentidad({ firstName: d.firstName, lastName: d.lastName, phone: d.phoneE164, email: d.email });
  const otros = people.filter((p) => (p.kind === 'PROSPECT' || p.kind === 'INTAKE') && p.id !== prospecto?.id);
  // El mismo interesado, encontrado por su celular y su nombre: al dar de alta queda inscrito, sin pasar por su fila.
  const interesadoId = prospecto?.id ?? people.find((p) => p.kind === 'PROSPECT' && p.id && !p.sharedPhone && p.score >= 90)?.id ?? null;
  // Socios vivos con ese mismo celular que NO son esta persona (con 90 o más es la misma: eso lo detiene el alta).
  const comparten = people.filter((p) => p.kind === 'MEMBER' && !!p.phoneE164 && p.score < 90);
  const responsableListo = comparten.length > 0 ? responsableElegido(responsable) : null;
  const esMenor = !!d.birthDate && edadEl(d.birthDate, hoy) < 18;
  const conRostro = !!sede && activoEn('biometrics', sede);

  useEffect(() => {
    setFalloTextos(null); setTextos(null);
    (async () => {
      const { documents } = await api<{ documents: Doc[] }>('/consent-documents');
      const vigentes = OBLIGATORIOS.map((t) => documents.find((x) => x.consentType === t && x.status === 'PUBLISHED')).filter((x): x is Doc => !!x);
      setTextos(await Promise.all(vigentes.map((x) => api<Texto>(`/consent-documents/${x.id}`))));
    // Sin red no "faltan textos" (MC-16): se dice que no cargaron y se reintenta.
    })().catch((e) => setFalloTextos(errorText(e, 'No se pudieron cargar los textos')));
  }, [intentoTextos]);

  const faltanTextos = textos !== null && textos.length < OBLIGATORIOS.length;
  const listo = d.firstName.trim() && d.lastName.trim() && (d.phoneE164.trim() || d.email.trim()) && sede && desdeListo(desde, hoy)
    && textos && !faltanTextos && aceptado && (comparten.length === 0 || responsableListo);

  async function crear(force: boolean) {
    if (!textos) return;
    setEnviando(true);
    const joinedAt = desdeAJoinedAt(desde);
    try {
      // Con un interesado, el alta y su conversión son una sola operación en el servidor.
      const r = await api<{ id: string; memberCode: string }>(interesadoId ? `/prospects/${interesadoId}/enroll` : '/members', {
        method: 'POST',
        body: JSON.stringify({
          firstName: d.firstName.trim(), lastName: d.lastName.trim(),
          ...(d.phoneE164.trim() ? { phoneE164: d.phoneE164.trim() } : {}),
          ...(d.email.trim() ? { email: d.email.trim() } : {}),
          ...(d.birthDate ? { birthDate: d.birthDate } : {}),
          ...(d.emergencyContactName.trim() ? { emergencyContactName: d.emergencyContactName.trim() } : {}),
          ...(d.emergencyContactPhone.trim() ? { emergencyContactPhone: d.emergencyContactPhone.trim() } : {}),
          ...(joinedAt ? { joinedAt } : {}),
          homeBranchId: sede,
          consents: textos.map((t) => ({ consentType: t.consentType, documentVersion: t.version, documentText: t.bodyText, granted: true })),
          force,
          ...(responsableListo ? { responsible: responsableListo } : {}),
          ...(esMenor && tutor.nombre.trim().length >= 3 ? { guardian: { name: tutor.nombre.trim(), ...(tutor.telefono.trim() ? { phoneE164: tutor.telefono.trim() } : {}) } } : {}),
          // D-29: el coach que se elige al alta (después solo lo cambia la gerencia).
          ...(coach ? { coachUserId: coach } : {}),
        }),
      });
      toast('ok', `Socio dado de alta: ${r.memberCode}`);
      // «Registrar su rostro ahora» (D-11): directo al asistente de su ficha; «después» sigue a vender, como siempre.
      if (rostro === 'ahora' && conRostro) { onClose(); router.push(`/socios/${r.id}?tab=biometria&registrar=rostro`); }
      else onCreado(r.id);
    } catch (e) {
      const candidatos = e instanceof ApiError && e.status === 409 ? (e.data?.candidates as Candidato[] | undefined) : undefined;
      if (candidatos) {
        // Con nombre y código: recepción decide viendo a quién.
        const lista = await Promise.all(candidatos.map(async (c) => ({
          ...c, socio: await api<Resumen>(`/members/${c.candidateId}`).catch(() => null),
        })));
        setDuplicados(lista);
      } else {
        // El error va en el campo que falló; el aviso solo si no es de un campo.
        const porCampo = erroresPorCampo(e);
        setErrores(porCampo);
        if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo dar de alta'));
      }
    } finally { setEnviando(false); }
  }

  /** «Es esta persona»: ya era socio. El interesado se cierra ligado a esa ficha (10-07) y se abre la ficha. */
  async function yaEraSocio(memberId: string) {
    setReactivando(memberId);
    try {
      if (interesadoId) await api(`/prospects/${interesadoId}/convert`, { method: 'POST', body: JSON.stringify({ memberId }) });
      onCreado(memberId);
    } catch (e) {
      toast('error', errorText(e, 'No se pudo ligar al interesado con esa ficha'));
    } finally { setReactivando(null); }
  }

  async function reactivar(memberId: string) {
    setReactivando(memberId);
    try {
      await api(`/members/${memberId}/reactivate`, { method: 'POST', body: JSON.stringify({ reason: 'Regresó al gimnasio' }) });
      // Si venía como interesado, queda ligado a la ficha que se reactivó.
      if (interesadoId) await api(`/prospects/${interesadoId}/convert`, { method: 'POST', body: JSON.stringify({ memberId }) }).catch((e) => toast('error', errorText(e, 'La ficha se reactivó, pero el interesado sigue en seguimiento: ciérralo desde Prospectos')));
      toast('ok', 'Ficha reactivada: véndele una membresía para que pueda entrar');
      onCreado(memberId);
    } catch (e) {
      toast('error', errorText(e, 'No se pudo reactivar'));
    } finally { setReactivando(null); }
  }

  if (duplicados) {
    return (
      <Dialog open size="lg" onClose={onClose} title="¿Ya es socio?" sub="Encontramos fichas que podrían ser la misma persona. Crear otra la haría pagar dos veces o perder su antigüedad."
        footer={<><Button variant="secondary" onClick={() => setDuplicados(null)}>Volver</Button>
          <Button icon={<UserPlus />} loading={enviando} onClick={() => void crear(true)}>Es otra persona: crear</Button></>}>
        <ul className="list">
          {duplicados.map((c) => (
            <li key={c.candidateId} className="list-item">
              <div className="flex-1 min-w-0">
                <div className="strong">{c.socio ? `${c.socio.firstName} ${c.socio.lastName}` : 'Ficha'}</div>
                <div className="tiny muted">{c.socio ? <><code>{c.socio.memberCode}</code> · {telefono(c.socio.phoneE164)} · {MEMBER_STATUS[c.socio.status]?.label ?? c.socio.status}</> : null} · {c.explanation}</div>
              </div>
              <Badge tone={c.score >= 90 ? 'danger' : 'warn'}>{Math.round(c.score)}%</Badge>
              {c.socio?.status === 'ARCHIVED'
                // Un exsocio (PS-04): se reactiva su ficha, no se abre otra.
                ? <Button size="sm" variant="secondary" loading={reactivando === c.candidateId} onClick={() => void reactivar(c.candidateId)}>Reactivar su ficha</Button>
                : interesadoId
                  // Venía como interesado: se liga a esta ficha y deja de estar en seguimiento.
                  ? <Button size="sm" variant="secondary" loading={reactivando === c.candidateId} onClick={() => void yaEraSocio(c.candidateId)}>Es esta persona</Button>
                  : <Link className="btn btn-secondary btn-sm" href={`/socios/${c.candidateId}`}>Es esta persona</Link>}
            </li>
          ))}
        </ul>
      </Dialog>
    );
  }

  return (
    <Dialog open size="lg" onClose={onClose} title="Nuevo socio" sub="Para quien se registra en el mostrador. Si trae el formulario llenado desde su teléfono, apruébalo en Altas digitales."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={<UserPlus />} loading={enviando} disabled={!listo} onClick={() => void crear(false)}>Dar de alta</Button></>}>
      <div className="stack">
        {prospecto && (
          <p className="small muted" data-testid="viene-de-interesado">Viene de interesado{prospecto.source ? ` · ${prospecto.source}` : ''}. Al darlo de alta queda inscrito y sale de seguimiento.</p>
        )}
        <Campos minimo d={d} set={setD} errores={errores} limpiar={(k) => setErrores(({ [k]: _, ...resto }) => resto)} />
        {comparten.length > 0 && (
          <ElegirResponsable comparten={comparten} valor={responsable} onChange={setResponsable}
            quien={d.firstName.trim() ? `${d.firstName.trim()} (esta persona)` : 'Esta persona'} />
        )}
        {esMenor && (
          <div data-testid="tutor-mostrador">
            <p className="section-label mt-8">Es menor de edad</p>
            <div className="grid grid-2 gap-12">
              <Field label="Papá, mamá o tutor que lo acompaña" htmlFor="sf-tutor" error={errores['guardian.name'] ?? null} hint="Si viene con él, anótalo: la aceptación queda a su nombre.">
                <input id="sf-tutor" className="input" value={tutor.nombre} onChange={(e) => setTutor({ ...tutor, nombre: e.target.value })} />
              </Field>
              <Field label="Celular del tutor" htmlFor="sf-tutor-tel" error={errores['guardian.phoneE164'] ?? null}>
                <input id="sf-tutor-tel" className="input" inputMode="tel" placeholder="10 dígitos" value={tutor.telefono} onChange={(e) => setTutor({ ...tutor, telefono: e.target.value })} />
              </Field>
            </div>
          </div>
        )}
        {otros.length > 0 && (
          <div>
            <p className="label mb-8">¿Ya existe?</p>
            <Coincidencias people={otros} nuevaPestana />
            {otros.some((p) => p.kind === 'INTAKE') && <p className="hint mt-6">Si ya llenó el alta digital, apruébala en Altas: conserva lo que firmó desde su teléfono.</p>}
            {!prospecto && interesadoId && <p className="hint mt-6">Está en seguimiento como interesado: al darlo de alta queda inscrito.</p>}
          </div>
        )}
        <DesdeCuando d={desde} error={errores.joinedAt ?? null}
          set={(x) => { setDesde(x); setErrores(({ joinedAt: _, ...resto }) => resto); }} />
        {sedes.length > 1 && (
          <Field label="Sucursal de casa" htmlFor="sf-sede">
            <select id="sf-sede" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}

        <p className="section-label mt-8">Lo que acepta</p>
        {falloTextos ? <ErrorCarga mensaje={falloTextos} onReintentar={() => setIntentoTextos((x) => x + 1)} />
          : textos === null && <p className="small muted">Cargando textos…</p>}
        {faltanTextos && (
          <Callout tone="warn" title="Faltan textos publicados">
            Publica el aviso de privacidad y el reglamento en <strong>Textos de consentimiento</strong> para poder dar altas.
          </Callout>
        )}
        {textos?.map((t) => (
          <div key={t.id} className="card card-pad-sm">
            <div className="row-between">
              <span className="row small strong gap-8"><FileSignature size={16} />{t.title} <span className="tiny muted">v{t.version}</span></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto(abierto === t.id ? null : t.id)}>
                {abierto === t.id ? 'Ocultar' : 'Leer texto'}
              </button>
            </div>
            {abierto === t.id && <div className="doc-texto">{t.bodyText}</div>}
          </div>
        ))}
        {textos && !faltanTextos && (
          <Switch checked={aceptado} onChange={setAceptado}>
            {esMenor && tutor.nombre.trim().length >= 3
              ? <>Su tutor, {tutor.nombre.trim()}, leyó y acepta {textos.map((t) => t.title).join(' y ')}</>
              : <>El socio leyó y acepta {textos.map((t) => t.title).join(' y ')}</>}
          </Switch>
        )}

        {/* D-29: «Su coach» se elige al alta; si el gimnasio no tiene coaches, no se pregunta. */}
        <CoachAlAlta id="sf-coach" value={coach} onChange={setCoach} branchId={sede} />
        {conRostro && (
          <div data-testid="rostro-al-alta">
            <p className="section-label mt-8">Su rostro para entrar</p>
            <Segmented value={rostro} onChange={setRostro} etiqueta="Registrar su rostro"
              options={[{ value: 'despues', label: 'Después' }, { value: 'ahora', label: 'Registrarlo ahora' }]} />
            <p className="hint mt-6">{rostro === 'ahora' ? 'Al dar de alta se abre el registro de su rostro; su membresía se vende después, desde su ficha.' : 'Queda como pendiente en su ficha, en «Para terminar su alta».'}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Corregir datos: teléfono mal capturado, emergencia nueva y, si la ficha trae
 * la antigüedad, «socio desde» con su motivo (2-01): decide la pantalla de
 * excepción y Retención, así que el cambio pide por qué y queda en la bitácora.
 */
export function EditarSocioDialog({ socio, onClose, onGuardado }: {
  socio: {
    id: string; firstName: string; lastName: string; phoneE164: string | null; email: string | null; birthDate: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; joinedAt?: string | null;
    /** Lo que el servidor ocultó a quien edita (`MemberSummary.hidden`). */
    hidden?: MemberSummary['hidden'];
  };
  onClose: () => void; onGuardado: () => void;
}) {
  const toast = useToast();
  // «Oculto por permiso» no es «no tiene» (2.13): lo que no se ve no se edita ni se manda.
  const contactoOculto = socio.hidden?.includes('contact') ?? false;
  const sinLada = (t: string | null) => (t ?? '').replace(/^\+52/, '');
  const [d, setD] = useState<Datos>({
    firstName: socio.firstName, lastName: socio.lastName,
    phoneE164: sinLada(socio.phoneE164), email: socio.email ?? '', birthDate: socio.birthDate ?? '',
    emergencyContactName: socio.emergencyContactName ?? '', emergencyContactPhone: sinLada(socio.emergencyContactPhone),
  });
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const { org } = useSession();
  const hoy = useHoy();
  // El día de su antigüedad, también en la zona del gimnasio.
  const desdeAntes = socio.joinedAt ? hoyEn(org.timezone, new Date(socio.joinedAt)) : '';
  const [desde, setDesde] = useState(desdeAntes);
  const [motivoDesde, setMotivoDesde] = useState('');
  const cambiaDesde = !!desdeAntes && !!desde && desde !== desdeAntes;

  async function guardar() {
    setEnviando(true);
    try {
      await api(`/members/${socio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: d.firstName.trim(), lastName: d.lastName.trim(),
          birthDate: d.birthDate || null,
          ...(contactoOculto ? {} : {
            phoneE164: d.phoneE164.trim() || null, email: d.email.trim() || null,
            emergencyContactName: d.emergencyContactName.trim() || null,
            emergencyContactPhone: d.emergencyContactPhone.trim() || null,
          }),
          // Solo si cambió: guardar sin tocarla no pide motivo.
          ...(cambiaDesde ? { joinedAt: desde, reason: motivoDesde.trim() } : {}),
        }),
      });
      toast('ok', 'Datos actualizados');
      onGuardado();
    } catch (e) {
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo guardar'));
    } finally { setEnviando(false); }
  }

  return (
    <Dialog open size="lg" onClose={onClose} title="Editar datos" sub="El cambio queda en la bitácora con el antes y el después."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={<Save />} loading={enviando} disabled={!d.firstName.trim() || !d.lastName.trim() || (cambiaDesde && (motivoDesde.trim().length < 3 || desde > hoy))} onClick={() => void guardar()}>Guardar</Button></>}>
      <div className="stack">
        <Campos d={d} set={setD} errores={errores} limpiar={(k) => setErrores(({ [k]: _, ...resto }) => resto)} contactoOculto={contactoOculto} />
        {desdeAntes && (
          <>
            <p className="section-label mt-8">Antigüedad</p>
            <div className="grid grid-2 gap-12">
              <Field label="Socio desde" htmlFor="sf-desde" error={errores.joinedAt ?? (desde > hoy ? 'No puede ser una fecha futura' : null)} hint="Se corrige con motivo y queda en la bitácora.">
                <CampoFecha id="sf-desde" max={hoy} value={desde}
                  onChange={(v) => { setDesde(v); setErrores(({ joinedAt: _, ...resto }) => resto); }} aria-invalid={!!errores.joinedAt || desde > hoy} />
              </Field>
              {cambiaDesde && (
                <Field label="Motivo del cambio" htmlFor="sf-desde-motivo" required error={errores.reason ?? null}>
                  <input id="sf-desde-motivo" className="input" value={motivoDesde} placeholder="Venía desde antes; se capturó mal"
                    onChange={(e) => { setMotivoDesde(e.target.value); setErrores(({ reason: _, ...resto }) => resto); }} aria-invalid={!!errores.reason} />
                </Field>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
