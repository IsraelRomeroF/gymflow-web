'use client';

import { useCallback, useState } from 'react';
import { BadgePercent } from 'lucide-react';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { useFormulario } from '@/lib/formulario';
import { pesos } from '@/lib/format';
import { errorText, useToast } from '@/components/session';
import { Badge, Button, CampoMotivo, Dialog, ERROR_MOTIVO, Field, Opciones, faltaMotivo } from '@/components/ui';
import { ConMotivo } from '../_componentes/con-motivo';
import { ESTADO_AJUSTE, periodo, type Ajuste } from './textos';

type Lista = { month: string; adjustments: Ajuste[] };
type Clase = Ajuste['kind'];

const CLASES: ReadonlyArray<{ value: Clase; label: string }> = [
  { value: 'PERCENT', label: 'Porcentaje' }, { value: 'AMOUNT', label: 'Importe fijo' }, { value: 'SPECIAL_PRICE', label: 'Precio especial' },
];
const MOTIVOS = ['Promoción de arranque', 'Convenio', 'Compensación por una falla', 'Mes de cortesía'];

/** «1500» o «1,500.50» → centavos en texto; `null` si no es un importe. */
function aCentavos(texto: string): string | null {
  const m = /^\s*\$?\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(texto.replace(/,/g, ''));
  return m ? (BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))).toString() : null;
}
/** «20» o «12.5» → puntos base; `null` si no es un porcentaje de 0.01 a 100. */
function aPuntosBase(texto: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(texto);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps >= 1 && bps <= 10_000 ? bps : null;
}
/** El mes en curso y los cinco siguientes, como `AAAA-MM-01`. */
function mesesDesde(mes: string): string[] {
  let [a, m] = [Number(mes.slice(0, 4)), Number(mes.slice(5, 7))];
  return Array.from({ length: 6 }, () => {
    const d = `${a}-${String(m).padStart(2, '0')}-01`;
    m += 1; if (m > 12) { m = 1; a += 1; }
    return d;
  });
}
/** «Abril de 2027» o «abril a junio de 2027». */
export const mesesDe = (a: Pick<Ajuste, 'fromMonth' | 'lastMonth'>): string => (a.fromMonth === a.lastMonth
  ? periodo(a.fromMonth)
  : `${a.fromMonth.slice(0, 4) === a.lastMonth.slice(0, 4) ? periodo(a.fromMonth).split(' ')[0] : periodo(a.fromMonth)} a ${periodo(a.lastMonth).toLowerCase()}`);

/**
 * DESCUENTOS Y PRECIO ESPECIAL DE UNA MARCA (D-39, bloque 4.9). Por meses y
 * con motivo: vale solo para las facturas de esos meses y caduca solo. El
 * motivo sale escrito en el renglón de la factura. No se edita: se cancela y
 * se da otro. Una factura ya emitida no cambia.
 */
