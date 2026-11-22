'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Lock, Minus } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, ButtonLink, Callout, Card, Dialog, ErrorCarga, Field, PageHeader, EsqueletoPagina } from '@/components/ui';
import { fecha } from '@/lib/format';
import { cargarModulos, cambiarModulo, cambiarModuloEnSede, type EstadoModulos, type Modulo } from '@/modules/api';
import { SECCIONES, respuestaDePuerta, seccionDeRuta } from '@/modules/registro';
import { PestanasGimnasio } from '../gimnasio/pestanas';
import { IconTile } from '@/components/compartido';

/** El orden de los grupos en la pantalla: primero lo que más se enciende y apaga. */
const ORDEN_GRUPOS = ['money', 'sell', 'members', 'entrance'];

/** Por qué cada parte de lo básico no se apaga: sin razón, "no se puede" genera dudas. */
const SIEMPRE = [
  ['Socios, membresías y cobros', 'Recepción, Socios, Planes, comprobantes', 'Es el padrón, lo que se vende y lo que se cobra: sin esto no hay gimnasio que administrar.'],
  ['Reportes', 'Inicio, Tablero, Movimientos', 'Son las cuentas del gimnasio; se arman solas con lo que ya se cobra.'],
  ['Personal y sucursales', 'Personal, Sucursales, Módulos', 'Definen quién entra al panel, dónde y qué ve.'],
  ['Control', 'Autorizaciones, Bitácora', 'Guardan quién hizo qué y quién lo autorizó. No se apagan para que nadie opere sin dejar rastro.'],
  ['Textos de consentimiento', 'Textos de consentimiento', 'El aviso de privacidad es obligatorio por ley al registrar a un socio.'],
] as const;

const MOTIVOS = ['No lo usamos', 'Cerramos esa área', 'Lo llevamos en otra herramienta', 'Es temporal'];
/** Módulos que el socio también ve en su teléfono. */
const EN_EL_PORTAL = new Set(['classes', 'training']);

