'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ImagePlus, Inbox, Pencil, X } from 'lucide-react';
import type { PlatformBrand, PlatformChangeRequest, PlatformChangeRequestList } from '@gymflow/core/contracts';
import { DATO_DEL_GIMNASIO, ESTADO_DE_SOLICITUD_DE_CAMBIO } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { fecha, hace, telefono } from '@/lib/format';
import { useFormulario } from '@/lib/formulario';
import { AYUDA_DE_DATO, LOGO_MAX_KB, esTelefono, leerLogo, valorDeDato } from '@/lib/datos-y-marca';
import { useToast, errorText } from '@/components/session';
import { Badge, Button, CampoMotivo, Card, Dialog, ErrorCarga, Field, Skeleton } from '@/components/ui';

type Sede = PlatformBrand['branches'][number];
const SinDato = () => <span className="muted">Sin registrar</span>;

/** Lo que el gimnasio pidió, en una línea. */
function loPedido(s: PlatformChangeRequest): string {
  if (s.field === 'LOGO') return s.proposedLogo ? 'Logo nuevo (imagen)' : 'Quitar el logo';
  if (s.field === 'OTHER') return s.proposedValue ?? '';
  return s.proposedValue ? valorDeDato(s.field, s.proposedValue) : 'Quitar el dato';
}

/** El campo para elegir (o quitar) un logo: lo usan «Editar datos y marca» y «Aplicar» una solicitud de logo. */
function CampoLogo({ id, valor, onChange, onError }: { id: string; valor: string | null; onChange: (logo: string | null) => void; onError: (texto: string | null) => void }) {
  const archivo = useRef<HTMLInputElement>(null);
  async function elegir(file: File | undefined) {
    if (!file) return;
    try { onChange(await leerLogo(file)); onError(null); } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo leer el archivo.'); }
  }
  return (
    <Field label="Logo" htmlFor={id} hint={`PNG, JPG o WebP de hasta ${LOGO_MAX_KB} KB. Sale arriba del recibo.`}>
      <div className="row gap-12 flex-wrap items-center">
        {/* El logo viene como data:, no es una imagen del sitio */}
        {valor ? <img src={valor} alt="Logo" className="logo-marca" /> : <span className="small muted">Sin logo</span>}
        <input ref={archivo} id={id} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Imagen del logo" onChange={(e) => void elegir(e.target.files?.[0])} />
        <Button variant="secondary" size="sm" icon={<ImagePlus />} onClick={() => archivo.current?.click()}>{valor ? 'Cambiar imagen' : 'Elegir imagen'}</Button>
        {valor && <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Quitar logo</Button>}
      </div>
    </Field>
  );
}

/**
 * LA FICHA DE MARCA (D-27, opción d · bloque 4.6). El gimnasio no cambia nada
 * de esto desde su panel: RFC, logo, teléfonos, leyenda del recibo y el
 * teléfono y horario de cada sucursal se editan aquí, con motivo, y quedan en
 * la bitácora de la marca. Debajo, lo que el gimnasio PIDIÓ cambiar: cada
 * solicitud se aplica (tal cual o ajustada) o se rechaza con respuesta, y
 * quien la pidió lo ve en su panel. Nombre comercial y razón social siguen en
 * «Editar marca».
 */
