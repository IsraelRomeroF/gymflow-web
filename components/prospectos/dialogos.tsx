'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, MessageCircle, Check } from 'lucide-react';
import type { Prospect, ProspectSources } from '@gymflow/core/contracts';
import { REFERRAL_SOURCE } from '@gymflow/core/captacion';
import { TIPO_DE_PERSONA } from '@gymflow/core/vocabulario';
import { api, ApiError } from '@/lib/api';
import { fecha, fechaHora, pesos, telefono } from '@/lib/format';
import { porPeriodo, type Plan } from '@/lib/plans';
import { hoyEn, masDias } from '@/lib/zonas';
import { enlaceAlta, usePortalUrl } from '@/lib/portal';
import { useCarga, EstadoCarga } from '@/lib/carga';
import { useFormulario } from '@/lib/formulario';
import { useSession, useToast, errorText, erroresPorCampo } from '@/components/session';
import { Button, Callout, CampoFecha, Dialog, Empty, EsqueletoLista, Field, Opciones } from '@/components/ui';
import { CANAL, MOTIVOS_DE_CIERRE, RESULTADO, type Contacto } from '@/components/seguimiento';
import { Coincidencias, useIdentidad } from '@/components/captacion/identidad';
import { direccionInestable } from '@/components/alta-enlace';