const frase = (xs: readonly string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(xs);

/** Por qué lo vivo impide apagar, cuando no es «tus socios cuentan con eso» (19-01). */
const POR_QUE_BLOQUEA: Readonly<Record<string, string>> = {
  cash: 'Haz el corte de cada turno antes: es donde se cuenta el cajón, y apagado ya no se podría.',
};

/**
 * MÓDULOS: qué usa este gimnasio y qué no (ADR-036).
 *
 * El interruptor nunca cambia nada por sí solo: abre un diálogo que dice qué
 * hay, qué se conserva y cómo se vuelve. Apagar oculta y deja de generar;
 * nunca borra.
 */
export default function ModulosPage() {
  const { recargar, mirada } = useSession();
  const puedeIrA = (href: string) => { const s = seccionDeRuta(href); return !s || respuestaDePuerta(s, mirada) === 'pasa'; };
  const toast = useToast();
  const [data, setData] = useState<EstadoModulos | null>(null);
  const [fallo, setFallo] = useState(false);
  const [abierto, setAbierto] = useState<Modulo | null>(null);
  const [enSede, setEnSede] = useState<{ m: Modulo; sede: Modulo['branches'][number] } | null>(null);

  const cargar = useCallback(() => {
    setFallo(false);
    cargarModulos().then(setData).catch(() => setFallo(true));
  }, []);
  useEffect(cargar, [cargar]);

  // `/modulos?modulo=cash&sede=…` llega desde Sucursales («Dejar de usar Caja en Centro», 19-07):
  // abre ese diálogo una vez. Se lee al montar, como en Socios, para no perder el prerender.
  const [pedido, setPedido] = useState<{ modulo: string; sede: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const modulo = q.get('modulo'), sede = q.get('sede');
    if (modulo && sede) setPedido({ modulo, sede });
  }, []);
  useEffect(() => {
    if (!data || !pedido) return;
    const m = data.modules.find((x) => x.key === pedido.modulo);
    const sede = m?.branches.find((b) => b.branchId === pedido.sede);
    if (m && sede?.canChange) setEnSede({ m, sede });
    setPedido(null);
  }, [data, pedido]);

  async function aplicar(m: Modulo, enabled: boolean, motivo?: string) {
    const r = await cambiarModulo(m.key, enabled, motivo);
    setData(r);
    setAbierto(null);
    toast('ok', enabled ? `${m.name} se encendió.` : `${m.name} se apagó. El personal lo verá la próxima vez que abra el panel.`);
    // El menú de quien lo cambió se actualiza en el acto.
    await recargar();
  }

  async function aplicarEnSede(m: Modulo, sede: Modulo['branches'][number], enabled: boolean, motivo?: string) {
    const r = await cambiarModuloEnSede(m.key, sede.branchId, enabled, motivo);
    setData(r);
    setEnSede(null);
    toast('ok', enabled ? `${m.name} vuelve a usarse en ${sede.name}.` : `${m.name} dejó de usarse en ${sede.name}.`);
    await recargar();
  }

  const opcionales = data?.modules.filter((m) => m.kind === 'optional') ?? [];
  const encendidos = opcionales.filter((m) => m.enabled).length;
  const contratados = opcionales.filter((m) => m.contracted).length;
  const porPreparar = opcionales.filter((m) => m.setup).length;
  const grupos = ORDEN_GRUPOS
    .map((g) => ({ clave: g, modulos: opcionales.filter((m) => m.group === g) }))
    .filter((g) => g.modulos.length > 0);

  return (
    <>
      <PestanasGimnasio actual="modulos" />
      <PageHeader
        title="Módulos"
        sub="Enciende solo lo que tu gimnasio usa. Lo apagado desaparece del menú de todo el personal y del teléfono del socio. Nada se borra: al encenderlo vuelve como estaba."
      />

      {fallo && <ErrorCarga mensaje="No se pudieron cargar los módulos." onReintentar={cargar} />}
      {!data && !fallo && <EsqueletoPagina cifras={0} />}

      {data && (
        <div className="stack">
          {!data.canManage && <Callout tone="info">Solo el gerente puede cambiar los módulos.</Callout>}
          <p className="small muted" data-testid="resumen-modulos">{encendidos} de {contratados} encendidos{contratados < opcionales.length ? ` · ${opcionales.length - contratados} sin contratar` : ''}{porPreparar > 0 ? ` · ${porPreparar} por configurar` : ''}</p>
          {/* Qué contrató el gimnasio (19-09): la puerta técnica ya existía; faltaba decirlo. */}
          {data.plan && (
            <p className="small" data-testid="plan-contratado">
              <span className="strong">{data.plan.name ? `Tu plan: ${data.plan.name}` : 'Tu contrato es a la medida'}</span>
              <span className="muted"> · {data.plan.name ? 'incluye' : 'tienes'} {data.plan.included} {data.plan.included === 1 ? 'módulo' : 'módulos'}{data.plan.addOns > 0 ? ` · ${data.plan.addOns} ${data.plan.addOns === 1 ? 'agregado aparte' : 'agregados aparte'}` : ''}. Lo contratado lo cambia GymFlow.</span>
            </p>
          )}

          {grupos.map((g) => (
            <section key={g.clave} aria-label={g.modulos[0]!.groupName ?? undefined}>
              <h2 className="mod-grupo">{g.modulos[0]!.groupName}</h2>
              <Card pad={false}>
                <ul className="list">
                  {g.modulos.map((m) => (
                    <li key={m.key} className="mod" data-modulo={m.key}>
                      <div className="mod-texto">
                        <p className="row gap-8 flex-wrap">
                          <span className="strong">{m.name}</span>
                          {/* Quien opera ya lo lee en el interruptor; quien solo consulta, en la insignia. */}
                          {!m.contracted
                            ? <Badge tone="warn">No contratado</Badge>
                            // Encendido no es «listo para usarse» (19-08): tres estados, también para quien opera.
                            : m.setup ? <Badge tone="warn" dot>Falta configurar</Badge>
                            : !data.canManage && <Badge tone={m.enabled ? 'ok' : 'neutral'} dot>{m.enabled ? 'Encendido' : 'Apagado'}</Badge>}
                        </p>
                        <p className="small mt-4">{m.description}</p>
                        {/* Lo de consulta, plegado (UX7 Dirección 9): la página medía 7,000 px en el teléfono. */}
                        <details className="mod-mas">
                          <summary className="small">Quién lo usa y qué pantallas abre</summary>
                          <p className="small muted">
                            Lo usan: {m.usedBy} · Pantallas: {m.screens.join(', ')}
                            {m.requires.length > 0 && <> · Necesita: {m.requires.map((r) => `${r.name}${r.fixed ? ' (siempre encendida)' : ''}`).join(', ')}</>}
                          </p>
                        </details>
                        {m.setup && (
                          <p className="small mt-4" data-testid="falta-configurar">
                            <span className="text-warn">{m.setup.text}</span>{' '}
                            {/* Solo se ofrece ir a quien entra a esa pantalla. */}
                            {puedeIrA(m.setup.href) && <Link href={m.setup.href} className="strong">{m.setup.action}</Link>}
                          </p>
                        )}
                        {m.contracted ? <Detalle m={m} /> : <p className="small muted mt-4">Tu gimnasio no tiene contratado este módulo: es un agregado de tu contrato con GymFlow. Si lo quieres, pídeselo a GymFlow.</p>}
                        {m.enabled && m.scope === 'branch' && m.branches.length > 1 && (
                          <div className="row gap-6 flex-wrap mt-8">
                            <span className="small muted">Por sucursal:</span>
                            {m.branches.map((b) => (
                              // Quien solo consulta ve insignias, no botones apagados (UX7 Dirección 9).
                              b.canChange
                                ? <button key={b.branchId} type="button" className="chip chip-sede" aria-pressed={b.enabled}
                                    title={b.enabled ? `Se usa en ${b.name}` : `No se usa en ${b.name}${b.reason ? `: «${b.reason}»` : ''}`}
                                    onClick={() => setEnSede({ m, sede: b })}>
                                    {b.enabled ? <Check size={13} aria-hidden /> : <Minus size={13} aria-hidden />}{b.name}
                                  </button>
                                : <Badge key={b.branchId} tone={b.enabled ? 'ok' : 'neutral'}>{b.enabled ? <Check size={12} aria-hidden /> : <Minus size={12} aria-hidden />}{b.name}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {data.canManage && (
                        <button
                          type="button" role="switch" className="switch" aria-checked={m.enabled}
                          aria-label={m.enabled ? `Apagar ${m.name}` : `Encender ${m.name}`}
                          disabled={!m.contracted} onClick={() => setAbierto(m)}
                        ><span /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}

          <section aria-label="Siempre encendido">
            <details className="mod-siempre">
            <summary className="mod-grupo">Siempre encendido <span className="strong">· {SIEMPRE.length} módulos básicos</span></summary>
            <Card pad={false}>
              <ul className="list">
                {SIEMPRE.map(([nombre, pantallas, razon]) => (
                  <li key={nombre} className="mod">
                    <IconTile><Lock /></IconTile>
                    <div className="mod-texto">
                      <p><span className="strong">{nombre}</span> <span className="small muted">· {pantallas}</span></p>
                      <p className="small muted mt-2">{razon}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            </details>
          </section>
        </div>
      )}

      {abierto && <Cambio m={abierto} onClose={() => setAbierto(null)} onAplicar={aplicar} onError={(e) => toast('error', errorText(e, 'No se pudo cambiar el módulo'))} />}
      {enSede && data && <CambioEnSede key={`${enSede.m.key}:${enSede.sede.branchId}`} m={enSede.m} sede={enSede.sede} modulos={data.modules}
        onCambiar={(m, sede) => setEnSede({ m, sede })}
        onClose={() => setEnSede(null)} onAplicar={aplicarEnSede} onError={(e) => toast('error', errorText(e, 'No se pudo cambiar el módulo en la sucursal'))} />}
    </>
  );
}

/** El renglón inferior de cada módulo: qué hay vivo, o quién lo apagó y por qué. */
function Detalle({ m }: { m: Modulo }) {
  if (!m.usage) return null;
  const hay = [...m.usage.blockers, ...m.usage.inUse];
  if (m.enabled) return hay.length > 0 ? <p className="small muted mt-4">En uso: {hay.join(' · ')}</p> : null;
  const c = m.lastChange;
  return (
    <p className="small muted mt-4">
      {c && !c.enabled ? <>Apagado por {c.byName ?? 'la gerencia'} el {fecha(c.at)}{c.reason ? <> · «{c.reason}»</> : null}</> : 'Apagado: este gimnasio no lo ha usado.'}
      {hay.length > 0 && <> · Se conserva: {hay.join(' · ')}</>}
    </p>
  );
}

function Cambio({ m, onClose, onAplicar, onError }: {
  m: Modulo; onClose: () => void;
  onAplicar: (m: Modulo, enabled: boolean, motivo?: string) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const pantalla = SECCIONES.find((s) => s.modulo === m.key);
  const bloqueos = m.usage?.blockers ?? [];

  async function enviar(enabled: boolean) {
    setEnviando(true);
    try { await onAplicar(m, enabled, enabled ? undefined : motivo.trim()); } catch (e) { onError(e); } finally { setEnviando(false); }
  }

  // Encender: sin motivo. Todo vuelve como estaba.
  if (!m.enabled) {
    const requisitos = m.requires.filter((r) => !r.fixed).map((r) => r.name);
    return (
      <Dialog open onClose={onClose} title={`Encender ${m.name}`}
        footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button loading={enviando} onClick={() => void enviar(true)}>Encender {m.name}</Button></>}>
        <div className="stack-sm">
          <p>{m.name} vuelve al menú de quien lo usa ({m.usedBy.toLowerCase()}).</p>
          <p className="small muted">
            {(m.usage?.inUse.length ?? 0) > 0 ? `Regresa lo que había: ${frase(m.usage!.inUse)}.` : 'Si ya se había usado, regresa lo que había.'}
            {requisitos.length > 0 && ` También se enciende ${frase(requisitos)}, que lo necesita.`}
          </p>
        </div>
      </Dialog>
    );
  }

  // Otro módulo encendido lo necesita: primero se apaga ese, a propósito.
  if (m.dependents.length > 0) {
    return (
      <Dialog open onClose={onClose} title={`No se puede apagar ${m.name} todavía`} footer={<Button variant="secondary" onClick={onClose}>Entendido</Button>}>
        <p>{frase(m.dependents)} lo necesita. Apaga primero {frase(m.dependents)}.</p>
      </Dialog>
    );
  }

  // Hay socios esperando algo: se resuelve antes, no se apaga encima.
  if (bloqueos.length > 0) {
    return (
      <Dialog open onClose={onClose} title={`Antes de apagar ${m.name}`}
        footer={<><Button variant="secondary" onClick={onClose}>Volver</Button>{pantalla && <ButtonLink href={pantalla.href} variant="primary">Ir a {pantalla.etiqueta}</ButtonLink>}</>}>
        <div className="stack-sm">
          <p>Hay <strong>{frase(bloqueos)}</strong>. {POR_QUE_BLOQUEA[m.key] ?? 'Tus socios cuentan con eso.'}</p>
          <p className="small muted">Resuélvelo desde {pantalla?.etiqueta ?? 'su pantalla'} y vuelve aquí para apagarlo.</p>
        </div>
      </Dialog>
    );
  }

  const enUso = m.usage?.inUse ?? [];
  return (
    <Dialog open onClose={onClose} title={`Apagar ${m.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button variant="danger" loading={enviando} disabled={motivo.trim().length < 3} onClick={() => void enviar(false)}>Apagar {m.name}</Button></>}>
      <div className="stack">
        <p>
          Desaparece del menú de todo el personal{EN_EL_PORTAL.has(m.key) ? ' y del teléfono del socio' : ''}. No se borra nada: si lo enciendes otra vez, vuelve como estaba.
        </p>
        {enUso.length > 0 && <Callout tone="info" title="Se conserva">{frase(enUso)}. Mientras esté apagado nadie podrá verlo ni cambiarlo desde aquí.</Callout>}
        <Field label="Motivo" htmlFor="mod-motivo" hint="Queda en la bitácora con tu nombre, y lo lee quien llegue a la sección y la encuentre apagada.">
          <input id="mod-motivo" className="input" autoFocus maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        <div className="row gap-6 flex-wrap">
          {MOTIVOS.map((t) => <button key={t} type="button" className="chip" aria-pressed={motivo === t} onClick={() => setMotivo(t)}>{t}</button>)}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Una sucursal deja de usar un módulo, o lo retoma. Lo decide la gerencia por
 * cada sede (19-12). Si otro módulo de esa sede lo necesita (Punto de venta
 * necesita Caja), lo dice antes y lleva a ese; si la API encuentra algo vivo
 * ahí (un turno de caja abierto, 19-01), lo dice aquí mismo con a dónde ir.
 */
function CambioEnSede({ m, sede, modulos, onCambiar, onClose, onAplicar, onError }: {
  m: Modulo; sede: Modulo['branches'][number]; modulos: readonly Modulo[];
  onCambiar: (m: Modulo, sede: Modulo['branches'][number]) => void;
  onClose: () => void;
  onAplicar: (m: Modulo, sede: Modulo['branches'][number], enabled: boolean, motivo?: string) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [bloqueo, setBloqueo] = useState<string | null>(null);
  const otras = m.branches.filter((b) => b.branchId !== sede.branchId && b.enabled).map((b) => b.name);
  const pantalla = SECCIONES.find((s) => s.modulo === m.key);
  // Lo que en ESTA sede lo necesita encendido.
  const dependientes = modulos.flatMap((x) => {
    const ahi = x.branches.find((b) => b.branchId === sede.branchId);
    return x.enabled && ahi?.enabled && x.requires.some((r) => r.key === m.key) ? [{ m: x, sede: ahi }] : [];
  });

  async function enviar(enabled: boolean) {
    setEnviando(true);
    setBloqueo(null);
    try { await onAplicar(m, sede, enabled, enabled ? undefined : motivo.trim()); } catch (e) {
      // Lo que hay vivo en la sede se dice aquí, no en un aviso que se va.
      if (e instanceof ApiError && e.status === 409) setBloqueo(e.message); else onError(e);
    } finally { setEnviando(false); }
  }

  if (!sede.enabled) {
    return (
      <Dialog open onClose={onClose} title={`Usar ${m.name} en ${sede.name} otra vez`}
        footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button loading={enviando} onClick={() => void enviar(true)}>Usar en {sede.name}</Button></>}>
        <div className="stack-sm">
          <p>{m.name} vuelve al menú de quien trabaja en {sede.name}. Lo que había ahí regresa como estaba.</p>
          {bloqueo && <Callout tone="danger">{bloqueo}</Callout>}
        </div>
      </Dialog>
    );
  }
  if (dependientes.length > 0) {
    const nombres = frase(dependientes.map((d) => d.m.name));
    return (
      <Dialog open onClose={onClose} title={`No se puede dejar de usar ${m.name} en ${sede.name} todavía`}
        footer={<><Button variant="secondary" onClick={onClose}>Volver</Button>
          <Button onClick={() => onCambiar(dependientes[0]!.m, dependientes[0]!.sede)}>Dejar de usar {dependientes[0]!.m.name} ahí primero</Button></>}>
        <p>En {sede.name}, {nombres} lo necesita. Deja de usar primero {nombres} en esa sucursal y luego {m.name}.</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Dejar de usar ${m.name} en ${sede.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button variant="danger" loading={enviando} disabled={motivo.trim().length < 3 || !!bloqueo} onClick={() => void enviar(false)}>Dejar de usar en {sede.name}</Button></>}>
      <div className="stack">
        <p>
          {otras.length > 0 ? `${m.name} sigue en ${frase(otras)}. ` : ''}En {sede.name} desaparece del menú de quien trabaja ahí y no se puede crear nada nuevo ahí. No se borra nada.
          {m.key === 'cash' ? ' Ahí se sigue cobrando, sin turno ni corte.' : ''}
        </p>
        {bloqueo && (
          <Callout tone="danger" title="Todavía no">
            <p>{bloqueo}</p>
            {pantalla && <div className="callout-accion"><ButtonLink href={pantalla.href} size="sm">Ir a {pantalla.etiqueta}</ButtonLink></div>}
          </Callout>
        )}
        {!bloqueo && <>
          <Field label="Motivo" htmlFor="mod-motivo-sede" hint="Queda en la bitácora con tu nombre.">
            <input id="mod-motivo-sede" className="input" autoFocus maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
          <div className="row gap-6 flex-wrap">
            {['No lo usamos en esta sede', 'Esta sede no tiene el espacio', 'Es temporal'].map((t) => <button key={t} type="button" className="chip" aria-pressed={motivo === t} onClick={() => setMotivo(t)}>{t}</button>)}
          </div>
        </>}
      </div>
    </Dialog>
  );
}