export function FichaDeMarca({ organizationId, version, onCambio }: { organizationId: string; version: string; onCambio: () => void }) {
  const toast = useToast();
  const [ficha, setFicha] = useState<PlatformBrand | null | 'error'>(null);
  const [editar, setEditar] = useState(false);
  const [sede, setSede] = useState<Sede | null>(null);
  const [aplicar, setAplicar] = useState<PlatformChangeRequest | null>(null);
  const [rechazar, setRechazar] = useState<PlatformChangeRequest | null>(null);
  const cargar = useCallback(() => {
    api<PlatformBrand>(`/platform/organizations/${organizationId}/brand`).then(setFicha).catch(() => setFicha('error'));
  }, [organizationId]);
  // `version` cambia cuando la ficha de arriba se edita («Editar marca»): se vuelve a leer.
  useEffect(cargar, [cargar, version]);
  const hecho = (mensaje: string) => { setEditar(false); setSede(null); setAplicar(null); setRechazar(null); toast('ok', mensaje); cargar(); onCambio(); };

  if (ficha === null) return <Card title="Datos y marca"><Skeleton h={140} /></Card>;
  if (ficha === 'error') return <ErrorCarga mensaje="No se pudo cargar la ficha de marca." onReintentar={() => { setFicha(null); cargar(); }} />;
  const pendientes = ficha.requests.filter((s) => s.status === 'PENDING');
  const resueltas = ficha.requests.filter((s) => s.status !== 'PENDING').slice(0, 10);

  return (
    <div className="grid grid-2 plat-arriba" id="marca">
      <Card title="Datos y marca" data-testid="ficha-de-marca"
        sub="El gimnasio no los cambia desde su panel: se editan aquí, con motivo. Nombre comercial y razón social, en «Editar marca»."
        actions={<Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditar(true)}>Editar datos y marca</Button>}>
        <dl className="kv">
          <dt>RFC</dt><dd>{ficha.rfc ?? <SinDato />}</dd>
          <dt>Logo</dt>
          {/* El logo viene como data: desde la API */}
          <dd>{ficha.logo ? <img src={ficha.logo} alt={`Logo de ${ficha.tradeName}`} className="logo-marca" /> : <SinDato />}</dd>
          <dt>Teléfono</dt><dd>{ficha.phone ? telefono(ficha.phone) : <SinDato />}</dd>
          <dt>WhatsApp</dt><dd>{ficha.whatsapp ? telefono(ficha.whatsapp) : <SinDato />}</dd>
          <dt>Leyenda del recibo</dt><dd>{ficha.receiptLegend ?? <SinDato />}</dd>
        </dl>
        <p className="label mt-12 mb-8">Teléfono y horario de cada sucursal</p>
        <ul className="list" data-testid="marca-sucursales">
          {ficha.branches.map((b) => (
            <li key={b.id} className="list-item">
              <div className="flex-1 min-w-0">
                <p className="strong small">{b.name} <span className="muted">· {b.code}{b.isActive ? '' : ' · cerrada'}</span></p>
                <p className="small">{b.phone ? telefono(b.phone) : <span className="muted">Sin teléfono</span>} · {b.openingHours ?? <span className="muted">Sin horario</span>}</p>
              </div>
              <Button size="sm" variant="ghost" icon={<Pencil />} aria-label={`Editar teléfono y horario de ${b.name}`} onClick={() => setSede(b)}>Editar</Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={<span className="row gap-8">Solicitudes de cambio {pendientes.length > 0 && <Badge tone="warn">{pendientes.length}</Badge>}</span>} data-testid="solicitudes-de-cambio" pad={ficha.requests.length === 0}
        sub="Lo que el gimnasio pidió cambiar desde «Mi gimnasio». Quien la pidió ve tu respuesta en su panel.">
        {ficha.requests.length === 0 ? <p className="small muted">Este gimnasio no ha pedido ningún cambio.</p> : (
          <ul className="list">
            {[...pendientes, ...resueltas].map((s) => {
              const estado = ESTADO_DE_SOLICITUD_DE_CAMBIO[s.status]!;
              return (
                <li key={s.id} className="list-item" data-solicitud={s.status}>
                  <div className="flex-1 min-w-0">
                    <p className="row gap-8 flex-wrap"><span className="strong small">{DATO_DEL_GIMNASIO[s.field] ?? s.field}{s.branchName ? ` · ${s.branchName}` : ''}</span><Badge tone={estado.tone} dot>{estado.label}</Badge></p>
                    <p className="small">{loPedido(s)}</p>
                    <p className="tiny muted">{s.requestedBy.fullName} · {fecha(s.requestedAt)} · «{s.reason}»</p>
                    {s.status !== 'PENDING' && <p className="tiny muted">Respuesta{s.resolvedAt ? ` del ${fecha(s.resolvedAt)}` : ''}: {s.response ?? 'aplicada como se pidió'} · {s.seenAt ? 'ya la vio' : 'todavía no la ve'}</p>}
                  </div>
                  {s.status === 'PENDING' && (
                    <span className="row gap-6">
                      <Button size="sm" icon={<Check />} onClick={() => setAplicar(s)}>Aplicar</Button>
                      <Button size="sm" variant="danger-ghost" icon={<X />} onClick={() => setRechazar(s)}>Rechazar</Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editar && <EditarFicha ficha={ficha} onClose={() => setEditar(false)} onHecho={() => hecho('Datos y marca actualizados.')} />}
      {sede && <EditarSede organizationId={organizationId} sede={sede} onClose={() => setSede(null)} onHecho={() => hecho(`${sede.name}: teléfono y horario actualizados.`)} />}
      {aplicar && <AplicarSolicitud solicitud={aplicar} logoDeHoy={ficha.logo} onClose={() => setAplicar(null)} onHecho={() => hecho('Cambio aplicado: quien lo pidió ya lo ve en su panel.')} />}
      {rechazar && <RechazarSolicitud solicitud={rechazar} onClose={() => setRechazar(null)} onHecho={() => hecho('Solicitud rechazada: quien la pidió ya ve tu respuesta.')} />}
    </div>
  );
}

function EditarFicha({ ficha, onClose, onHecho }: { ficha: PlatformBrand; onClose: () => void; onHecho: () => void }) {
  const [v, setV] = useState({ rfc: ficha.rfc ?? '', phone: ficha.phone ? telefono(ficha.phone) : '', whatsapp: ficha.whatsapp ? telefono(ficha.whatsapp) : '', receiptLegend: ficha.receiptLegend ?? '' });
  const [logo, setLogo] = useState<string | null>(ficha.logo);
  const [motivo, setMotivo] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  // Solo viaja lo que cambió: lo demás no se toca ni aparece en la bitácora.
  const cambios: Record<string, string | null> = {};
  if (v.rfc.trim() !== (ficha.rfc ?? '')) cambios.rfc = v.rfc.trim() || null;
  if (v.phone.trim() !== (ficha.phone ? telefono(ficha.phone) : '')) cambios.phone = v.phone.trim() || null;
  if (v.whatsapp.trim() !== (ficha.whatsapp ? telefono(ficha.whatsapp) : '')) cambios.whatsapp = v.whatsapp.trim() || null;
  if (v.receiptLegend.trim() !== (ficha.receiptLegend ?? '')) cambios.receiptLegend = v.receiptLegend.trim() || null;
  if (logo !== ficha.logo) cambios.logo = logo;
  const f = useFormulario({ motivo: motivo.trim().length < 3 ? 'Escribe el motivo: queda en la bitácora de la marca.' : null }, { obligatorios: ['motivo'] });
  const guardar = () => f.enviar(async () => {
    if (Object.keys(cambios).length === 0) { setFallo('No cambiaste ningún dato.'); return; }
    setFallo(null);
    try {
      await api(`/platform/organizations/${ficha.organizationId}/brand`, { method: 'PUT', body: JSON.stringify({ ...cambios, reason: motivo.trim() }) });
      onHecho();
    } catch (e) { setFallo(errorText(e, 'No se pudo guardar')); }
  });
  return (
    <Dialog open onClose={onClose} title={`Datos y marca de ${ficha.tradeName}`} sub="Lo que el gimnasio ve en «Mi gimnasio» y en su recibo. Deja un campo vacío para quitar el dato." error={fallo}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={f.enviando} onClick={() => void guardar()}>Guardar datos</Button></>}>
      <div className="stack">
        <div className="grid grid-2">
          <Field label="RFC" htmlFor="fm-rfc" hint={AYUDA_DE_DATO.RFC}><input id="fm-rfc" className="input" maxLength={20} value={v.rfc} onChange={(e) => setV({ ...v, rfc: e.target.value })} /></Field>
          <Field label="Teléfono del gimnasio" htmlFor="fm-tel" hint="Los 10 dígitos."><input id="fm-tel" className="input" type="tel" inputMode="tel" maxLength={30} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <Field label="WhatsApp del gimnasio" htmlFor="fm-wa" hint="Los 10 dígitos."><input id="fm-wa" className="input" type="tel" inputMode="tel" maxLength={30} value={v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value })} /></Field>
        </div>
        <Field label="Leyenda del recibo" htmlFor="fm-ley" hint={AYUDA_DE_DATO.RECEIPT_LEGEND}><textarea id="fm-ley" className="textarea" rows={2} maxLength={300} value={v.receiptLegend} onChange={(e) => setV({ ...v, receiptLegend: e.target.value })} /></Field>
        <CampoLogo id="fm-logo" valor={logo} onChange={setLogo} onError={setFallo} />
        <CampoMotivo id="fm-motivo" value={motivo} onChange={setMotivo} error={f.error('motivo')} hint="Queda en la bitácora de la marca." motivos={['Lo pidió el dueño por teléfono', 'Alta de la marca', 'Estaba mal capturado']} />
      </div>
    </Dialog>
  );
}

function EditarSede({ organizationId, sede, onClose, onHecho }: { organizationId: string; sede: Sede; onClose: () => void; onHecho: () => void }) {
  const [tel, setTel] = useState(sede.phone ? telefono(sede.phone) : '');
  const [horario, setHorario] = useState(sede.openingHours ?? '');
  const [motivo, setMotivo] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const cambios: Record<string, string | null> = {};
  if (tel.trim() !== (sede.phone ? telefono(sede.phone) : '')) cambios.phone = tel.trim() || null;
  if (horario.trim() !== (sede.openingHours ?? '')) cambios.openingHours = horario.trim() || null;
  const f = useFormulario({ motivo: motivo.trim().length < 3 ? 'Escribe el motivo: queda en la bitácora de la marca.' : null }, { obligatorios: ['motivo'] });
  const guardar = () => f.enviar(async () => {
    if (Object.keys(cambios).length === 0) { setFallo('No cambiaste ningún dato.'); return; }
    setFallo(null);
    try {
      await api(`/platform/organizations/${organizationId}/branches/${sede.id}/contact`, { method: 'PUT', body: JSON.stringify({ ...cambios, reason: motivo.trim() }) });
      onHecho();
    } catch (e) { setFallo(errorText(e, 'No se pudo guardar')); }
  });
  return (
    <Dialog open onClose={onClose} title={`Teléfono y horario de ${sede.name}`} sub="El nombre, la dirección y la zona de la sucursal los cambia la gerencia del gimnasio." error={fallo}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={f.enviando} onClick={() => void guardar()}>Guardar datos</Button></>}>
      <div className="stack">
        <Field label="Teléfono de la sucursal" htmlFor="fs-tel" hint="Los 10 dígitos. Vacío para quitarlo."><input id="fs-tel" className="input" type="tel" inputMode="tel" maxLength={30} value={tel} onChange={(e) => setTel(e.target.value)} /></Field>
        <Field label="Horario" htmlFor="fs-hor" hint={AYUDA_DE_DATO.BRANCH_HOURS}><textarea id="fs-hor" className="textarea" rows={2} maxLength={300} value={horario} onChange={(e) => setHorario(e.target.value)} /></Field>
        <CampoMotivo id="fs-motivo" value={motivo} onChange={setMotivo} error={f.error('motivo')} hint="Queda en la bitácora de la marca." motivos={['Lo pidió el dueño por teléfono', 'Cambio de horario', 'Alta de la sucursal']} />
      </div>
    </Dialog>
  );
}

/** Aplicar: se ve lo de hoy y lo pedido; el valor se puede ajustar antes de guardarlo. «Otro dato» no se aplica solo. */
function AplicarSolicitud({ solicitud: s, logoDeHoy, onClose, onHecho }: { solicitud: PlatformChangeRequest; logoDeHoy: string | null; onClose: () => void; onHecho: () => void }) {
  const esLogo = s.field === 'LOGO';
  const esOtro = s.field === 'OTHER';
  const [valor, setValor] = useState(s.proposedValue ? (esTelefono(s.field) ? telefono(s.proposedValue) : s.proposedValue) : '');
  const [logo, setLogo] = useState<string | null>(s.proposedLogo);
  const [respuesta, setRespuesta] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const f = useFormulario({ respuesta: esOtro && respuesta.trim().length < 3 ? 'Di qué se cambió: «Otro dato» no se aplica solo.' : null }, { obligatorios: esOtro ? ['respuesta'] : [] });
  const aplicar = () => f.enviar(async () => {
    setFallo(null);
    try {
      await api(`/platform/change-requests/${s.id}/apply`, {
        method: 'POST', body: JSON.stringify({ ...(esOtro ? {} : { value: esLogo ? logo : valor.trim() || null }), response: respuesta.trim() || null }),
      });
      onHecho();
    } catch (e) { setFallo(errorText(e, 'No se pudo aplicar')); }
  });
  return (
    <Dialog open onClose={onClose} title={`Aplicar: ${DATO_DEL_GIMNASIO[s.field] ?? s.field}${s.branchName ? ` · ${s.branchName}` : ''}`} error={fallo}
      sub={`Lo pidió ${s.requestedBy.fullName} de ${s.tradeName}, ${hace(s.requestedAt)}: «${s.reason}»`}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button loading={f.enviando} onClick={() => void aplicar()}>{esOtro ? 'Marcar como aplicada' : 'Aplicar cambio'}</Button></>}>
      <div className="stack" data-testid="aplicar-solicitud">
        {esOtro ? (
          <p>{s.proposedValue}</p>
        ) : esLogo ? (
          <>
            {/* El logo viene como data: desde la API */}
            <p className="small muted row gap-8 items-center">Hoy: {logoDeHoy ? <img src={logoDeHoy} alt="Logo de hoy" className="logo-marca" /> : 'sin logo'}</p>
            <CampoLogo id="as-logo" valor={logo} onChange={setLogo} onError={setFallo} />
          </>
        ) : (
          <>
            <p className="small muted">Hoy: <span className="strong">{valorDeDato(s.field, s.currentValue)}</span></p>
            <Field label="Valor que se guarda" htmlFor="as-valor" hint="Como lo pidió el gimnasio; corrígelo aquí si hace falta. Vacío quita el dato.">
              {s.field === 'RECEIPT_LEGEND' || s.field === 'BRANCH_HOURS'
                ? <textarea id="as-valor" className="textarea" rows={3} maxLength={300} value={valor} onChange={(e) => setValor(e.target.value)} />
                : <input id="as-valor" className="input" maxLength={160} value={valor} onChange={(e) => setValor(e.target.value)} />}
            </Field>
          </>
        )}
        <Field label={esOtro ? 'Qué se cambió' : 'Respuesta para quien la pidió (opcional)'} htmlFor="as-resp" {...f.campo('respuesta')} hint="La lee en su panel.">
          <textarea id="as-resp" className="textarea" rows={2} maxLength={500} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function RechazarSolicitud({ solicitud: s, onClose, onHecho }: { solicitud: PlatformChangeRequest; onClose: () => void; onHecho: () => void }) {
  const [respuesta, setRespuesta] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const f = useFormulario({ respuesta: respuesta.trim().length < 3 ? 'Di por qué no se aplica: quien la pidió lee tu respuesta.' : null }, { obligatorios: ['respuesta'] });
  const rechazar = () => f.enviar(async () => {
    setFallo(null);
    try {
      await api(`/platform/change-requests/${s.id}/reject`, { method: 'POST', body: JSON.stringify({ response: respuesta.trim() }) });
      onHecho();
    } catch (e) { setFallo(errorText(e, 'No se pudo rechazar')); }
  });
  return (
    <Dialog open onClose={onClose} title={`Rechazar: ${DATO_DEL_GIMNASIO[s.field] ?? s.field}${s.branchName ? ` · ${s.branchName}` : ''}`} error={fallo}
      // Bloque 4.16: sin doble punto cuando lo pedido ya termina en punto («…cualquier sucursal.. No cambia…»).
      sub={`Lo pidió ${s.requestedBy.fullName}: ${loPedido(s).replace(/[.\s]+$/, '')}. No cambia ningún dato.`}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button variant="danger" loading={f.enviando} onClick={() => void rechazar()}>Rechazar solicitud</Button></>}>
      <CampoMotivo id="rs-resp" autoFocus value={respuesta} onChange={setRespuesta} error={f.error('respuesta')} label="Respuesta para quien la pidió" maxLength={500}
        hint="La lee en su panel y queda en la bitácora de la marca." motivos={['No coincide con tu constancia fiscal: mándanos la vigente', 'Ya estaba registrado así', 'La imagen no se lee bien: manda otra']} />
    </Dialog>
  );
}

/**
 * EN LA PORTADA DE LA CONSOLA: lo que los gimnasios pidieron cambiar y espera
 * respuesta, de todas las marcas, de lo más viejo a lo más nuevo. Sin
 * pendientes no ocupa lugar.
 */
export function SolicitudesPendientes() {
  const [lista, setLista] = useState<PlatformChangeRequestList | null>(null);
  useEffect(() => {
    // Si no carga, la portada sigue: las solicitudes también están en la ficha de cada marca.
    api<PlatformChangeRequestList>('/platform/change-requests').then(setLista).catch(() => setLista(null));
  }, []);
  if (!lista || lista.pending === 0) return null;
  return (
    <Card pad={false} data-testid="solicitudes-pendientes"
      title={<span className="row gap-8"><Inbox size={16} aria-hidden />Cambios que pidieron los gimnasios <Badge tone="warn">{lista.pending}</Badge></span>}>
      <ul className="list">
        {lista.requests.slice(0, 8).map((s) => (
          <li key={s.id} className="list-item" data-solicitud-pendiente={s.field}>
            <div className="flex-1 min-w-0">
              <p className="small strong">{s.tradeName}</p>
              <p className="small muted">{DATO_DEL_GIMNASIO[s.field] ?? s.field}{s.branchName ? ` · ${s.branchName}` : ''}: {loPedido(s)} · {hace(s.requestedAt)}</p>
            </div>
            <Link href={`/plataforma/${s.organizationId}#marca`} className="btn btn-secondary btn-sm">Ver solicitud</Link>
          </li>
        ))}
        {lista.pending > 8 && <li className="list-item small muted">Y {lista.pending - 8} más, en la ficha de cada marca.</li>}
      </ul>
    </Card>
  );
}
