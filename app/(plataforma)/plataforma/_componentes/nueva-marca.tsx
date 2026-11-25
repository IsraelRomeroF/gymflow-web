'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@gymflow/ui/format';
import { ZONAS } from '@/lib/zonas';
import { useToast, errorText, erroresPorCampo } from '@/components/session';
import { Button, Callout, Dialog, Field, Switch, irAlPrimerError } from '@/components/ui';
import { usePlataforma } from '../../layout';
import type { Credencial, MarcaCreada } from './tipos';

type Persona = { fullName: string; email: string; phone: string };
const PERSONA = (): Persona => ({ fullName: '', email: '', phone: '' });
/** Los puestos que se pueden dar de alta con la marca, además del dueño. */
type RolArranque = 'MANAGER' | 'RECEPTION' | 'COACH';
const ROL_ARRANQUE: Record<RolArranque, string> = { MANAGER: 'Gerente', RECEPTION: 'Recepción', COACH: 'Coach' };
type Integrante = Persona & { role: RolArranque; uid: number };
let siguienteUid = 0;
const INTEGRANTE = (role: RolArranque): Integrante => ({ ...PERSONA(), role, uid: siguienteUid++ });

/** Los tres pasos del alta (22-01, 22-12): lo fijo primero, después qué contrató y al final quién entra. */
const PASOS = [
  { n: 1, titulo: 'La marca', texto: 'Cómo se llama, en qué zona horaria opera y su primera sucursal.' },
  { n: 2, titulo: 'Qué contrató', texto: 'Su plan o, a la medida, módulo por módulo. Lo contratado nace encendido; la gerencia apaga después lo que no use.' },
  { n: 3, titulo: 'Las cuentas', texto: 'El dueño y su equipo de arranque. Cada quien recibe su propia contraseña temporal.' },
] as const;
type Paso = (typeof PASOS)[number]['n'];

/** En qué paso vive cada campo: un error del servidor lleva a su paso. */
function pasoDe(campo: string): Paso {
  if (/^(tradeName|legalName|timezone|branch)/.test(campo)) return 1;
  if (/^(planId|contracted|template)/.test(campo)) return 2;
  return 3;
}

/** El código que se sugiere para la primera sucursal: las tres primeras letras del nombre comercial. */
function codigoSugerido(nombre: string): string {
  const letras = nombre.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  return letras.length >= 3 ? letras.slice(0, 3) : '';
}

export type AltaHecha = { tradeName: string; organizationId: string; serviceStatus: MarcaCreada['serviceStatus']; credentials: Credencial[] };

/**
 * «NUEVA MARCA» EN TRES PASOS, con la barra de avance arriba y el pie fijo
 * (Atrás / Siguiente / Dar de alta la marca). Cada paso se valida al avanzar:
 * el error queda en su campo, a la vista, y no a cinco pantallas del botón.
 *
 * Lo que cambió respecto del diálogo de una sola hoja (informe 22):
 *  - la zona horaria se elige aquí (22-02): un gimnasio de Tijuana ya no nace en hora del centro;
 *  - desaparece «Plantilla de arranque» como segunda pregunta (22-01). Las cuatro
 *    plantillas son ATAJOS que solo marcan los módulos cuando no hay plan;
 *  - «Liberar el software al terminar» (22-11), apagada por omisión.
 */
