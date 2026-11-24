'use client';

import { useEffect, useState } from 'react';
import { Ban, Flag, FlagOff, Undo2 } from 'lucide-react';
import type { FlaggedPosSales, OpenCashSessionsLite, PosSale } from '@gymflow/core/contracts';
import { METODO_DE_PAGO, etiqueta } from '@gymflow/core/vocabulario';
import { api, ApiError } from '@/lib/api';
import { fecha, fechaHora, hora, pesos } from '@/lib/format';
import { useSession, useToast, errorText } from '../session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, Field, Skeleton } from '../ui';
import { AutorizacionDialog } from '../autorizacion';

/**
 * CORREGIR UNA VENTA DE LA TIENDA (fase 3, bloque 3.5 · D-13).
 *
 *  · Recepción no anula: la marca «por corregir», con motivo.
 *  · La gerencia la anula el mismo día (si su turno sigue abierto) o, si es
 *    de otro día o su turno ya se cortó, registra su devolución: el dinero
 *    sale del turno abierto (o por transferencia, con referencia), el producto
 *    vuelve al inventario y siempre lo autoriza quien da la segunda firma.
 *
 * `CorregirVenta` va en el ticket de la venta; `VentasPorCorregir`, en Caja.
 */
type Turno = OpenCashSessionsLite['sessions'][number];
type Accion = 'marcar' | 'descartar' | 'anular' | 'devolver';

export function CorregirVenta({ venta, onCambio }: { venta: PosSale; onCambio: (v: PosSale) => void }) {
  const { can } = useSession();
  const [accion, setAccion] = useState<Accion | null>(null);
  const marca = venta.correction?.flag ?? null;
  const devuelta = venta.correction?.returned ?? null;
  const viva = venta.status === 'COMPLETED' && !devuelta;
  const listo = (v: PosSale) => { setAccion(null); onCambio(v); };
  return (
    <div className="stack no-print" data-testid="corregir-venta">
      {devuelta && (
        <Callout tone="info" title={`Devuelta el ${fecha(devuelta.businessDate)} · ${pesos(devuelta.amountCents)}`}>
          {devuelta.reason}. {etiqueta(METODO_DE_PAGO, devuelta.method, devuelta.method)}{devuelta.returnRef ? ` · ref. ${devuelta.returnRef}` : ''}
          {devuelta.approvedByName ? ` · autorizó ${devuelta.approvedByName}` : ''}. La venta sigue en su día; la devolución resta el día en que se hizo.
        </Callout>
      )}
      {marca && (
        <Callout tone="warn" title="Por corregir">
          {marca.reason}. La marcó {marca.flaggedByName ?? 'recepción'} el {fechaHora(marca.flaggedAt)}.
          {' '}{venta.canVoid ? 'Es de hoy y su turno sigue abierto: la gerencia la anula.' : venta.canReturn ? 'Su turno ya se cortó: la gerencia registra su devolución, con autorización.' : ''}
        </Callout>
      )}
      {viva && (
        <div className="row wrap gap-8">
          {!marca && can('pos:sale:create') && <Button size="sm" variant="secondary" icon={<Flag />} onClick={() => setAccion('marcar')}>Marcar por corregir</Button>}
          {venta.canVoid && can('pos:sale:void') && <Button size="sm" variant="secondary" icon={<Ban />} onClick={() => setAccion('anular')}>Anular venta</Button>}
          {venta.canReturn && can('pos:sale:return') && <Button size="sm" variant="secondary" icon={<Undo2 />} onClick={() => setAccion('devolver')}>Registrar devolución</Button>}
          {marca && can('pos:sale:void') && <Button size="sm" variant="ghost" icon={<FlagOff />} onClick={() => setAccion('descartar')}>No procedía</Button>}
        </div>
      )}
      {accion && accion !== 'devolver' && <MotivoDialog venta={venta} accion={accion} onClose={() => setAccion(null)} onListo={listo} />}
      {accion === 'devolver' && <DevolverVentaDialog venta={venta} onClose={() => setAccion(null)} onListo={listo} />}
    </div>
  );
}

