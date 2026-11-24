'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import type { PlatformPriceChange, PlatformPriceChangeList, PlatformPriceChangePreview } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { fecha, pesos } from '@/lib/format';
import { errorText, useToast } from '@/components/session';
import { Badge, Button, Callout, Card, Dialog, ErrorCarga, Field } from '@/components/ui';
import { ConMotivo } from '../_componentes/con-motivo';
import { periodo } from '../cobro';

/**
 * CAMBIOS CON UN MES DE AVISO (D-38, bloque 3.11). Dos piezas que comparten
 * Precios y Planes: el diálogo que confirma un cambio viendo a quién le mueve
 * la mensualidad y desde qué factura, y la lista de lo anunciado, donde se
 * cancela lo que todavía no aplica.
 */

/** El día 1 de los seis meses que siguen al primero posible: de aquí se elige desde qué factura aplica. */
function mesesDesde(minimo: string): string[] {
  const meses: string[] = [];
  let [a, m] = [Number(minimo.slice(0, 4)), Number(minimo.slice(5, 7))];
  for (let i = 0; i < 6; i += 1) {
    meses.push(`${a}-${String(m).padStart(2, '0')}-01`);
    m += 1; if (m > 12) { m = 1; a += 1; }
  }
  return meses;
}
const cuanto = (c: string | null): string => (c === null ? 'Sin precio' : pesos(c));

