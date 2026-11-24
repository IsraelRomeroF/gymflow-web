'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import type { PlatformPriceChangePreview, PlatformTax, PlatformTaxChange, PlatformTaxScheduled } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { fecha, pesos } from '@/lib/format';
import { errorText, useToast } from '@/components/session';
import { Badge, Button, Callout, Card, Dialog, ErrorCarga, Field, Opciones, Skeleton } from '@/components/ui';
import { ConMotivo } from '../_componentes/con-motivo';
import { periodo, tasa } from '../cobro';

/** La tasa general del IVA, en puntos base. */
const IVA_BPS = 1600;
type Modo = 'APARTE' | 'INCLUIDO' | 'SIN';
const pedidoDe = (m: Modo) => ({ rateBps: m === 'SIN' ? 0 : IVA_BPS, included: m === 'INCLUIDO' });
const describir = (x: { rateBps: number; included: boolean }): string => (x.rateBps === 0 ? 'Sin IVA' : x.included ? `${tasa(x.rateBps)}, incluido en los precios` : `${tasa(x.rateBps)} aparte, sobre los precios`);
const ESTADO: Record<PlatformTaxChange['status'], { label: string; tone: 'warn' | 'ok' | 'neutral' }> = {
  PENDING: { label: 'Anunciado', tone: 'warn' }, ACTIVE: { label: 'Vigente', tone: 'ok' }, REPLACED: { label: 'Sustituido', tone: 'neutral' }, CANCELED: { label: 'Cancelado', tone: 'neutral' },
};
/** El día 1 de seis meses desde `minimo`. */
function mesesDesde(minimo: string): string[] {
  let [a, m] = [Number(minimo.slice(0, 4)), Number(minimo.slice(5, 7))];
  return Array.from({ length: 6 }, () => {
    const d = `${a}-${String(m).padStart(2, '0')}-01`;
    m += 1; if (m > 12) { m = 1; a += 1; }
    return d;
  });
}

/**
 * IVA DE LAS FACTURAS DE GYMFLOW (D-39, bloque 4.9). Nace APAGADO: mientras
 * nadie lo anuncie aquí, las facturas salen por el total de siempre. Los
 * precios de la plataforma se entienden SIN IVA; encenderlo «aparte» le sube
 * 16 % el total a cada gimnasio, así que se anuncia con al menos un mes de
 * aviso, igual que un cambio de precio (D-38), y cada dueño recibe su aviso.
 * Lo ya emitido no cambia nunca. Aquí también se ve si los datos de GymFlow
 * como emisor están configurados en el servidor.
 */