export function Descuentos({ organizationId, tradeName, onCambio }: { organizationId: string; tradeName: string; onCambio: () => void }) {
  const toast = useToast();
  const [dar, setDar] = useState(false);
  const [cancelar, setCancelar] = useState<Ajuste | null>(null);
  const pedir = useCallback(() => api<Lista>(`/platform/organizations/${organizationId}/billing-adjustments`), [organizationId]);
  const carga = useCarga(pedir, { conservar: true });
  const r = carga.datos;
  const hecho = () => { void carga.recargar(); onCambio(); };
  // Lo vivo arriba; de lo terminado o cancelado, lo último.
  const vivos = (r?.adjustments ?? []).filter((a) => a.status === 'ACTIVE' || a.status === 'SCHEDULED');
  const pasados = (r?.adjustments ?? []).filter((a) => a.status === 'ENDED' || a.status === 'CANCELED').slice(0, 3);
  return (
    <div data-testid="descuentos">
      <div className="row-between flex-wrap gap-8 mb-8">
        <p className="label">Descuentos y precio especial</p>
        <Button size="sm" variant="secondary" icon={<BadgePercent />} disabled={!r} onClick={() => setDar(true)}>Dar descuento</Button>
      </div>
      {carga.error && <p className="small text-danger">No se pudieron cargar los descuentos.</p>}
      {r && vivos.length + pasados.length === 0 && <p className="small muted">Paga la lista completa. Un descuento o un precio especial se da por meses y con motivo, y sale como renglón en su factura.</p>}
      {vivos.length + pasados.length > 0 && (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead><tr><th>Descuento</th><th>Facturas de</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {[...vivos, ...pasados].map((a) => (
                <tr key={a.id} data-descuento={a.status}>
                  <td data-label="Descuento" className="small">{a.label}</td>
                  <td data-label="Facturas de" className="small">{mesesDe(a)}<div className="tiny muted">{a.months} {a.months === 1 ? 'mes' : 'meses'}</div></td>
                  <td data-label="Estado"><Badge tone={ESTADO_AJUSTE[a.status].tone} dot>{ESTADO_AJUSTE[a.status].label}</Badge>{a.cancelReason && <div className="tiny muted">«{a.cancelReason}»</div>}</td>
                  <td className="right">{(a.status === 'ACTIVE' || a.status === 'SCHEDULED') && <Button size="sm" variant="ghost" onClick={() => setCancelar(a)}>Cancelar</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dar && r && <DarDescuento organizationId={organizationId} tradeName={tradeName} mesActual={r.month} onClose={() => setDar(false)} onHecho={() => { setDar(false); hecho(); }} />}
      {cancelar && (
        <ConMotivo titulo="Cancelar el descuento" peligro boton="Cancelar el descuento"
          texto={`«${cancelar.label}» deja de aplicar en las facturas que falten por emitir. Las que ya se emitieron con él no cambian.`}
          sugerencias={['Se capturó mal', 'Cambió el acuerdo con el dueño']}
          onClose={() => setCancelar(null)}
          onConfirmar={async (reason) => {
            try {
              await api(`/platform/billing-adjustments/${cancelar.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
              toast('ok', 'Descuento cancelado: las facturas que faltan salen sin él.');
              setCancelar(null); hecho();
            } catch (e) { toast('error', errorText(e, 'No se pudo cancelar el descuento')); }
          }} />
      )}
    </div>
  );
}

function DarDescuento({ organizationId, tradeName, mesActual, onClose, onHecho }: { organizationId: string; tradeName: string; /** `AAAA-MM`. */ mesActual: string; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const meses = mesesDesde(mesActual);
  const [clase, setClase] = useState<Clase>('PERCENT');
  const [valor, setValor] = useState('');
  const [desde, setDesde] = useState(meses[0]!);
  const [cuantos, setCuantos] = useState('3');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bps = clase === 'PERCENT' ? aPuntosBase(valor) : null;
  const cents = clase === 'PERCENT' ? null : aCentavos(valor);
  const n = /^\d{1,2}$/.test(cuantos.trim()) ? Number(cuantos) : 0;
  const f = useFormulario({
    valor: clase === 'PERCENT'
      ? bps === null && 'Escribe el porcentaje, de 0.01 a 100; por ejemplo 20.'
      : (cents === null || cents === '0') && 'Escribe el importe en pesos; por ejemplo 500 o 500.50.',
    cuantos: (n < 1 || n > 24) && 'De 1 a 24 meses.',
    motivo: faltaMotivo(motivo) && ERROR_MOTIVO,
  }, { obligatorios: ['valor', 'cuantos', 'motivo'] });
  async function guardar() {
    setError(null);
    try {
      const r = await api<{ adjustment: Ajuste; alreadyInvoiced: string[] }>(`/platform/organizations/${organizationId}/billing-adjustments`, {
        method: 'POST',
        body: JSON.stringify({ kind: clase, ...(clase === 'PERCENT' ? { percentBps: bps } : { amountCents: cents }), fromMonth: desde, months: n, reason: motivo.trim() }),
      });
      toast('ok', r.alreadyInvoiced.length > 0
        ? `Descuento guardado. La factura de ${r.alreadyInvoiced.map((m) => periodo(m).toLowerCase()).join(', ')} ya estaba emitida y no cambia: si debe llevarlo, anúlala y emítela otra vez.`
        : `Descuento guardado: sale en ${n === 1 ? 'la factura' : 'las facturas'} de ${mesesDe(r.adjustment).toLowerCase()}.`);
      onHecho();
    } catch (e) { setError(errorText(e, 'No se pudo guardar el descuento')); }
  }
  return (
    <Dialog open onClose={onClose} error={error} title={`Dar un descuento a ${tradeName}`}
      sub="Vale solo para las facturas de esos meses y caduca solo: después vuelve a pagar la lista. Las facturas ya emitidas no cambian."
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button loading={f.enviando} icon={<BadgePercent />} onClick={() => void f.enviar(guardar)}>Guardar descuento</Button></>}>
      <div className="stack" data-testid="dar-descuento">
        <Opciones forma="segmentado" etiqueta="Clase de descuento" opciones={CLASES} value={clase} onChange={(c) => { setClase(c); setValor(''); }} />
        <Field label={clase === 'PERCENT' ? 'Porcentaje' : clase === 'AMOUNT' ? 'Importe que se descuenta al mes (MXN)' : 'Lo que paga al mes, sin IVA (MXN)'} htmlFor="dd-v" {...f.campo('valor')}
          hint={clase === 'PERCENT' ? 'Sobre lo que se cobra de ese mes, antes del IVA.' : clase === 'AMOUNT' ? 'Se resta de su mensualidad, antes del IVA. Si el mes cuesta menos, la factura queda en cero, no en negativo.' : 'Toda su mensualidad cuesta esto en vez de la lista. Si la lista es menor, no se descuenta nada.'}>
          <input id="dd-v" className="input mono campo-corto" inputMode="decimal" autoFocus value={valor} placeholder={clase === 'PERCENT' ? '20' : '500.00'} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <div className="grid grid-2">
          <Field label="Desde la factura de" htmlFor="dd-d">
            <select id="dd-d" className="select" value={desde} onChange={(e) => setDesde(e.target.value)}>
              {meses.map((m) => <option key={m} value={m}>{periodo(m)}</option>)}
            </select>
          </Field>
          <Field label="Cuántos meses" htmlFor="dd-n" {...f.campo('cuantos')}>
            <input id="dd-n" className="input mono campo-corto" inputMode="numeric" value={cuantos} onChange={(e) => setCuantos(e.target.value)} />
          </Field>
        </div>
        <CampoMotivo id="dd-m" value={motivo} onChange={setMotivo} error={f.error('motivo')} motivos={MOTIVOS}
          hint="Sale escrito en el renglón de la factura del gimnasio y queda en la bitácora de la marca." />
        {clase !== 'PERCENT' && cents && cents !== '0' && <p className="small muted">{clase === 'AMOUNT' ? `Descuenta ${pesos(cents)} en cada factura.` : `Cada mes completo paga ${pesos(cents)} más IVA, si el IVA está encendido.`}</p>}
      </div>
    </Dialog>
  );
}
