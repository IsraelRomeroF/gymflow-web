'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Inbox } from 'lucide-react';
import type { GymChangeRequest, GymProfile } from '@gymflow/core/contracts';
import { DATO_DEL_GIMNASIO, ESTADO_DE_SOLICITUD_DE_CAMBIO } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import { useFormulario } from '@/lib/formulario';
import { AYUDA_DE_DATO, DATOS, LOGO_MAX_KB, esDeSucursal, esTelefono, leerLogo, sePuedeQuitar, valorDeDato } from '@/lib/datos-y-marca';
import { errorText } from '@/components/session';
import { Badge, Button, CampoMotivo, Card, Dialog, Empty, Field } from '@/components/ui';

/** El valor de HOY del dato elegido, como lo tiene GymFlow. */
function valorDeHoy(p: GymProfile, dato: string, sedeId: string): string | null {
  const sede = p.brand.branches.find((b) => b.id === sedeId);
  switch (dato) {
    case 'TRADE_NAME': return p.tradeName;
    case 'LEGAL_NAME': return p.legalName;
    case 'RFC': return p.brand.rfc;
    case 'PHONE': return p.brand.phone;
    case 'WHATSAPP': return p.brand.whatsapp;
    case 'RECEIPT_LEGEND': return p.brand.receiptLegend;
    case 'BRANCH_PHONE': return sede?.phone ?? null;
    case 'BRANCH_HOURS': return sede?.openingHours ?? null;
    default: return null;
  }
}

/**
 * «PEDIR UN CAMBIO A GYMFLOW» (D-27, bloque 4.6). Los datos y la marca del
 * gimnasio no se cambian desde el panel: aquí se dice qué dato, cómo debe
 * quedar y por qué, y GymFlow lo aplica o contesta por qué no. Pedirlo no
 * cambia nada todavía.
 */
