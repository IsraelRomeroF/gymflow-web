'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Save, Users } from 'lucide-react';
import type { IdentityCheck, MemberCompleted, MemberSharedPhone } from '@gymflow/core/contracts';
import { CAMPO } from '@gymflow/core/vocabulario';
import { api, ApiError } from '@/lib/api';
import { fechaHora, telefono } from '@/lib/format';
import { useCarga } from '@/lib/carga';
import { useToast, errorText, erroresPorCampo } from '@/components/session';
import { Badge, Button, CampoFecha, Dialog, Field, Opciones } from '@/components/ui';

/**
 * EL RESPONSABLE (auditoría 8, fase 3, bloque 3.4; D-09, D-10 y D-11).
 *
 * Dos socios pueden tener el mismo celular (mamá e hija, hermanos). Lo que se
 * pide es anotar quién responde por ese número: uno de los socios que lo
 * comparten, la persona misma o un adulto que no es socio. Aquí viven el
 * selector (lo usan «Nuevo socio» y la bandeja de altas), el renglón de la
 * ficha «Comparte celular con…» y el diálogo «Completar datos», con el que
 * recepción llena lo que el alta mínima dejó vacío sin cambiar lo capturado.
 */

/** Lo que viaja a la API (`responsibleSchema` del backend). */
export type Responsable = { kind: 'SELF' } | { kind: 'MEMBER'; memberId: string } | { kind: 'ADULT'; name: string; phoneE164?: string };

/** Lo elegido en pantalla: `quien` es `'SELF'`, `'ADULT'` o el id del socio. */
export type Eleccion = { quien: string | null; nombre: string; telefono: string };
export const SIN_ELEGIR: Eleccion = { quien: null, nombre: '', telefono: '' };

/** La elección lista para mandarse, o `null` si todavía falta algo. */
export function responsableElegido(e: Eleccion): Responsable | null {
  if (!e.quien) return null;
  if (e.quien === 'SELF') return { kind: 'SELF' };
  if (e.quien === 'ADULT') {
    if (e.nombre.trim().length < 3) return null;
    return { kind: 'ADULT', name: e.nombre.trim(), ...(e.telefono.trim() ? { phoneE164: e.telefono.trim() } : {}) };
  }
  return { kind: 'MEMBER', memberId: e.quien };
}