const TEXTO: Record<Exclude<Accion, 'devolver'>, { titulo: string; sub: string; boton: string; hecho: string; motivos: string[]; ruta: (id: string) => string; peligro: boolean }> = {
  marcar: {
    titulo: 'Marcar por corregir', boton: 'Marcar', hecho: 'Venta marcada: la gerencia la verá en Caja', ruta: (id) => `/pos/sales/${id}/flag`, peligro: false,
    sub: 'No se anula ni se devuelve nada todavía: la gerencia la revisa. Dile qué pasó.',
    motivos: ['Se cobró de más', 'Producto equivocado', 'El cliente lo regresó'],
  },
  descartar: {
    titulo: 'El aviso no procedía', boton: 'Quitar el aviso', hecho: 'Aviso descartado: la venta queda como estaba', ruta: (id) => `/pos/sales/${id}/flag/dismiss`, peligro: false,
    sub: 'La venta queda como está. Queda anotado por qué.', motivos: ['Estaba bien cobrada', 'Se aclaró con el cliente'],
  },
  anular: {
    titulo: 'Anular la venta', boton: 'Anular venta', hecho: 'Venta anulada: el producto volvió al inventario', ruta: (id) => `/pos/sales/${id}/void`, peligro: true,
    sub: 'Solo el mismo día y con su turno abierto. Queda en el corte con tu nombre y el motivo; el producto vuelve al inventario.',
    motivos: ['Se cobró de más', 'Producto equivocado', 'Venta duplicada'],
  },
};