export function PedirCambio({ perfil, datoInicial, sedeInicial, onClose, onEnviada }: {
  perfil: GymProfile; datoInicial?: string; sedeInicial?: string; onClose: () => void; onEnviada: () => void;
}) {
  const sedes = perfil.brand.branches.filter((b) => b.isActive);
  const [dato, setDato] = useState(datoInicial ?? 'PHONE');
  const [sedeId, setSedeId] = useState(sedeInicial ?? sedes[0]?.id ?? '');
  const [valor, setValor] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const deSede = esDeSucursal(dato);
  const esLogo = dato === 'LOGO';
  const hoy = valorDeHoy(perfil, dato, sedeId);
  const hayHoy = esLogo ? !!perfil.brand.logo : !!hoy;
  const vacio = esLogo ? !logo : valor.trim() === '';
  const f = useFormulario({
    sede: deSede && !sedeId ? 'Elige la sucursal.' : null,
    valor: vacio && !(sePuedeQuitar(dato) && hayHoy) ? (esLogo ? 'Elige la imagen del logo.' : dato === 'OTHER' ? 'Di qué quieres que cambie.' : 'Escribe el valor nuevo.') : null,
    motivo: motivo.trim().length < 3 ? 'Di por qué cambia: GymFlow lo lee antes de aplicarlo.' : null,
  }, { obligatorios: ['motivo'] });

  function cambiarDato(nuevo: string) { setDato(nuevo); setValor(''); setLogo(null); setFallo(null); f.reiniciar(); }
  async function elegirLogo(file: File | undefined) {
    if (!file) return;
    try { setLogo(await leerLogo(file)); setFallo(null); } catch (e) { setLogo(null); setFallo(e instanceof Error ? e.message : 'No se pudo leer el archivo.'); }
  }
  const enviar = () => f.enviar(async () => {
    setFallo(null);
    try {
      await api<GymChangeRequest>('/gym-change-requests', {
        method: 'POST',
        body: JSON.stringify({ field: dato, branchId: deSede ? sedeId : null, value: esLogo ? logo : valor.trim() || null, reason: motivo.trim() }),
      });
      onEnviada();
    } catch (e) { setFallo(errorText(e, 'No se pudo mandar la solicitud')); }
  });

  return (
    <Dialog open onClose={onClose} title="Pedir un cambio a GymFlow" error={fallo}
      sub="Estos datos los lleva GymFlow. Tu solicitud le llega al momento; el dato cambia cuando la aplique y aquí verás su respuesta."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={f.enviando} onClick={() => void enviar()}>Mandar solicitud</Button></>}>
      <div className="stack" data-testid="pedir-cambio">
        <div className="grid grid-2">
          <Field label="Qué dato" htmlFor="pc-dato">
            <select id="pc-dato" className="select" value={dato} onChange={(e) => cambiarDato(e.target.value)}>
              {DATOS.filter((d) => !esDeSucursal(d) || sedes.length > 0).map((d) => <option key={d} value={d}>{DATO_DEL_GIMNASIO[d]}</option>)}
            </select>
          </Field>
          {deSede && (
            <Field label="De qué sucursal" htmlFor="pc-sede" {...f.campo('sede')}>
              <select id="pc-sede" className="select" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
                {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        {dato !== 'OTHER' && (
          <p className="small muted" data-testid="pc-hoy">Hoy: {esLogo ? (perfil.brand.logo ? 'hay un logo registrado' : 'sin logo') : <span className="strong">{valorDeDato(dato, hoy)}</span>}</p>
        )}
        {esLogo ? (
          <Field label="Logo nuevo" htmlFor="pc-logo" error={f.error('valor')} hint={`PNG, JPG o WebP de hasta ${LOGO_MAX_KB} KB. ${hayHoy ? 'Sin imagen, se pide quitar el logo.' : ''}`}>
            <div className="row gap-12 flex-wrap items-center">
              {/* Vista previa de un archivo local (data:), no una imagen del sitio */}
              {logo && <img src={logo} alt="Logo elegido" className="logo-marca" />}
              <input ref={archivo} id="pc-logo" type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Imagen del logo" onChange={(e) => void elegirLogo(e.target.files?.[0])} />
              <Button variant="secondary" size="sm" icon={<ImagePlus />} onClick={() => archivo.current?.click()}>{logo ? 'Elegir otra imagen' : 'Elegir imagen'}</Button>
            </div>
          </Field>
        ) : (
          <Field label={dato === 'OTHER' ? 'Qué quieres que cambie' : 'Valor nuevo'} htmlFor="pc-valor" error={f.error('valor')}
            hint={`${AYUDA_DE_DATO[dato] ?? ''}${sePuedeQuitar(dato) && hayHoy ? ' Déjalo vacío para pedir que se quite.' : ''}`}>
            {dato === 'RECEIPT_LEGEND' || dato === 'BRANCH_HOURS' || dato === 'OTHER'
              ? <textarea id="pc-valor" className="textarea" rows={3} maxLength={dato === 'OTHER' ? 500 : 300} value={valor} onChange={(e) => setValor(e.target.value)} />
              : <input id="pc-valor" className="input" type={esTelefono(dato) ? 'tel' : 'text'} inputMode={esTelefono(dato) ? 'tel' : undefined} maxLength={160} value={valor} onChange={(e) => setValor(e.target.value)} />}
          </Field>
        )}
        <CampoMotivo id="pc-motivo" value={motivo} onChange={setMotivo} error={f.error('motivo')} label="Por qué cambia"
          hint="GymFlow lo lee antes de aplicarlo y queda en la bitácora." motivos={['Cambió el número', 'Estaba mal escrito', 'Cambiamos de horario', 'Logo nuevo']} />
      </div>
    </Dialog>
  );
}

/** Lo que se pidió, en una línea: el valor nuevo, «quitar», o que va una imagen. */
function loPedido(s: GymChangeRequest): string {
  if (s.field === 'LOGO') return s.proposedLogo ? 'Logo nuevo (imagen)' : 'Quitar el logo';
  if (s.field === 'OTHER') return s.proposedValue ?? '';
  return s.proposedValue ? valorDeDato(s.field, s.proposedValue) : 'Quitar el dato';
}

/**
 * LAS SOLICITUDES DEL GIMNASIO A GYMFLOW y en qué va cada una. La respuesta
 * de GymFlow se lee aquí; las que yo pedí y todavía no había visto van
 * marcadas como nuevas.
 */
export function Solicitudes({ solicitudes, onPedir }: { solicitudes: readonly GymChangeRequest[]; onPedir?: (() => void) | undefined }) {
  return (
    <Card title="Solicitudes a GymFlow" sub="Lo que el gimnasio ha pedido cambiar y qué contestó GymFlow." pad={solicitudes.length === 0} data-testid="solicitudes-a-gymflow"
      actions={onPedir ? <Button size="sm" variant="secondary" onClick={onPedir}>Pedir un cambio</Button> : undefined}>
      {solicitudes.length === 0 ? (
        <Empty icon={<Inbox />} title="Sin solicitudes" text="Cuando pidas cambiar un dato, aquí verás si GymFlow ya lo aplicó." />
      ) : (
        <ul className="list">
          {solicitudes.map((s) => {
            const estado = ESTADO_DE_SOLICITUD_DE_CAMBIO[s.status]!;
            return (
              <li key={s.id} className="list-item" data-solicitud={s.status}>
                <div className="flex-1 min-w-0">
                  <p className="row gap-8 flex-wrap">
                    <span className="strong">{DATO_DEL_GIMNASIO[s.field] ?? s.field}{s.branchName ? ` · ${s.branchName}` : ''}</span>
                    <Badge tone={estado.tone} dot>{estado.label}</Badge>
                    {s.mine && s.status !== 'PENDING' && !s.seen && <Badge tone="info">Respuesta nueva</Badge>}
                  </p>
                  <p className="small">{loPedido(s)}</p>
                  <p className="tiny muted">La pidió {s.mine ? 'tú' : s.requestedBy.fullName} el {fecha(s.requestedAt)} · «{s.reason}»</p>
                  {s.status === 'APPLIED' && s.appliedValue && s.appliedValue !== s.proposedValue && <p className="small">Quedó como: <span className="strong">{valorDeDato(s.field, s.appliedValue)}</span></p>}
                  {s.status !== 'PENDING' && (
                    <p className="small" data-testid="respuesta-de-gymflow">
                      <span className="muted">GymFlow{s.resolvedAt ? ` · ${fecha(s.resolvedAt)}` : ''}:</span> {s.response ?? (s.status === 'APPLIED' ? 'Aplicada como la pediste.' : '')}
                    </p>
                  )}
                  {s.status === 'PENDING' && <p className="tiny muted">GymFlow todavía no contesta. El dato sigue como estaba.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