export function ElegirResponsable({ comparten, valor, onChange, quien = 'Esta persona', error }: {
  /** Los socios que ya tienen ese celular (los que quien mira puede abrir). */
  comparten: ReadonlyArray<{ id: string | null; fullName: string; memberCode: string | null }>;
  valor: Eleccion; onChange: (e: Eleccion) => void;
  /** Cómo se llama en la lista a la persona de la ficha o del alta. */
  quien?: string; error?: string | null;
}) {
  const socios = comparten.filter((c): c is { id: string; fullName: string; memberCode: string | null } => !!c.id);
  const nombres = comparten.map((c) => `${c.fullName}${c.memberCode ? ` (${c.memberCode})` : ''}`).join(' y ');
  return (
    <div className="responsable" data-testid="elegir-responsable">
      <p className="small"><Badge tone="warn">Comparte celular</Badge> Ese celular ya es el de <strong>{nombres}</strong>. Pueden compartirlo: cada quien conserva su ficha, su código y sus pagos.</p>
      <p className="label mt-8" id="resp-rotulo">¿Quién responde por ese número? <span aria-hidden className="req">*</span></p>
      <Opciones forma="chips" etiquetadaPor="resp-rotulo" value={valor.quien}
        onChange={(q) => onChange({ ...valor, quien: q })}
        opciones={[
          ...socios.map((s) => ({ value: s.id, label: s.fullName })),
          { value: 'SELF', label: quien },
          { value: 'ADULT', label: 'Otro adulto' },
        ]} />
      {valor.quien === 'ADULT' && (
        <div className="grid grid-2 gap-12 mt-8">
          <Field label="Nombre del adulto responsable" htmlFor="resp-nombre" required>
            <input id="resp-nombre" className="input" value={valor.nombre} onChange={(e) => onChange({ ...valor, nombre: e.target.value })} />
          </Field>
          <Field label="Su teléfono, si es otro" htmlFor="resp-tel" hint="Vacío si es el mismo número que comparten.">
            <input id="resp-tel" className="input" inputMode="tel" placeholder="10 dígitos" value={valor.telefono} onChange={(e) => onChange({ ...valor, telefono: e.target.value })} />
          </Field>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="hint mt-6">A esa persona se le cobra y se le avisa por ese celular.</p>
    </div>
  );
}

/** Qué le falta a la ficha de lo que el alta mínima dejó para después (D-11). */
type Vacios = { phoneE164: boolean; email: boolean; birthDate: boolean; emergencyContactName: boolean; emergencyContactPhone: boolean };

/**
 * EL RENGLÓN DE LA FICHA: «Comparte celular con…», quién responde por el
 * número y, si es menor, quién firmó como su tutor. No pinta nada si el socio
 * no comparte celular ni tiene responsable. `puedeEditar`: gerencia cambia al
 * responsable; recepción solo lo anota cuando falta.
 */
export function CelularCompartido({ memberId, nombre, vacios, puedeEditar, puedeCompletar, onCambio }: {
  memberId: string; nombre: string;
  /** Con esto se ofrece «Completar datos» (D-11) a quien da de alta. */
  vacios?: Vacios; puedeEditar: boolean; puedeCompletar: boolean; onCambio?: () => void;
}) {
  const cargar = useCallback(() => api<MemberSharedPhone>(`/members/${memberId}/shared-phone`), [memberId]);
  const carga = useCarga(cargar);
  const [anotar, setAnotar] = useState(false);
  const [completar, setCompletar] = useState(false);
  const c = carga.datos;
  const faltan = vacios ? (Object.keys(vacios) as Array<keyof Vacios>).filter((k) => vacios[k] && !(k === 'email' && !vacios.phoneE164) && !(k === 'phoneE164' && !vacios.email)) : [];
  const hayCompartido = !!c && !c.hidden && (c.sharedWith.length > 0 || !!c.responsible);
  if (!hayCompartido && (faltan.length === 0 || !puedeCompletar)) return null;
  const r = c?.responsible ?? null;
  const cerrar = () => { setAnotar(false); setCompletar(false); carga.recargar(); onCambio?.(); };
  return (
    <div className="celular-compartido" data-testid="celular-compartido">
      {hayCompartido && c && (
        <p className="small">
          <Users size={14} aria-hidden />{' '}
          {c.sharedWith.length > 0 && <>Comparte celular con {c.sharedWith.map((s, i) => (
            <span key={s.id}>{i > 0 ? ' y ' : ''}<Link href={`/socios/${s.id}`}>{s.fullName}</Link> <code className="tiny">{s.memberCode}</code></span>
          ))}. </>}
          {r?.kind === 'SELF' && c.sharedWith.length > 0 && <>{nombre} responde por el número.</>}
          {r?.kind === 'MEMBER' && <>Responsable del número: <Link href={`/socios/${r.memberId}`}>{r.name}</Link>.</>}
          {r?.kind === 'ADULT' && <>{r.guardianSignedAt ? 'Su tutor' : 'Responsable del número'}: <strong>{r.name}</strong>{r.phoneE164 ? ` · ${telefono(r.phoneE164)}` : ''}{r.guardianSignedAt ? ` · firmó el ${fechaHora(r.guardianSignedAt)}` : ''}.</>}
          {c.missingResponsible && <Badge tone="warn">Falta anotar quién responde por el número</Badge>}
          {' '}
          {(c.missingResponsible ? (puedeEditar || puedeCompletar) : puedeEditar) && c.sharedWith.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAnotar(true)}>{c.missingResponsible ? 'Anotar responsable' : 'Cambiar responsable'}</button>
          )}
        </p>
      )}
      {faltan.length > 0 && puedeCompletar && (
        <p className="small" data-testid="faltan-datos">
          <Badge tone="warn">Faltan datos</Badge> {faltan.map((k) => (CAMPO[k] ?? k).toLowerCase()).join(', ')}.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompletar(true)}>Completar datos</button>
        </p>
      )}
      {anotar && c && <AnotarResponsable memberId={memberId} nombre={nombre} comparten={c.sharedWith} soloSiFalta={!puedeEditar} onClose={() => setAnotar(false)} onHecho={cerrar} />}
      {completar && vacios && <CompletarDatos memberId={memberId} nombre={nombre} vacios={vacios} onClose={() => setCompletar(false)} onHecho={cerrar} />}
    </div>
  );
}