type Prospecto = Prospect;
const nombreDe = (p: Pick<Prospecto, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;
const sinLada = (t: string | null | undefined) => (t ?? '').replace(/^\+52/, '');

/** A quién encontró el servidor al registrar (409 `PROSPECT_ALREADY_OPEN` o `ALREADY_MEMBER`). */
type YaExiste = { kind: 'PROSPECT' | 'MEMBER' | 'FORMER_MEMBER'; id: string | null; fullName: string; branchId: string | null };

/**
 * «NUEVO PROSPECTO» y «CORREGIR DATOS» (bloque 2.4; 10-07, 10-12, 10-17).
 *
 * El celular va primero: con sus diez dígitos ya se sabe si la persona es
 * socio, fue socio, está en seguimiento o tiene un alta por revisar, y la
 * tarjeta lleva a donde se atiende. «¿Cómo se enteró?» sale de la lista de la
 * gerencia y, si fue por recomendación, se anota de quién. «¿Qué sigue?» deja
 * al interesado con su próximo paso desde el registro; sin él, nace en «Sin
 * contactar», que es la primera cola del día.
 */
export function ProspectoDialog({ editar, fuentes, onClose, onListo }: {
  /** Con un interesado: corregir lo que se capturó. Sin él: registrar uno nuevo. */
  editar?: Prospecto;
  fuentes: readonly string[];
  onClose: () => void; onListo: () => void;
}) {
  const toast = useToast();
  const { branches, inScope, org, can } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const hoy = hoyEn(org.timezone);
  const [tel, setTel] = useState(sinLada(editar?.phoneE164));
  // El plan que preguntó (D-31): la venta abre con él. '' = todavía no sabe.
  const [planDeInteres, setPlanDeInteres] = useState(editar?.interestPlanId ?? '');
  const [nombre, setNombre] = useState(editar?.firstName ?? '');
  const [apellido, setApellido] = useState(editar?.lastName ?? '');
  const [email, setEmail] = useState(editar?.email ?? '');
  const [fuente, setFuente] = useState<string | null>(editar?.source ?? null);
  const [recomendo, setRecomendo] = useState(editar?.referredByName ?? '');
  const [proximo, setProximo] = useState('');
  const [nota, setNota] = useState(editar?.notes ?? '');
  const [sede, setSede] = useState(editar?.branchId ?? sedes[0]?.id ?? '');
  const [fallo, setFallo] = useState<string | null>(null);
  const [yaExiste, setYaExiste] = useState<YaExiste | null>(null);
  // Al corregir no se vuelve a preguntar si existe: es el mismo interesado.
  const { people } = useIdentidad({ firstName: nombre, lastName: apellido, phone: tel, email }, { apagado: !!editar });
  // La fuente que ya tenía se conserva aunque la gerencia la haya quitado de la lista.
  const opciones = fuente && !fuentes.includes(fuente) ? [...fuentes, fuente] : fuentes;
  // Los planes que vende SU sucursal, con el precio de lista de ahí: lo mismo que ve quien escanea el cartel.
  const verPlanes = can('catalog:read');
  const cargarPlanes = useCallback(() => api<Plan[]>(`/plans?branchId=${sede}`).then((ps) => ps.filter((p) => p.effectivePriceCents !== null)), [sede]);
  const planes = useCarga(verPlanes && sede ? cargarPlanes : null).datos ?? null;
  // Al cambiar de sucursal, un plan que la nueva no vende deja de estar elegido.
  useEffect(() => {
    if (planes && planDeInteres && planDeInteres !== editar?.interestPlanId && !planes.some((p) => p.id === planDeInteres)) setPlanDeInteres('');
  }, [planes, planDeInteres, editar?.interestPlanId]);
  // El que ya tenía anotado se conserva en la lista aunque ya no se venda.
  const anotadoFuera = editar?.interestPlanId && planes && !planes.some((p) => p.id === editar.interestPlanId) ? editar : null;

  // El botón queda encendido: lo que falta se dice en su campo y el foco va ahí (26-02).
  const f = useFormulario({
    contacto: !tel.trim() && !email.trim() && 'Escribe su celular o su correo: con uno basta.',
    nombre: !nombre.trim() && 'Escribe su nombre.',
    apellido: !apellido.trim() && 'Escribe sus apellidos.',
    sede: !sede && 'No tienes una sucursal abierta donde registrarlo.',
  }, { obligatorios: ['nombre', 'apellido'] });

  async function guardar(force = false) {
    setFallo(null);
    const comun = {
      firstName: nombre.trim(), lastName: apellido.trim(),
      ...(fuente ? { source: fuente } : {}),
    };
    try {
      if (editar) {
        await api(`/prospects/${editar.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...comun, phoneE164: tel.trim() || null, email: email.trim() || null, source: fuente,
            referredByName: fuente === REFERRAL_SOURCE ? recomendo.trim() || null : null, notes: nota.trim() || null,
            // Solo si lo cambió: un plan anotado que ya no se vende se queda como está.
            ...(planDeInteres !== (editar.interestPlanId ?? '') ? { interestPlanId: planDeInteres || null } : {}),
          }),
        });
        toast('ok', 'Datos corregidos.');
      } else {
        await api('/prospects', {
          method: 'POST',
          body: JSON.stringify({
            ...comun, branchId: sede,
            ...(tel.trim() ? { phoneE164: tel.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}),
            ...(fuente === REFERRAL_SOURCE && recomendo.trim() ? { referredByName: recomendo.trim() } : {}),
            ...(proximo ? { nextStepOn: proximo } : {}), ...(nota.trim() ? { notes: nota.trim() } : {}),
            ...(planDeInteres ? { interestPlanId: planDeInteres } : {}),
            ...(force ? { force: true } : {}),
          }),
        });
        toast('ok', 'Prospecto registrado');
      }
      onListo();
    } catch (e) {
      const existente = e instanceof ApiError && e.status === 409 ? (e.data?.existing as YaExiste | undefined) : undefined;
      if (existente) { setYaExiste(existente); return; }
      const porCampo = erroresPorCampo(e);
      f.marcar({ ...(porCampo.phoneE164 || porCampo.email ? { contacto: porCampo.phoneE164 ?? porCampo.email } : {}), ...(porCampo.firstName ? { nombre: porCampo.firstName } : {}), ...(porCampo.lastName ? { apellido: porCampo.lastName } : {}) });
      setFallo(errorText(e, editar ? 'No se pudo guardar' : 'No se pudo registrar'));
    }
  }

  // El servidor encontró a la misma persona: se dice quién es y a dónde ir, antes que registrar otra vez.
  if (yaExiste) {
    const esSocio = yaExiste.kind !== 'PROSPECT';
    return (
      <Dialog open onClose={onClose} title={esSocio ? `${yaExiste.fullName} ${yaExiste.kind === 'MEMBER' ? 'ya es socio' : 'fue socio'}` : `${yaExiste.fullName} ya está en seguimiento`}
        sub="Mismo contacto y mismo nombre. Una persona, un registro: así no se le llama dos veces ni pierde su historia."
        footer={<>
          <Button variant="secondary" onClick={() => setYaExiste(null)}>Volver</Button>
          <Button variant="ghost" loading={f.enviando} onClick={() => void f.enviar(() => guardar(true))}>Es otra persona: registrar</Button>
          {yaExiste.id && (esSocio
            ? <Link className="btn btn-primary" href={`/socios/${yaExiste.id}`}>{yaExiste.kind === 'MEMBER' ? 'Ver su ficha' : 'Abrir su ficha'}</Link>
            : <Link className="btn btn-primary" href={`/prospectos?q=${encodeURIComponent(yaExiste.fullName)}`} onClick={onClose}>Abrirlo</Link>)}
        </>}>
        <Callout tone="warn" title={TIPO_DE_PERSONA[yaExiste.kind]}>
          {yaExiste.kind === 'FORMER_MEMBER' ? 'Se reactiva su ficha (conserva su historial y su antigüedad); no se registra como interesado.'
            : yaExiste.kind === 'MEMBER' ? 'Atiéndelo desde su ficha.'
            : yaExiste.id ? 'Ábrelo y anota ahí este contacto.'
            : `Lo atienden en ${branches.find((b) => b.id === yaExiste.branchId)?.name ?? 'otra sucursal'}: avísales que preguntó aquí.`}
        </Callout>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={editar ? `Corregir los datos de ${nombreDe(editar)}` : 'Nuevo prospecto'} error={fallo}
      sub={editar ? 'Es lo que se capturó de un interesado, no la ficha de un socio. Su etapa sale de los contactos.' : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={f.enviando} onClick={() => void f.enviar(() => guardar())}>{editar ? 'Guardar' : 'Registrar'}</Button></>}>
      <div className="stack">
        <div className="grid grid-2 gap-12">
          <Field label="Celular" htmlFor="pp-t" error={f.error('contacto')} hint="Celular o correo: con uno basta."><input id="pp-t" className="input" inputMode="tel" autoFocus value={tel} onChange={(e) => { setTel(e.target.value); f.limpiar('contacto'); }} placeholder="10 dígitos" aria-invalid={!!f.error('contacto')} /></Field>
          <Field label="Correo" htmlFor="pp-e"><input id="pp-e" className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); f.limpiar('contacto'); }} /></Field>
        </div>
        {/* ¿Ya existe? Antes de seguir capturando (10-07). */}
        <Coincidencias people={people} alAbrir={onClose} />
        <div className="grid grid-2 gap-12">
          <Field label="Nombre" htmlFor="pp-n" {...f.campo('nombre')}><input id="pp-n" className="input" value={nombre} onChange={(e) => { setNombre(e.target.value); f.limpiar('nombre'); }} aria-invalid={!!f.error('nombre')} /></Field>
          <Field label="Apellidos" htmlFor="pp-a" {...f.campo('apellido')}><input id="pp-a" className="input" value={apellido} onChange={(e) => { setApellido(e.target.value); f.limpiar('apellido'); }} aria-invalid={!!f.error('apellido')} /></Field>
        </div>
        <div>
          <p className="label mb-8" id="pp-fuente">¿Cómo se enteró?</p>
          <Opciones forma="chips" etiquetadaPor="pp-fuente" value={fuente} onChange={setFuente} opciones={opciones.map((x) => ({ value: x, label: x }))} />
        </div>
        {fuente === REFERRAL_SOURCE && (
          <Field label="¿Quién lo recomendó?" htmlFor="pp-r" hint="Como lo diga: después se le puede agradecer."><input id="pp-r" className="input" value={recomendo} maxLength={120} onChange={(e) => setRecomendo(e.target.value)} placeholder="Juan Pérez, el de las 7 am" /></Field>
        )}
        {!editar && (
          <Field label="¿Qué sigue?" htmlFor="pp-q" hint="Con fecha queda en «Esperando» hasta ese día. Sin fecha, queda en «Sin contactar».">
            <CampoFecha id="pp-q" value={proximo} onChange={setProximo} min={hoy} hoy={hoy} atajos={[1, 3, 7]} />
          </Field>
        )}
        {!editar && sedes.length > 1 && (
          <Field label="Sucursal" htmlFor="pp-s"><select id="pp-s" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>{sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        )}
        {verPlanes && (planes?.length || anotadoFuera) ? (
          <Field label="¿Qué plan le interesa?" htmlFor="pp-plan" hint="Con su precio de lista en esta sucursal. Al inscribirlo, la venta abre con este plan.">
            <select id="pp-plan" className="select" value={planDeInteres} onChange={(e) => setPlanDeInteres(e.target.value)}>
              <option value="">Todavía no sabe</option>
              {(planes ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {pesos(p.effectivePriceCents ?? p.priceCents, { decimals: false })} {porPeriodo(p)}</option>)}
              {anotadoFuera && <option value={anotadoFuera.interestPlanId!}>{anotadoFuera.interestPlanName ?? 'Un plan'} (ya no se vende aquí)</option>}
            </select>
          </Field>
        ) : null}
        <Field label="Nota" htmlFor="pp-no"><input id="pp-no" className="input" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} placeholder="Busca horario nocturno; le interesa spinning" /></Field>
        {f.error('sede') && <Callout tone="danger">{f.error('sede')}</Callout>}
      </div>
    </Dialog>
  );
}

/**
 * «¿{nombre} ya no se va a inscribir?» (10-09): cerrar pide el porqué, de una
 * lista corta. Con eso el gimnasio sabe si pierde por precio, por horario o
 * porque le queda lejos.
 */
export function CerrarDialog({ prospecto, onClose, onListo }: { prospecto: Prospecto; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const pideTexto = !!MOTIVOS_DE_CIERRE.find((m) => m.codigo === motivo)?.pideTexto;
  const f = useFormulario({
    motivo: !motivo && 'Elige un motivo.',
    nota: pideTexto && nota.trim().length < 3 && 'Escribe el motivo.',
  });
  async function cerrar() {
    setFallo(null);
    try {
      await api(`/prospects/${prospecto.id}/close`, { method: 'POST', body: JSON.stringify({ reasonCode: motivo, ...(nota.trim() ? { note: nota.trim() } : {}) }) });
      toast('ok', `${prospecto.firstName} pasa a Cerrados.`);
      onListo();
    } catch (e) { setFallo(errorText(e, 'No se pudo cerrar')); }
  }
  return (
    <Dialog open onClose={onClose} title={`¿${nombreDe(prospecto)} ya no se va a inscribir?`} error={fallo}
      sub="Sale de seguimiento y pasa a Cerrados. Si vuelve, lo reabres desde ahí."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(cerrar)}>Marcar como perdido</Button></>}>
      <div className="stack">
        <div>
          <p className="label mb-8" id="pc-motivo">¿Por qué? <span className="field-req" aria-hidden>*</span></p>
          <Opciones forma="chips" etiquetadaPor="pc-motivo" value={motivo} onChange={setMotivo}
            opciones={MOTIVOS_DE_CIERRE.map((m) => ({ value: m.codigo, label: m.texto }))} />
          {f.error('motivo') && <p className="field-error mt-6" role="alert">{f.error('motivo')}</p>}
        </div>
        <Field label={pideTexto ? 'Cuál' : 'Nota (opcional)'} htmlFor="pc-nota" error={f.error('nota')}>
          <input id="pc-nota" className="input" value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} aria-invalid={!!f.error('nota')} />
        </Field>
        <p className="small muted">No se borra nada: queda en la lista de Cerrados con su historial y el motivo.</p>
      </div>
    </Dialog>
  );
}

/** El historial de contactos (10-12): antes solo se veía el último y «· 3 contactos» no abría nada. */
export function HistorialDialog({ prospecto, onClose }: { prospecto: Prospecto; onClose: () => void }) {
  const cargar = useCallback(() => api<{ followUps: Contacto[] }>(`/prospects/${prospecto.id}/follow-ups`), [prospecto.id]);
  const carga = useCarga(cargar);
  return (
    <Dialog open onClose={onClose} title={`Contactos con ${nombreDe(prospecto)}`} sub="Del más reciente al más antiguo, con quién lo hizo."
      footer={<Button onClick={onClose}>Cerrar</Button>}>
      <EstadoCarga carga={carga} titulo="No se pudo cargar el historial" esVacio={(d) => d.followUps.length === 0}
        esqueleto={<EsqueletoLista filas={3} />} vacio={<Empty icon={<MessageCircle />} title="Nadie lo ha contactado todavía" />}>
        {(d) => (
          <ul className="list" data-testid="historial-de-contactos">
            {d.followUps.map((c) => (
              <li key={c.id} className="list-item">
                <div className="flex-1 min-w-0">
                  <div className="small"><span className="strong">{RESULTADO[c.outcome] ?? c.outcome}</span> · {CANAL[c.channel]?.label ?? c.channel}</div>
                  {c.note && <div className="small">{c.note}</div>}
                  <div className="tiny muted">{fechaHora(c.createdAt)}{c.createdByName ? ` · ${c.createdByName}` : ''}{c.nextStepOn ? ` · próximo paso: ${fecha(c.nextStepOn)}` : ''}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </EstadoCarga>
    </Dialog>
  );
}

/**
 * «MANDAR ALTA DIGITAL» (10-10): el enlace del formulario de SU sucursal por
 * WhatsApp, con el mensaje a la vista, y el contacto queda anotado solo. El
 * interesado lo llena en su casa y al aprobar su alta deja de estar en
 * seguimiento sin que nadie lo cierre a mano.
 */
export function MandarAltaDialog({ prospecto, onClose, onListo }: { prospecto: Prospecto; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const portal = usePortalUrl();
  const { branches, org } = useSession();
  const sede = branches.find((b) => b.id === prospecto.branchId);
  const url = enlaceAlta(portal, sede?.publicSlug || prospecto.branchId);
  const mensaje = `Hola ${prospecto.firstName}, te escribimos de ${org.tradeName}${sede ? ` (${sede.name})` : ''}. Aquí puedes dejar tus datos para inscribirte, tarda 2 minutos: ${url}`;
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  /** Anota «Se le mandó el alta digital» con próximo paso en dos días: a ver si la llenó. */
  async function anotar(canal: 'WHATSAPP' | 'OTHER') {
    // Un segundo toque mientras se anota no deja dos contactos.
    if (enviando) return;
    setEnviando(true); setFallo(null);
    try {
      await api(`/prospects/${prospecto.id}/follow-ups`, {
        method: 'POST', body: JSON.stringify({ channel: canal, outcome: 'INTAKE_SENT', nextStepOn: masDias(hoyEn(org.timezone), 2) }),
      });
      toast('ok', `Quedó anotado que se le mandó el alta a ${prospecto.firstName}.`);
      onListo();
    } catch (e) { setFallo(errorText(e, 'No se pudo anotar el contacto')); } finally { setEnviando(false); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(mensaje); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { setFallo('No se pudo copiar; selecciona el mensaje y cópialo a mano.'); }
  }
  useEffect(() => { setCopiado(false); }, [mensaje]);

  return (
    <Dialog open onClose={onClose} title={`Mandar el alta digital a ${prospecto.firstName}`} error={fallo}
      sub="Lo llena en su teléfono; cuando aprueben su alta sale solo de seguimiento."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="ghost" icon={copiado ? <Check /> : <Copy />} onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar mensaje'}</Button>
        {prospecto.phoneE164
          // Abre WhatsApp con el mensaje escrito y, en el mismo toque, anota el contacto.
          ? <a className="btn btn-primary" href={`https://wa.me/${prospecto.phoneE164.replace('+', '')}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer"
              aria-disabled={enviando} onClick={() => void anotar('WHATSAPP')}><MessageCircle />Abrir WhatsApp</a>
          : <Button loading={enviando} onClick={() => void anotar('OTHER')}>Ya se lo mandé</Button>}
      </>}>
      <div className="stack">
        {direccionInestable(url) && (
          <Callout tone="warn" title="Este enlace todavía no sirve fuera del gimnasio">
            La dirección del portal es de este equipo o cambia al reiniciar. Sirve si lo abre aquí, conectado a la misma red.
          </Callout>
        )}
        <div className="mensaje-previo" data-testid="mensaje-alta">{mensaje}</div>
        <p className="hint">
          {prospecto.phoneE164 ? <>Se manda al {telefono(prospecto.phoneE164)}. </> : <>No tiene celular: copia el mensaje y mándalo a {prospecto.email ?? 'su correo'}. </>}
          Queda anotado como contacto, con próximo paso en dos días para ver si lo llenó.
        </p>
      </div>
    </Dialog>
  );
}

/** «¿Cómo se enteró?»: la lista la arma la gerencia (10-17). Una fuente por renglón. */
export function FuentesDialog({ actuales, onClose, onListo }: { actuales: ProspectSources; onClose: () => void; onListo: (s: ProspectSources) => void }) {
  const toast = useToast();
  const [texto, setTexto] = useState(actuales.sources.join('\n'));
  const [fallo, setFallo] = useState<string | null>(null);
  const lista = texto.split('\n').map((x) => x.trim()).filter(Boolean);
  const f = useFormulario({ lista: lista.length === 0 ? 'Deja al menos una fuente.' : lista.some((x) => x.length < 2 || x.length > 60) && 'Cada fuente lleva entre 2 y 60 letras.' });
  async function guardar() {
    setFallo(null);
    try {
      const r = await api<ProspectSources>('/prospects/sources', { method: 'PUT', body: JSON.stringify({ sources: lista }) });
      toast('ok', 'Lista de «¿Cómo se enteró?» actualizada.');
      onListo(r);
    } catch (e) { setFallo(errorText(e, 'No se pudo guardar la lista')); }
  }
  return (
    <Dialog open onClose={onClose} title="¿Cómo se enteró?" error={fallo}
      sub="Lo que recepción elige al registrar a un interesado. Quien ya está registrado conserva la suya."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={f.enviando} onClick={() => void f.enviar(guardar)}>Guardar lista</Button></>}>
      <Field label="Fuentes" htmlFor="pf-lista" error={f.error('lista')}
        hint={<>Una por renglón, en el orden en que quieres verlas. «{REFERRAL_SOURCE}» pregunta además quién lo recomendó.</>}>
        <textarea id="pf-lista" className="textarea" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} aria-invalid={!!f.error('lista')} />
      </Field>
    </Dialog>
  );
}