export function NuevaMarca({ onClose, onCreada }: { onClose: () => void; onCreada: (r: AltaHecha) => void }) {
  const { templates, modules, plans } = usePlataforma();
  const toast = useToast();
  const [paso, setPaso] = useState<Paso>(1);
  const [f, setF] = useState({ legalName: '', tradeName: '', timezone: 'America/Mexico_City', planId: '', branchCode: '', branchName: 'Matriz', addressLine: '', reason: '' });
  // El código se sugiere mientras nadie lo haya escrito a mano.
  const [codigoAMano, setCodigoAMano] = useState(false);
  const opcionales = modules.filter((m) => m.kind === 'optional');
  // Lo contratado lo decide la plataforma: el plan (ADR-039) lo fija y encima van los agregados; sin plan, los atajos solo proponen.
  const [contratados, setContratados] = useState<Set<string>>(() => new Set(opcionales.map((m) => m.key)));
  const plan = plans.find((p) => p.id === f.planId) ?? null;
  const loDe = (off: readonly string[]) => opcionales.map((m) => m.key).filter((k) => !off.includes(k));
  /** El atajo que coincide exactamente con lo marcado (solo sin plan); queda en la bitácora como referencia. */
  const atajo = plan ? null : templates.find((t) => { const suyos = loDe(t.off); return suyos.length === contratados.size && suyos.every((k) => contratados.has(k)); }) ?? null;
  const elegirPlan = (id: string) => {
    const p = plans.find((x) => x.id === id);
    setF((prev) => ({ ...prev, planId: id }));
    if (p) setContratados(new Set(p.modules));
  };
  const [owner, setOwner] = useState<Persona>(PERSONA());
  // El dueño siempre; lo demás se agrega o se quita (sin gerente, el dueño administra al personal).
  const [equipo, setEquipo] = useState<Integrante[]>(() => [INTEGRANTE('MANAGER'), INTEGRANTE('RECEPTION')]);
  const cambiar = (uid: number, p: Partial<Integrante>) => setEquipo((e) => e.map((x) => (x.uid === uid ? { ...x, ...p } : x)));
  const [liberar, setLiberar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorDelPie, setErrorDelPie] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  // Lo que falta se marca en su campo al intentar avanzar (UX5-PL-11), no con un botón apagado sin explicación.
  const [intentados, setIntentados] = useState<ReadonlySet<Paso>>(new Set());
  const [delServidor, setDelServidor] = useState<Record<string, string>>({});
  const errPersona = (p: Persona, ruta: string): Record<string, string> => ({
    ...(p.fullName.trim().length < 3 ? { [`${ruta}.fullName`]: 'Escribe su nombre completo.' } : {}),
    ...(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email.trim()) ? { [`${ruta}.email`]: 'Escribe un correo válido.' } : {}),
  });
  const locales: Record<string, string> = {
    ...(f.tradeName.trim().length < 2 ? { tradeName: 'Escribe el nombre comercial.' } : {}),
    ...(f.legalName.trim().length < 3 ? { legalName: 'Escribe la razón social.' } : {}),
    ...(f.branchName.trim().length < 2 ? { 'branch.name': 'Escribe el nombre de la sucursal.' } : {}),
    ...(!/^[A-Za-z]{3,6}$/.test(f.branchCode) ? { 'branch.code': 'De 3 a 6 letras, por ejemplo CEN.' } : {}),
    ...errPersona(owner, 'owner'), ...Object.assign({}, ...equipo.map((x, i) => errPersona(x, `staff.${i}`))),
    ...(f.reason.trim().length < 3 ? { reason: 'Escribe por qué se da de alta (queda en la bitácora).' } : {}),
  };
  const conError = (n: Paso) => [...Object.keys(locales).filter((k) => intentados.has(pasoDe(k))), ...Object.keys(delServidor)].some((k) => pasoDe(k) === n);
  const faltaEn = (n: Paso) => Object.keys(locales).some((k) => pasoDe(k) === n);
  const err = (k: string): string | undefined => (intentados.has(pasoDe(k)) ? locales[k] : undefined) ?? delServidor[k];

  /** Avanza solo si el paso está completo; si no, marca lo que falta y lleva al primero. */
  function siguiente() {
    setErrorDelPie(null);
    setIntentados((s) => new Set(s).add(paso));
    if (faltaEn(paso)) { irAlPrimerError(); return; }
    if (paso < 3) setPaso((paso + 1) as Paso);
  }

  async function crear() {
    setErrorDelPie(null);
    setIntentados(new Set<Paso>([1, 2, 3]));
    // Si alguien volvió atrás y dejó algo incompleto, se regresa a ese paso.
    const incompleto = PASOS.find((p) => faltaEn(p.n));
    if (incompleto) { setPaso(incompleto.n); irAlPrimerError(); return; }
    setEnviando(true);
    setDelServidor({});
    try {
      const persona = (p: Persona) => ({ fullName: p.fullName.trim(), email: p.email.trim(), ...(p.phone.trim() ? { phone: p.phone.trim() } : {}) });
      const r = await api<MarcaCreada>('/platform/organizations', {
        method: 'POST',
        body: JSON.stringify({
          legalName: f.legalName.trim(), tradeName: f.tradeName.trim(), timezone: f.timezone, planId: f.planId || null, reason: f.reason.trim(),
          // Contratado = encendido. Con plan, solo viajan los agregados: lo del plan va implícito.
          contracted: [...contratados].filter((k) => !plan?.modules.includes(k)),
          ...(atajo ? { template: atajo.key } : {}),
          releaseNow: liberar,
          branch: { code: f.branchCode.toUpperCase(), name: f.branchName.trim(), ...(f.addressLine.trim() ? { addressLine: f.addressLine.trim() } : {}) },
          owner: persona(owner),
          staff: equipo.map((x) => ({ ...persona(x), role: x.role })),
        }),
      });
      toast('ok', `${f.tradeName.trim()} quedó dada de alta${r.serviceStatus === 'ACTIVE' ? ' y en uso' : ''}.`);
      onCreada({ tradeName: f.tradeName.trim(), organizationId: r.organizationId, serviceStatus: r.serviceStatus, credentials: r.credentials });
    } catch (e) {
      const porCampo = erroresPorCampo(e, { rutaCompleta: true });
      setDelServidor(porCampo);
      const primero = Object.keys(porCampo)[0];
      if (primero) { setPaso(pasoDe(primero)); irAlPrimerError(); }
      // Lo que no es de un campo (un correo que ya tiene cuenta, sin conexión) se dice en el pie, junto al botón.
      else setErrorDelPie(errorText(e, 'No se pudo dar de alta la marca'));
    } finally { setEnviando(false); }
  }

  const actual = PASOS[paso - 1]!;
  const sinGerente = !equipo.some((x) => x.role === 'MANAGER');
  const gerentes = equipo.filter((x) => x.role === 'MANAGER').length;
  return (
    <Dialog open onClose={onClose} title="Nueva marca" size="lg" error={errorDelPie}
      sub={`Paso ${paso} de 3 · ${actual.titulo}`}
      footer={<>
        {paso === 1
          ? <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          : <Button variant="secondary" icon={<ArrowLeft />} onClick={() => { setErrorDelPie(null); setPaso((paso - 1) as Paso); }}>Atrás</Button>}
        {paso < 3
          ? <Button onClick={siguiente}>Siguiente <ArrowRight size={16} /></Button>
          : <Button loading={enviando} onClick={() => void crear()}>Dar de alta la marca</Button>}
      </>}>
      <div className="stack">
        {/* La barra de pasos: dónde estás, qué falta y, si un paso tiene un error, cuál. Se puede volver a uno ya visto. */}
        <ol className="alta-pasos" data-testid="alta-pasos" aria-label="Pasos del alta">
          {PASOS.map((p) => (
            <li key={p.n} data-paso={p.n} data-estado={p.n === paso ? 'actual' : p.n < paso ? 'hecho' : 'falta'} data-con-error={conError(p.n) || undefined}>
              <button type="button" disabled={p.n >= paso} aria-current={p.n === paso ? 'step' : undefined} onClick={() => { setErrorDelPie(null); setPaso(p.n); }}>
                <span className="alta-paso-n" aria-hidden>{p.n}</span><span className="alta-paso-t">{p.titulo}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="small muted m-0">{actual.texto}</p>

        {paso === 1 && (
          <>
            <div className="grid grid-2">
              <Field label="Nombre comercial" htmlFor="nm-trade" required error={err('tradeName')} hint="Como lo conoce la gente. Es lo que verá el personal en su panel.">
                <input id="nm-trade" className="input" autoFocus value={f.tradeName}
                  onChange={(e) => setF({ ...f, tradeName: e.target.value, ...(codigoAMano ? {} : { branchCode: codigoSugerido(e.target.value) }) })} />
              </Field>
              <Field label="Razón social" htmlFor="nm-legal" required error={err('legalName')}><input id="nm-legal" className="input" value={f.legalName} onChange={set('legalName')} /></Field>
            </div>
            <Field label="Zona horaria" htmlFor="nm-zona" required error={err('timezone')} hint="De ella dependen «hoy», el corte de caja y los vencimientos. Cada sucursal puede tener la suya después.">
              <select id="nm-zona" className="select" value={f.timezone} onChange={set('timezone')}>
                {ZONAS.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
              </select>
            </Field>
            <p className="mod-grupo m-0">Primera sucursal</p>
            <div className="grid grid-3">
              <Field label="Nombre" htmlFor="nm-bn" required error={err('branch.name')}><input id="nm-bn" className="input" value={f.branchName} onChange={set('branchName')} /></Field>
              <Field label="Código" htmlFor="nm-bc" required error={err('branch.code')} hint="3 a 6 letras; sus tres primeras son el prefijo de los socios (CEN-00001).">
                <input id="nm-bc" className="input mono" maxLength={6} value={f.branchCode}
                  onChange={(e) => { setCodigoAMano(true); setF({ ...f, branchCode: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }); }} />
              </Field>
              <Field label="Dirección (opcional)" htmlFor="nm-ba"><input id="nm-ba" className="input" value={f.addressLine} onChange={set('addressLine')} /></Field>
            </div>
          </>
        )}

        {paso === 2 && (
          <>
            {plans.length === 0 && <Callout tone="info">Todavía no hay planes vigentes: la marca se contrata a la medida. Los planes se crean en <Link href="/plataforma/planes">Planes</Link>.</Callout>}
            <div className="stack-sm" role="radiogroup" aria-label="Plan contratado" data-testid="alta-plan">
              <label className="choice items-center" data-plan="">
                <input type="radio" name="nm-plan" checked={f.planId === ''} onChange={() => elegirPlan('')} />
                <span className="flex-1"><span className="choice-title block">A la medida</span><span className="choice-text block">Sin plan: cada módulo se contrata y se cobra por separado.</span></span>
              </label>
              {plans.map((p) => (
                <label key={p.id} className="choice items-center" data-plan={p.name}>
                  <input type="radio" name="nm-plan" checked={f.planId === p.id} onChange={() => elegirPlan(p.id)} />
                  <span className="flex-1">
                    <span className="choice-title block">{p.name} <span className="muted small">· {p.monthlyCents === null ? 'sin precio' : `${pesos(p.monthlyCents)} al mes`}</span></span>
                    <span className="choice-text block">Lo básico{p.modules.length ? ` + ${p.modules.map((k) => opcionales.find((m) => m.key === k)?.name ?? k).join(', ')}` : ''}{p.description ? ` · ${p.description}` : ''}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="stack-sm">
              <p className="label m-0">{plan ? 'Módulos del plan y agregados' : 'Módulos contratados'} <span className="muted">({contratados.size} de {opcionales.length})</span></p>
              <p className="hint m-0">{plan ? 'Lo del plan va fijo; lo demás se agrega y se cobra aparte.' : 'Lo que el dueño adquirió. La gerencia solo enciende y apaga dentro de esto; después se cambia desde la marca.'}</p>
              {/* Las plantillas son atajos: marcan los módulos de un tipo de gimnasio y nada más (22-01). Con plan no aplican. */}
              {!plan && (
                <div className="row gap-6 flex-wrap items-center" data-testid="alta-atajos">
                  <span className="tiny muted">Atajos:</span>
                  {templates.map((t) => (
                    <button key={t.key} type="button" className="chip alta-atajo" data-atajo={t.key} title={t.description} aria-pressed={atajo?.key === t.key}
                      onClick={() => setContratados(new Set(loDe(t.off)))}>{t.name}</button>
                  ))}
                </div>
              )}
              <div className="row gap-6 flex-wrap" data-testid="alta-modulos">
                {opcionales.map((m) => {
                  const delPlan = plan?.modules.includes(m.key) ?? false;
                  return (
                    <button key={m.key} type="button" className="chip" aria-pressed={contratados.has(m.key)} data-contrato={m.key} disabled={delPlan} title={delPlan ? 'Incluido en el plan' : undefined}
                      onClick={() => setContratados((c) => { const n = new Set(c); if (n.has(m.key)) n.delete(m.key); else n.add(m.key); return n; })}>
                      {contratados.has(m.key) ? '✓ ' : ''}{m.name}{delPlan ? ' · plan' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {paso === 3 && (
          <>
            <p className="small muted m-0">El celular es opcional: si lo das, a ese número se le manda su contraseña y a nadie más.</p>
            <PersonaFields titulo="Dueño" id="ow" value={owner} onChange={setOwner} errores={{ fullName: err('owner.fullName'), email: err('owner.email'), phone: err('owner.phone') }} />
            {equipo.map((x, i) => (
              <PersonaFields key={x.uid} id={`s${i}`} value={x} onChange={(p) => cambiar(x.uid, p)}
                titulo={(
                  <select className="select alta-persona-rol" aria-label={`Puesto de la cuenta ${i + 2}`} value={x.role} onChange={(e) => cambiar(x.uid, { role: e.target.value as RolArranque })}>
                    {(Object.keys(ROL_ARRANQUE) as RolArranque[]).map((k) => <option key={k} value={k}>{ROL_ARRANQUE[k]}</option>)}
                  </select>
                )}
                extra={<button type="button" className="row-link small muted" onClick={() => setEquipo((e) => e.filter((y) => y.uid !== x.uid))}>Quitar</button>}
                errores={{ fullName: err(`staff.${i}.fullName`), email: err(`staff.${i}.email`), phone: err(`staff.${i}.phone`) }} />
            ))}
            <div className="row gap-8 flex-wrap" data-testid="agregar-cuenta">
              {(Object.keys(ROL_ARRANQUE) as RolArranque[]).map((k) => (
                <Button key={k} type="button" variant="ghost" size="sm" icon={<Plus />} disabled={equipo.length >= 12} onClick={() => setEquipo((e) => [...e, INTEGRANTE(k)])}>{ROL_ARRANQUE[k]}</Button>
              ))}
            </div>
            {sinGerente && <Callout tone="info">Sin gerente: el dueño da de alta al personal y ajusta sus permisos hasta que haya uno.</Callout>}
            {/* Solo el primero nace con la llave (22-08): se dice antes de dar de alta, no después. */}
            {gerentes > 1 && <Callout tone="info">Solo el primer gerente de la lista nace con Dirección y Cumplimiento liberados. A los demás se los libera el dueño desde Personal.</Callout>}
            <Field label="Motivo del alta" htmlFor="nm-reason" required error={err('reason')} hint="Queda en la bitácora de la marca nueva."><input id="nm-reason" className="input" value={f.reason} onChange={set('reason')} placeholder="Contrato firmado el…" /></Field>
            <div className="alta-liberar" data-testid="alta-liberar">
              <Switch id="nm-liberar" checked={liberar} onChange={setLiberar}>Liberar el software al terminar</Switch>
              <p className="small muted m-0">{liberar
                ? 'La marca queda en uso en cuanto se dé de alta: su gente entra con su contraseña temporal y desde este mes se le puede facturar.'
                : <>La marca nace <strong>sin liberar</strong>: nadie entra hasta que la liberes. Márcalo cuando ya hay contrato firmado y pago.</>}</p>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function PersonaFields({ titulo, id, value, onChange, extra, errores = {} }: {
  titulo: React.ReactNode; id: string; value: Persona; onChange: (p: Persona) => void; extra?: React.ReactNode;
  errores?: { fullName?: string | undefined; email?: string | undefined; phone?: string | undefined };
}) {
  return (
    <div className="alta-persona">
      <div className="row-between alta-persona-cabeza"><span className="small strong">{titulo}</span>{extra}</div>
      <div className="grid grid-3">
        <Field label="Nombre" htmlFor={`${id}-n`} required error={errores.fullName}><input id={`${id}-n`} className="input" value={value.fullName} onChange={(e) => onChange({ ...value, fullName: e.target.value })} /></Field>
        <Field label="Correo" htmlFor={`${id}-e`} required error={errores.email}><input id={`${id}-e`} className="input" type="email" autoComplete="off" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} /></Field>
        <Field label="Celular (opcional)" htmlFor={`${id}-t`} error={errores.phone}><input id={`${id}-t`} className="input" inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></Field>
      </div>
    </div>
  );
}