function MotivoDialog({ venta, accion, onClose, onListo }: { venta: PosSale; accion: Exclude<Accion, 'devolver'>; onClose: () => void; onListo: (v: PosSale) => void }) {
  const toast = useToast();
  const t = TEXTO[accion];
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  async function enviar() {
    setEnviando(true); setFallo(null);
    try {
      await api(t.ruta(venta.id), { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', t.hecho);
      onListo(await api<PosSale>(`/pos/sales/${venta.id}`));
    } catch (e) { setFallo(errorText(e, 'No se pudo')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} title={`${t.titulo} · ${pesos(venta.totalCents)}`} sub={t.sub} error={fallo}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant={t.peligro ? 'danger' : 'primary'} loading={enviando} disabled={motivo.trim().length < 3} onClick={() => void enviar()}>{t.boton}</Button></>}>
      <CampoMotivo id="cv-motivo" autoFocus value={motivo} onChange={setMotivo} motivos={t.motivos} />
    </Dialog>
  );
}

function DevolverVentaDialog({ venta, onClose, onListo }: { venta: PosSale; onClose: () => void; onListo: (v: PosSale) => void }) {
  const toast = useToast();
  const { activoEn, me } = useSession();
  const [motivo, setMotivo] = useState(venta.correction?.flag?.reason ?? '');
  const [referencia, setReferencia] = useState('');
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [cajaId, setCajaId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [autorizando, setAutorizando] = useState(false);
  const porTransferencia = venta.method === 'SPEI_TRANSFER' || venta.method === 'OXXO_REF';
  const porCaja = !porTransferencia && activoEn('cash', venta.branchId);

  useEffect(() => {
    if (!porCaja) { setTurnos([]); return; }
    api<OpenCashSessionsLite>(`/cash-sessions/open-lite?branchId=${venta.branchId}`).then((r) => {
      setTurnos(r.sessions);
      if (r.sessions.length === 1) setCajaId(r.sessions[0]!.id);
    }).catch((e) => setFallo(errorText(e, 'No se pudieron cargar las cajas abiertas: cierra y vuelve a intentarlo')));
  }, [porCaja, venta.branchId]);

  const sinTurno = porCaja && turnos !== null && turnos.length === 0;
  const valido = motivo.trim().length >= 3 && !sinTurno && (!porCaja || turnos !== null) && (!porTransferencia || referencia.trim().length >= 3) && (!porCaja || (turnos?.length ?? 0) <= 1 || !!cajaId);

  async function enviar(token?: string) {
    setEnviando(true); setFallo(null);
    try {
      const r = await api<PosSale>(`/pos/sales/${venta.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          reason: motivo.trim(), ...(porCaja && cajaId ? { cashSessionId: cajaId } : {}),
          ...(porTransferencia ? { returnRef: referencia.trim() } : {}), ...(token ? { approvalToken: token } : {}),
        }),
      });
      toast('ok', `Devolución registrada: ${pesos(venta.totalCents)} y el producto de vuelta al inventario`);
      onListo(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      else setFallo(errorText(e, 'No se pudo registrar la devolución'));
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open onClose={onClose} title={`Devolver la venta · ${pesos(venta.totalCents)}`} error={fallo}
        sub={`Venta del ${fecha(venta.businessDate)}${venta.folio ? ` · folio ${venta.folio}` : ''}. Siempre la autoriza otra persona, con su contraseña.`}
        footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="danger" loading={enviando} disabled={!valido} onClick={() => setAutorizando(true)}>Pedir autorización</Button></>}>
        <div className="stack">
          <Callout tone="warn" title="Lo que va a pasar">
            {porTransferencia ? 'No sale de ninguna caja: devuélvelo por transferencia y anota su referencia.'
              : porCaja ? (venta.method === 'CASH' ? 'El efectivo sale de la caja abierta hoy.' : 'Se resta del total de tarjeta de la caja abierta hoy; la devolución a la tarjeta se hace en la terminal del banco.')
                : 'Esta sucursal no lleva Caja: devuélvele el dinero en mano.'}
            {' '}El producto vuelve al inventario. La venta se queda en su día: la devolución resta hoy.
          </Callout>
          {sinTurno && <Callout tone="danger" title="No hay ninguna caja abierta">Abre turno para poder devolver el dinero.</Callout>}
          {porCaja && turnos && turnos.length > 1 && (
            <Field label="Caja" htmlFor="dv-caja" required hint="Hay varias abiertas: el dinero sale del corte de la que elijas.">
              <select id="dv-caja" className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                <option value="">Elige la caja…</option>
                {turnos.map((t) => {
                  const quien = t.openedByUserId === me.userId ? 'tu turno' : `turno de ${t.openedByName ?? 'otra persona'}`;
                  return <option key={t.id} value={t.id}>{t.registerCode} · {t.registerName} — {quien}, desde {hora(t.openedAt)}</option>;
                })}
              </select>
            </Field>
          )}
          {porTransferencia && (
            <Field label="Referencia de la devolución" htmlFor="dv-ref" required hint="La clave de rastreo de la transferencia con la que se devolvió.">
              <input id="dv-ref" className="input" value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
            </Field>
          )}
          <CampoMotivo id="dv-motivo" value={motivo} onChange={setMotivo} motivos={['El cliente lo regresó', 'Producto dañado', 'Se cobró de más']} />
        </div>
      </Dialog>
      {autorizando && (
        <AutorizacionDialog permission="pos:sale:return" branchId={venta.branchId}
          operacion={{ resourceType: 'PosSale', resourceId: venta.id, amountCents: venta.totalCents }} motivo={motivo.trim()}
          titulo={`Autorizar la devolución de ${pesos(venta.totalCents)}`}
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void enviar(token); }} />
      )}
    </>
  );
}

/** En Caja: lo que recepción marcó y nadie ha resuelto. Cada renglón abre su ticket, donde se anula o se devuelve. */
export function VentasPorCorregir({ branchId }: { branchId: string | null }) {
  const { branchName, branches } = useSession();
  const [d, setD] = useState<FlaggedPosSales | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(() => {
    setD(null); setFallo(null);
    const sede = branchId ? `?branchId=${branchId}` : '';
    api<FlaggedPosSales>('/pos/flagged-sales' + sede).then(setD).catch((e) => setFallo(errorText(e, 'No se pudieron cargar las ventas por corregir')));
  }, [branchId]);
  if (fallo) return <Callout tone="danger" title="Ventas por corregir">{fallo}</Callout>;
  if (!d) return <Skeleton h={80} />;
  if (d.items.length === 0) return null;
  return (
    <Card pad={false} title="Ventas por corregir" sub="Recepción las marcó: anúlalas hoy o registra su devolución" data-testid="ventas-por-corregir">
      {(
        <ul className="list">
          {d.items.map((v) => (
            <li key={v.saleId} className="list-item items-start">
              <div className="flex-1 min-w-0">
                <div className="small strong">{pesos(v.totalCents)}{v.folio ? ` · ${v.folio}` : ''} <Badge tone={v.sameDay ? 'warn' : 'danger'}>{v.sameDay ? 'Se anula hoy' : 'Toca devolución'}</Badge></div>
                <div className="tiny muted">{v.reason} · la marcó {v.flaggedByName ?? 'recepción'} el {fechaHora(v.flaggedAt)}{branches.length > 1 ? ` · ${branchName(v.branchId)}` : ''}</div>
              </div>
              <a className="btn btn-secondary btn-sm" href={`/recibo/venta/${v.saleId}`} target="_blank" rel="noreferrer">Abrir</a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
