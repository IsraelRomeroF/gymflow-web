'use client';

import { useState } from 'react';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { api, ApiError, motivoDe } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { useFormulario } from '@/lib/formulario';
import { errorText, useToast } from '@/components/session';
import { InputPesos } from '@/components/input-pesos';
import { Button, CampoFecha, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo, Field } from '@/components/ui';
import { FORMA_DE_PAGO, PIDE_REFERENCIA, hoyDeCobro, periodo, type Factura, type FacturaConPagos, type Pago } from './textos';

type Campo = 'importe' | 'fecha' | 'referencia';
/** A qué campo del diálogo corresponde cada dato que la API rechaza. */
const CAMPO_DE: Record<string, Campo> = { amountCents: 'importe', paidOn: 'fecha', paidAt: 'fecha', paymentRef: 'referencia' };

/**
 * REGISTRAR UN PAGO (23-08, 23-15, 23-16). En este orden: cuánto llegó (por
 * omisión, lo que falta), cómo, qué día (hoy en la Ciudad de México) y con
 * qué referencia, obligatoria en transferencia y tarjeta: sin ella no se
 * concilia. Con menos que el saldo queda como abono y la factura dice cuánto
 * resta.
 */
export function Pagar({ factura, onClose, onHecho }: { factura: Factura; onClose: () => void; onHecho: (f: FacturaConPagos | null) => void }) {
  const toast = useToast();
  const hoy = hoyDeCobro();
  const saldo = BigInt(factura.balanceCents);
  const [importe, setImporte] = useState<bigint | null>(saldo);
  const [d, setD] = useState({ paymentMethod: 'SPEI_TRANSFER', paymentRef: '', note: '', paidOn: hoy });
  const [error, setError] = useState<string | null>(null);
  const pideReferencia = PIDE_REFERENCIA.has(d.paymentMethod);
  const f = useFormulario<Campo>({
    importe: importe === null || importe <= 0n ? 'Escribe cuánto llegó, en pesos.' : importe > saldo && `Es más de lo que falta: la factura debe ${pesos(saldo)}.`,
    fecha: !d.paidOn ? 'Escribe el día en que llegó el pago.' : d.paidOn > hoy && 'No puede ser posterior a hoy.',
    referencia: pideReferencia && !d.paymentRef.trim() && (d.paymentMethod === 'CARD' ? 'Escribe la autorización o los últimos dígitos de la tarjeta.' : 'Escribe la clave de rastreo del SPEI.'),
  }, { obligatorios: pideReferencia ? ['importe', 'fecha', 'referencia'] : ['importe', 'fecha'] });

  async function pagar() {
    setError(null);
    try {
      const r = await api<FacturaConPagos>(`/platform/invoices/${factura.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: importe!.toString(), paymentMethod: d.paymentMethod, paidOn: d.paidOn,
          ...(d.paymentRef.trim() ? { paymentRef: d.paymentRef.trim() } : {}), ...(d.note.trim() ? { note: d.note.trim() } : {}),
        }),
      });
      toast('ok', r.status === 'PAID' ? `Factura ${factura.folio} pagada.` : `Abono de ${pesos(importe!)} registrado en ${factura.folio}: resta ${pesos(r.balanceCents)}.`);
      onHecho(r);
    } catch (e) {
      // Alguien más la pagó o la anuló mientras tanto: se dice y se recarga.
      if (motivoDe(e) === 'ALREADY_PAID' || motivoDe(e) === 'ALREADY_VOIDED') { toast('error', errorText(e)); onHecho(null); return; }
      if (motivoDe(e) === 'AMOUNT_OVER_BALANCE') { f.marcar({ importe: errorText(e) }); return; }
      const porCampo = e instanceof ApiError && Array.isArray(e.data?.issues)
        ? (e.data.issues as Array<{ path?: string; message?: string }>).filter((i) => i.path && CAMPO_DE[i.path] && i.message) : [];
      if (porCampo.length > 0) f.marcar(Object.fromEntries(porCampo.map((i) => [CAMPO_DE[i.path!]!, i.message!])));
      else setError(errorText(e, 'No se pudo registrar el pago'));
    }
  }

  const pagado = BigInt(factura.paidCents);
  return (
    <Dialog open onClose={onClose} error={error} title={`Registrar pago · ${factura.folio}`}
      sub={`${periodo(factura)} · ${pagado > 0n ? `resta ${pesos(saldo)} de ${pesos(factura.totalCents)}` : pesos(factura.totalCents)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={f.enviando} onClick={() => void f.enviar(pagar)}>Registrar pago</Button></>}>
      <div className="stack">
        <Field label="Importe recibido" htmlFor="pg-i" {...f.campo('importe')} hint={importe !== null && importe > 0n && importe < saldo ? `Queda como abono: la factura seguirá debiendo ${pesos(saldo - importe)}.` : 'Si llegó menos, escribe lo que llegó: queda como abono.'}>
          <InputPesos id="pg-i" autoFocus valueCents={importe} onChange={(c) => { setImporte(c); f.limpiar('importe'); }} />
        </Field>
        <Field label="Forma de pago" htmlFor="pg-m">
          <select id="pg-m" className="select" value={d.paymentMethod} onChange={(e) => { setD({ ...d, paymentMethod: e.target.value }); f.limpiar('referencia'); }}>
            {Object.entries(FORMA_DE_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Fecha en que llegó el pago" htmlFor="pg-f" {...f.campo('fecha')}>
          <CampoFecha id="pg-f" className="campo-corto" value={d.paidOn} max={hoy} hoy={hoy} onChange={(v) => { setD({ ...d, paidOn: v }); f.limpiar('fecha'); }} />
        </Field>
        <Field label={pideReferencia ? 'Referencia' : 'Referencia (opcional)'} htmlFor="pg-r" {...f.campo('referencia')}
          hint={d.paymentMethod === 'CARD' ? 'La autorización o los últimos dígitos de la tarjeta.' : d.paymentMethod === 'SPEI_TRANSFER' ? 'La clave de rastreo del SPEI: con ella se concilia el estado de cuenta.' : 'El folio del recibo o del depósito, si lo hay.'}>
          <input id="pg-r" className="input mono" maxLength={120} value={d.paymentRef} onChange={(e) => { setD({ ...d, paymentRef: e.target.value }); f.limpiar('referencia'); }} />
        </Field>
        <Field label="Nota (opcional)" htmlFor="pg-n"><input id="pg-n" className="input" maxLength={300} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

/**
 * DESHACER UN PAGO (23-07): el que se registró en la factura de otra marca o
 * con otro importe. Pide motivo; la factura vuelve a deber ese importe y el
 * pago queda a la vista, tachado. No es anular la factura.
 */
export function DeshacerPago({ factura, pago, onClose, onHecho }: { factura: Factura; pago: Pago; onClose: () => void; onHecho: (f: FacturaConPagos | null) => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function deshacer() {
    setError(null);
    try {
      const r = await api<FacturaConPagos>(`/platform/invoices/${factura.id}/payments/${pago.id}/undo`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', `Pago deshecho: ${factura.folio} vuelve a deber ${pesos(r.balanceCents)}.`);
      onHecho(r);
    } catch (e) {
      if (motivoDe(e) === 'ALREADY_REVERSED') { toast('error', errorText(e)); onHecho(null); return; }
      setError(errorText(e, 'No se pudo deshacer el pago'));
    }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`Deshacer el pago de ${pesos(pago.amountCents)}`}
      sub={`${factura.folio} · ${FORMA_DE_PAGO[pago.paymentMethod] ?? pago.paymentMethod} del ${fecha(pago.paidOn)}${pago.paymentRef ? ` · ref. ${pago.paymentRef}` : ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(deshacer)}>Deshacer pago</Button></>}>
      <div className="stack">
        <p>La factura vuelve a deber ese importe. El pago no se borra: queda en el comprobante como deshecho, con su motivo.</p>
        <CampoMotivo id="dp-m" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} hint="Queda en la bitácora de la marca."
          motivos={textosDeMotivo('deshacerPagoDeFactura')} />
      </div>
    </Dialog>
  );
}