function AnotarResponsable({ memberId, nombre, comparten, soloSiFalta, onClose, onHecho }: {
  memberId: string; nombre: string; comparten: MemberSharedPhone['sharedWith'];
  /** Recepción: solo lo anota si falta (`POST …/complete`); gerencia lo cambia (`PUT …/responsible`). */
  soloSiFalta: boolean; onClose: () => void; onHecho: () => void;
}) {
  const [e, setE] = useState<Eleccion>(SIN_ELEGIR);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elegido = responsableElegido(e);
  async function guardar() {
    if (!elegido) return;
    setEnviando(true); setError(null);
    try {
      if (soloSiFalta) await api(`/members/${memberId}/complete`, { method: 'POST', body: JSON.stringify({ responsible: elegido }) });
      else await api(`/members/${memberId}/responsible`, { method: 'PUT', body: JSON.stringify({ responsible: elegido }) });
      onHecho();
    } catch (x) { setError(errorText(x, 'No se pudo anotar al responsable')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Responsable del número" sub={`Quién responde por el celular que ${nombre} comparte.`} error={error}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<Save />} loading={enviando} disabled={!elegido} onClick={() => void guardar()}>Guardar</Button></>}>
      <ElegirResponsable comparten={comparten} valor={e} onChange={setE} quien={nombre} />
    </Dialog>
  );
}

/**
 * «COMPLETAR DATOS» (D-11): solo aparecen los campos que están VACÍOS. Lo que
 * ya se capturó no se toca desde aquí (eso es «Editar datos», de la gerencia).
 */
export function CompletarDatos({ memberId, nombre, vacios, onClose, onHecho }: {
  memberId: string; nombre: string; vacios: Vacios; onClose: () => void; onHecho: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState({ phoneE164: '', email: '', birthDate: '', emergencyContactName: '', emergencyContactPhone: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = (k: keyof typeof d) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    setD({ ...d, [k]: ev.target.value }); setErrores(({ [k]: _, ...resto }) => resto);
    if (k === 'phoneE164') { setComparten(null); setEleccion(SIN_ELEGIR); }
  };
  // D-09: el celular que se completa ya es el de otro socio; se comparte anotando quién responde por él.
  const [comparten, setComparten] = useState<Array<{ id: string | null; fullName: string; memberCode: string | null }> | null>(null);
  const [eleccion, setEleccion] = useState<Eleccion>(SIN_ELEGIR);
  const cuerpo = Object.fromEntries((Object.keys(d) as Array<keyof typeof d>).filter((k) => vacios[k] && d[k].trim()).map((k) => [k, d[k].trim()]));
  const responsable = comparten ? responsableElegido(eleccion) : null;
  async function guardar() {
    setEnviando(true); setError(null);
    try {
      const r = await api<MemberCompleted>(`/members/${memberId}/complete`, { method: 'POST', body: JSON.stringify({ ...cuerpo, ...(responsable ? { responsible: responsable } : {}) }) });
      toast('ok', r.filled.length > 0 ? 'Datos completados' : 'Esos datos ya estaban capturados: no se cambió nada');
      onHecho();
    } catch (x) {
      if (x instanceof ApiError && x.data?.reason === 'PHONE_IN_USE' && !comparten) {
        // Se pregunta con quién lo comparte y se ofrece elegir al responsable ahí mismo.
        const { people } = await api<IdentityCheck>('/members/check-duplicates', { method: 'POST', body: JSON.stringify({ phoneE164: d.phoneE164.trim() }) }).catch(() => ({ people: [] as IdentityCheck['people'] }));
        setComparten(people.filter((p) => p.kind === 'MEMBER' && p.id !== memberId).map((p) => ({ id: p.id, fullName: p.fullName, memberCode: p.memberCode })));
        return;
      }
      const porCampo = erroresPorCampo(x);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) setError(errorText(x, 'No se pudo guardar'));
    } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Completar datos" sub={`Lo que quedó pendiente en el alta de ${nombre}. Lo ya capturado no cambia.`} error={error}
      footer={<><Button variant="secondary" onClick={onClose}>Después</Button><Button icon={<Save />} loading={enviando} disabled={Object.keys(cuerpo).length === 0 || (!!comparten && !responsable)} onClick={() => void guardar()}>Guardar</Button></>}>
      <div className="grid grid-2 gap-12">
        {vacios.phoneE164 && <Field label="Celular" htmlFor="cd-ph" error={errores.phoneE164 ?? null}><input id="cd-ph" className="input" inputMode="tel" placeholder="10 dígitos" value={d.phoneE164} onChange={campo('phoneE164')} aria-invalid={!!errores.phoneE164} /></Field>}
        {vacios.email && <Field label="Correo" htmlFor="cd-em" error={errores.email ?? null}><input id="cd-em" className="input" type="email" value={d.email} onChange={campo('email')} aria-invalid={!!errores.email} /></Field>}
        {vacios.birthDate && <Field label="Nacimiento" htmlFor="cd-bd" error={errores.birthDate ?? null}><CampoFecha id="cd-bd" value={d.birthDate} onChange={(v) => { setD({ ...d, birthDate: v }); setErrores(({ birthDate: _, ...resto }) => resto); }} aria-invalid={!!errores.birthDate} /></Field>}
        {vacios.emergencyContactName && <Field label="Contacto de emergencia" htmlFor="cd-en" error={errores.emergencyContactName ?? null}><input id="cd-en" className="input" value={d.emergencyContactName} onChange={campo('emergencyContactName')} aria-invalid={!!errores.emergencyContactName} /></Field>}
        {vacios.emergencyContactPhone && <Field label="Teléfono de emergencia" htmlFor="cd-ep" error={errores.emergencyContactPhone ?? null}><input id="cd-ep" className="input" inputMode="tel" value={d.emergencyContactPhone} onChange={campo('emergencyContactPhone')} aria-invalid={!!errores.emergencyContactPhone} /></Field>}
      </div>
      {comparten && comparten.length > 0 && <div className="mt-12"><ElegirResponsable comparten={comparten} valor={eleccion} onChange={setEleccion} quien={nombre} /></div>}
    </Dialog>
  );
}