export function AnunciarCambio({ previa, titulo, onClose, onConfirmar }: {
  previa: PlatformPriceChangePreview; titulo: string; onClose: () => void; onConfirmar: (effectiveFrom: string) => Promise<void>;
}) {
  const [desde, setDesde] = useState(previa.effectiveFrom);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suben = previa.affected.filter((a) => BigInt(a.afterCents) > BigInt(a.beforeCents)).length;
  return (
    <Dialog open onClose={onClose} error={error} title={titulo} size="lg"
      sub={previa.affected.length === 0
        ? `${previa.organizations === 1 ? 'Una marca tiene' : `${previa.organizations ?? 0} marcas tienen`} este plan: conservan su versión hasta la fecha que se anuncie.`
        : `Le cambia la mensualidad a ${previa.affected.length === 1 ? 'una marca' : `${previa.affected.length} marcas`}: no aplica hoy, se anuncia con al menos un mes de aviso.`}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button icon={<CalendarClock />} loading={enviando} onClick={async () => {
        setEnviando(true); setError(null);
        try { await onConfirmar(desde); } catch (e) { setError(errorText(e, 'No se pudo anunciar el cambio')); } finally { setEnviando(false); }
      }}>Anunciar desde {periodo(desde).toLowerCase()}</Button></>}>
      <div className="stack" data-testid="anunciar-cambio">
        <Field label="Aplica desde la factura de" htmlFor="ac-d" hint={`Lo más pronto es ${periodo(previa.minEffectiveFrom).toLowerCase()}: un mes de aviso. Hasta entonces cada marca paga lo que paga hoy.`}>
          <select id="ac-d" className="select campo-corto" value={desde} onChange={(e) => setDesde(e.target.value)}>
            {mesesDesde(previa.minEffectiveFrom).map((m) => <option key={m} value={m}>{periodo(m)}</option>)}
          </select>
        </Field>
        {previa.affected.length > 0 && <div className="table-wrap">
          <table className="table table-stack">
            <thead><tr><th>Marca</th><th className="right">Paga hoy</th><th className="right">Pagará</th></tr></thead>
            <tbody>
              {previa.affected.map((a) => (
                <tr key={a.organizationId} data-afectada={a.tradeName}>
                  <td data-label="Marca"><Link className="row-link" href={`/plataforma/${a.organizationId}`}>{a.tradeName}</Link></td>
                  <td data-label="Paga hoy" className="right num">{pesos(a.beforeCents)}</td>
                  <td data-label="Pagará" className="right num strong">{pesos(a.afterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        <Callout tone="info">
          Al anunciarlo, el dueño de cada marca recibe el aviso con las dos cifras y la fecha{suben > 0 ? '' : ' (aunque le baje)'}: en su panel, en su teléfono si tiene notificaciones, y en Cobranza → «Avisos por mandar» si no le ha llegado.
          Se puede cancelar mientras no llegue la fecha.
        </Callout>
      </div>
    </Dialog>
  );
}

const ESTADO: Record<PlatformPriceChange['status'], { label: string; tone: 'warn' | 'ok' | 'neutral' }> = {
  PENDING: { label: 'Anunciado', tone: 'warn' }, APPLIED: { label: 'Ya aplica', tone: 'ok' }, CANCELED: { label: 'Cancelado', tone: 'neutral' },
};

/** Lo anunciado (y lo último que aplicó o se canceló), de precios y de planes. `version` cambia cuando la pantalla anuncia algo. */
export function CambiosAnunciados({ version, onCambio, soloPlanes }: { version: number; onCambio: () => void; soloPlanes?: boolean }) {
  const toast = useToast();
  const [cancelar, setCancelar] = useState<PlatformPriceChange | null>(null);
  const pedir = useCallback(() => api<PlatformPriceChangeList>('/platform/price-changes'), []);
  const carga = useCarga(pedir, { conservar: true });
  const { recargar } = carga;
  const cargar = useCallback(() => { void recargar(); }, [recargar]);
  // La pantalla anunció algo: se vuelve a leer.
  useEffect(() => { if (version > 0) cargar(); }, [version, cargar]);
  if (carga.error) return <ErrorCarga mensaje="No se pudieron cargar los cambios anunciados." onReintentar={cargar} />;
  const filas = (carga.datos?.changes ?? []).filter((c) => !soloPlanes || c.kind === 'PLAN');
  if (filas.length === 0) return null;
  return (
    <>
      <Card title="Cambios anunciados" sub="Lo que ya se avisó y desde qué factura aplica. Hasta esa fecha cada marca conserva lo que tenía; ese día aplica a todas." pad={false} data-testid="cambios-anunciados">
        <div className="table-wrap">
          <table className="table table-stack">
            <thead><tr><th>Concepto</th><th className="right">De</th><th className="right">A</th><th>Desde la factura de</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id} data-cambio={c.concept} data-estado={c.status}>
                  <td data-label="Concepto"><span className="strong">{c.kind === 'PLAN' ? `Plan ${c.concept}` : c.concept}</span><div className="tiny muted">Anunciado el {fecha(c.announcedOn)}</div></td>
                  <td data-label="De" className="right num">{cuanto(c.beforeCents)}</td>
                  <td data-label="A" className="right num strong">{cuanto(c.afterCents)}</td>
                  <td data-label="Desde">{periodo(c.effectiveFrom)}</td>
                  <td data-label="Estado"><Badge tone={ESTADO[c.status].tone} dot>{ESTADO[c.status].label}</Badge>{c.cancelReason && <div className="tiny muted">«{c.cancelReason}»</div>}</td>
                  <td className="right">{c.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={() => setCancelar(c)}>Cancelar cambio</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {cancelar && (
        <ConMotivo titulo={`Cancelar el cambio de ${cancelar.kind === 'PLAN' ? `Plan ${cancelar.concept}` : cancelar.concept}`}
          texto={`Todo sigue como está: ${cuanto(cancelar.beforeCents)} al mes. A las marcas que ya recibieron el aviso se les avisa que ya no aplica.`}
          boton="Cancelar el cambio" peligro sugerencias={['Se decidió no cambiarlo', 'El importe estaba mal', 'Se anunciará con otra fecha']}
          onClose={() => setCancelar(null)}
          onConfirmar={async (reason) => {
            try {
              await api(`/platform/price-changes/${cancelar.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
              toast('ok', 'Cambio cancelado: todo sigue como estaba.');
              setCancelar(null); cargar(); onCambio();
            } catch (e) { toast('error', errorText(e, 'No se pudo cancelar el cambio')); }
          }} />
      )}
    </>
  );
}