export function Iva() {
  const toast = useToast();
  const [anunciar, setAnunciar] = useState(false);
  const [cancelar, setCancelar] = useState<PlatformTaxChange | null>(null);
  const pedir = useCallback(() => api<PlatformTax>('/platform/tax'), []);
  const carga = useCarga(pedir, { conservar: true });
  const r = carga.datos;
  const cargar = () => void carga.recargar();
  if (carga.error) return <ErrorCarga mensaje="No se pudo cargar el IVA de las facturas." onReintentar={cargar} />;
  if (!r) return <Card title="IVA de las facturas"><Skeleton h={80} /></Card>;
  const pasados = r.changes.filter((c) => c.status !== 'PENDING').slice(0, 4);
  return (
    <>
      <Card title="IVA de las facturas" data-testid="iva"
        sub="Los precios de arriba son SIN IVA. Apagado, cada factura sale por el total de siempre. Encendido «aparte», a cada factura se le suma el 16 % y muestra subtotal, IVA y total: el gimnasio paga 16 % más. Confírmalo con tu contador antes de encenderlo."
        actions={<Button size="sm" icon={<CalendarClock />} disabled={!!r.pending} title={r.pending ? 'Ya hay un cambio de IVA anunciado: cancélalo antes de anunciar otro' : undefined} onClick={() => setAnunciar(true)}>Cambiar el IVA</Button>}>
        <div className="stack">
          <p className="row gap-8">
            <Badge tone={r.current.rateBps > 0 ? 'ok' : 'neutral'} dot data-testid="iva-hoy">{r.current.rateBps > 0 ? 'Encendido' : 'Apagado'}</Badge>
            <span className="small">Las facturas de {periodo(r.currentMonth).toLowerCase()}: <span className="strong">{describir(r.current).toLowerCase()}</span>.</span>
          </p>
          {r.pending && (
            <Callout tone="warn" title={`Desde la factura de ${periodo(r.pending.effectiveFrom).toLowerCase()}: ${describir(r.pending).toLowerCase()}`}>
              Anunciado el {fecha(r.pending.announcedOn)}. Hasta entonces las facturas salen como hoy.{' '}
              <Button size="sm" variant="ghost" onClick={() => setCancelar(r.pending)}>Cancelar este cambio</Button>
            </Callout>
          )}
          {pasados.length > 0 && (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead><tr><th>IVA</th><th>Desde la factura de</th><th>Estado</th></tr></thead>
                <tbody>
                  {pasados.map((c) => (
                    <tr key={c.id} data-iva-cambio={c.status}>
                      <td data-label="IVA" className="small">{describir(c)}<div className="tiny muted">Anunciado el {fecha(c.announcedOn)}</div></td>
                      <td data-label="Desde" className="small">{periodo(c.effectiveFrom)}</td>
                      <td data-label="Estado"><Badge tone={ESTADO[c.status].tone} dot>{ESTADO[c.status].label}</Badge>{c.cancelReason && <div className="tiny muted">«{c.cancelReason}»</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.issuer ? (
            <p className="small" data-testid="emisor">
              <span className="muted">GymFlow como emisor: </span><span className="strong">{r.issuer.legalName}</span>{r.issuer.rfc ? <span className="mono"> · RFC {r.issuer.rfc}</span> : <span className="muted"> · sin RFC</span>}
              {r.issuer.address && <span className="muted"> · {r.issuer.address}</span>}
              <span className="muted"> · {r.issuer.payment ? 'con datos de pago' : 'sin datos de pago'}. Salen en cada factura; se cambian en la configuración del servidor, no aquí.</span>
            </p>
          ) : (
            <Callout tone="warn" title="Faltan los datos de GymFlow como emisor">
              Las facturas salen a nombre de «GymFlow», sin razón social, RFC ni datos de pago. Se ponen en la configuración del servidor (variables <code>GYMFLOW_ISSUER_…</code>), fuera del código.
            </Callout>
          )}
        </div>
      </Card>
      {anunciar && <AnunciarIva actual={r} onClose={() => setAnunciar(false)} onHecho={() => { setAnunciar(false); cargar(); }} />}
      {cancelar && (
        <ConMotivo titulo="Cancelar el cambio de IVA" peligro boton="Cancelar el cambio"
          texto={`Las facturas siguen como hoy: ${describir(r.current).toLowerCase()}. A los gimnasios que ya recibieron el aviso se les avisa que ya no aplica.`}
          sugerencias={['Falta confirmarlo con el contador', 'Se anunciará con otra fecha']}
          onClose={() => setCancelar(null)}
          onConfirmar={async (reason) => {
            try {
              await api(`/platform/tax/${cancelar.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
              toast('ok', 'Cambio de IVA cancelado: todo sigue como estaba.');
              setCancelar(null); cargar();
            } catch (e) { toast('error', errorText(e, 'No se pudo cancelar el cambio de IVA')); }
          }} />
      )}
    </>
  );
}

function AnunciarIva({ actual, onClose, onHecho }: { actual: PlatformTax; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const hoyEs: Modo = actual.current.rateBps === 0 ? 'SIN' : actual.current.included ? 'INCLUIDO' : 'APARTE';
  const [modo, setModo] = useState<Modo | null>(null);
  const [desde, setDesde] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pedir = useCallback(() => api<PlatformPriceChangePreview>('/platform/tax/preview', { method: 'POST', body: JSON.stringify(pedidoDe(modo!)) }), [modo]);
  const previa = useCarga(modo ? pedir : null);
  const v = previa.datos;
  const fechaElegida = desde ?? v?.effectiveFrom ?? null;
  const opciones = ([
    { value: 'APARTE', label: 'Sumarlo aparte (16 %)', texto: 'Cada factura suma 16 % a lo que hoy cobra. El gimnasio paga más. Se avisa con un mes.' },
    { value: 'INCLUIDO', label: 'Mis precios ya lo incluyen', texto: 'El total no cambia: la factura solo desglosa cuánto es IVA.' },
    { value: 'SIN', label: 'Sin IVA', texto: 'Las facturas salen por un total, sin desglose.' },
  ] as const).filter((o) => o.value !== hoyEs);
  async function guardar() {
    if (!modo || !fechaElegida) return;
    setEnviando(true); setError(null);
    try {
      const r = await api<PlatformTaxScheduled>('/platform/tax', { method: 'PUT', body: JSON.stringify({ ...pedidoDe(modo), effectiveFrom: fechaElegida }) });
      toast('ok', `IVA anunciado desde la factura de ${periodo(r.change.effectiveFrom).toLowerCase()}${r.affected > 0 ? `; a ${r.affected === 1 ? 'la marca afectada' : `las ${r.affected} marcas afectadas`} se les avisa` : ''}.`);
      onHecho();
    } catch (e) { setError(errorText(e, 'No se pudo anunciar el IVA')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} error={error} size="lg" title="Cambiar el IVA de las facturas"
      sub="Aplica desde la factura de un mes hacia adelante. Las facturas ya emitidas no cambian."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
        <Button icon={<CalendarClock />} loading={enviando} disabled={!v || !fechaElegida} onClick={() => void guardar()}>{fechaElegida ? `Anunciar desde ${periodo(fechaElegida).toLowerCase()}` : 'Anunciar'}</Button></>}>
      <div className="stack" data-testid="anunciar-iva">
        <Opciones forma="tarjetas" columnas={3} etiqueta="Qué IVA llevan las facturas" opciones={opciones} value={modo} onChange={(m) => { setModo(m); setDesde(null); }} />
        {modo && previa.cargando && <Skeleton h={60} />}
        {modo && previa.error && <ErrorCarga mensaje={previa.error} onReintentar={() => void previa.recargar()} />}
        {v && v.immediate && <Callout tone="info">No le cambia el total a ninguna marca: aplica desde la factura de {periodo(v.effectiveFrom).toLowerCase()}, sin aviso previo.</Callout>}
        {v && !v.immediate && (
          <>
            <Field label="Aplica desde la factura de" htmlFor="iva-d" hint={`Lo más pronto es ${periodo(v.minEffectiveFrom).toLowerCase()}: un mes de aviso. Hasta entonces cada gimnasio paga lo que paga hoy.`}>
              <select id="iva-d" className="select campo-corto" value={fechaElegida ?? v.minEffectiveFrom} onChange={(e) => setDesde(e.target.value)}>
                {mesesDesde(v.minEffectiveFrom).map((m) => <option key={m} value={m}>{periodo(m)}</option>)}
              </select>
            </Field>
            <div className="table-wrap lista-acotada">
              <table className="table table-stack">
                <thead><tr><th>Marca</th><th className="right">Pagaría sin el cambio</th><th className="right">Pagará</th></tr></thead>
                <tbody>
                  {v.affected.map((a) => (
                    <tr key={a.organizationId} data-afectada={a.tradeName}>
                      <td data-label="Marca"><Link className="row-link" href={`/plataforma/${a.organizationId}`}>{a.tradeName}</Link></td>
                      <td data-label="Sin el cambio" className="right num">{pesos(a.beforeCents)}</td>
                      <td data-label="Pagará" className="right num strong">{pesos(a.afterCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout tone="warn">Le cambia el total a {v.affected.length === 1 ? 'una marca' : `${v.affected.length} marcas`}. Al anunciarlo, cada dueño recibe su aviso con las dos cifras y la fecha. Se puede cancelar mientras no llegue la fecha.</Callout>
          </>
        )}
      </div>
    </Dialog>
  );
}
