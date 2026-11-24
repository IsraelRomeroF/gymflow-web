'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, Printer, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@/lib/format';
import { useToast, errorText, erroresPorCampo } from '@/components/session';
import { Button, Dialog } from '@/components/ui';
import type { RecordPaymentResult } from '@gymflow/core/contracts';
import { CambioEfectivo, CobroFields, cobroListo, cuerpoDelCobro, COBRO_INICIAL, type Cobro } from '@/components/cobro';

/**
 * COBRAR LA CLASE SUELTA en el mismo paso que la inscripción (MC-02).
 *
 * Antes la clase se cargaba a la cuenta y recepción tenía que ir a la ficha
 * a cobrarla: cinco pasos y un cargo que se quedaba abierto. Aquí el cobro
 * va directo al cargo de la clase, con su clave fija para reintentar sin
 * cobrar dos veces.
 *
 * También cobra la clase que alguien apartó y no ha pagado, desde la lista de
 * la sesión («Cobrar y marcar», 11-03) y desde su ficha: `onCobrado` corre en
 * cuanto el cobro queda registrado (ahí se marca su llegada).
 */
export function CobrarClaseDialog({ memberId, nombre, chargeId, priceCents, branchId, clase, onClose, onCobrado, sub, despues = 'Cobrar después' }: {
  memberId: string; nombre: string; chargeId: string; priceCents: string; branchId: string; clase: string; onClose: () => void;
  onCobrado?: () => void | Promise<void>;
  /** Lo que va después de «{clase} · clase suelta $X.»; por omisión, el aviso de quien acaba de inscribir. */
  sub?: string;
  /** El botón que no cobra: «Cobrar después» al inscribir; «Volver» cuando ya estaba apartada. */
  despues?: string;
}) {
  const toast = useToast();
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ id: string; folio: string | null } | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [clave] = useState(() => crypto.randomUUID());
  const cambiarCobro = useCallback((c: Cobro) => setCobro(c), []);

  async function cobrar() {
    setEnviando(true);
    try {
      const r = await api<RecordPaymentResult>(`/members/${memberId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: priceCents, branchId, targetChargeIds: [chargeId], ...cuerpoDelCobro(cobro),
          idempotencyKey: `clase-${clave}`,
        }),
      });
      setHecho(r.payment);
      // El cobro ya quedó: lo que sigue (marcar su llegada, refrescar la lista) no lo deshace si falla.
      await Promise.resolve(onCobrado?.()).catch(() => undefined);
    } catch (e) {
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo cobrar. La inscripción quedó; cóbrala desde su ficha'));
    } finally { setEnviando(false); }
  }

  if (hecho) {
    return (
      <Dialog open onClose={onClose} title="Clase cobrada">
        <div className="empty py-8">
          <div className="empty-icon empty-icon-ok"><CircleCheck /></div>
          <p className="empty-title">{nombre} va a {clase}</p>
          <p className="empty-text">Cobrados {pesos(priceCents)}.{hecho.folio ? <> Folio <code>{hecho.folio}</code>.</> : null}</p>
        </div>
        <div className="row gap-8 mt-12">
          <a className="btn btn-secondary flex-1" href={`/recibo/${hecho.id}`} target="_blank" rel="noreferrer"><Printer />Comprobante</a>
          <Link className="btn btn-secondary flex-1" href={`/socios/${memberId}`}>Ver su ficha</Link>
          <Button onClick={onClose} className="flex-1">Listo</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={() => { if (!enviando) onClose(); }} title={`Cobrar la clase de ${nombre}`}
      sub={`${clase} · clase suelta ${pesos(priceCents)}. ${sub ?? 'Ya quedó apartado. Si no cobras ahora, su lugar se guarda hasta una hora antes de la clase; sin pago se libera y no la debe.'}`}
      footer={<>
        {/* No compite con «Cobrar»: es la salida, no la otra opción. */}
        <Button variant="ghost" onClick={onClose} disabled={enviando}>{despues}</Button>
        <Button icon={<Wallet />} loading={enviando} disabled={!cobroListo(cobro)} onClick={() => void cobrar()}>Cobrar {pesos(priceCents)}</Button>
      </>}>
      <div className="stack">
        <CobroFields branchId={branchId} value={cobro} onChange={cambiarCobro} errores={errores} />
        {cobro.method === 'CASH' && <CambioEfectivo totalCents={BigInt(priceCents)} />}
      </div>
    </Dialog>
  );
}

/** Lo que la cotización de una clase suelta dice sobre apartarla sin pagar (D-16, bloque 3.5). */
export type ApartadoCotizado = { payNow?: 'OWES_MEMBERSHIP' | 'HOLD_CLOSED' | null; holdUntil?: string | null };

/** La frase que acompaña a «clase suelta $150»: hasta cuándo se le guarda, o por qué solo pagando ahora. */
export function textoDelApartado(q: ApartadoCotizado, zona?: string): string {
  if (q.payNow === 'OWES_MEMBERSHIP') return 'Debe su mensualidad: solo la aparta pagándola ahora.';
  if (q.payNow === 'HOLD_CLOSED') return 'Falta menos de una hora: solo se aparta pagándola ahora.';
  if (q.holdUntil) {
    const d = new Date(q.holdUntil);
    const cuando = d.toLocaleString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false, ...(zona ? { timeZone: zona } : {}) });
    return `Si no la paga, se le guarda hasta el ${cuando}; después el lugar se libera y no la debe.`;
  }
  return '';
}

/**
 * APARTAR PAGANDO EN EL MOMENTO (D-16, bloque 3.5): quien debe su mensualidad,
 * o quien llega con menos de una hora, solo aparta la clase suelta pagándola.
 * Aquí la inscripción y el cobro son UNA petición: sin cobro no queda ni el
 * lugar ni la deuda.
 */
export function ApartarPagandoDialog({ memberId, nombre, scheduleId, priceCents, branchId, clase, porQue, onClose, onListo }: {
  memberId: string; nombre: string; scheduleId: string; priceCents: string; branchId: string; clase: string;
  porQue: 'OWES_MEMBERSHIP' | 'HOLD_CLOSED'; onClose: () => void; onListo: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const cambiarCobro = useCallback((c: Cobro) => setCobro(c), []);

  async function apartar() {
    setEnviando(true); setFallo(null);
    try {
      await api(`/classes/schedules/${scheduleId}/bookings`, { method: 'POST', body: JSON.stringify({ memberId, payment: cuerpoDelCobro(cobro) }) });
      toast('ok', `${nombre} va a ${clase} · cobrados ${pesos(priceCents)}`);
      await Promise.resolve(onListo()).catch(() => undefined);
    } catch (e) {
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) setFallo(errorText(e, 'No se pudo cobrar: no quedó inscrito ni se le cargó nada'));
    } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={() => { if (!enviando) onClose(); }} title={`Inscribir y cobrar a ${nombre}`} error={fallo}
      sub={`${clase} · clase suelta ${pesos(priceCents)}. ${porQue === 'OWES_MEMBERSHIP' ? 'Debe su mensualidad: la clase suelta se paga al apartarla.' : 'Falta menos de una hora: la clase suelta se paga al apartarla.'} Sin cobro no queda inscrito.`}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<Wallet />} loading={enviando} disabled={!cobroListo(cobro)} onClick={() => void apartar()}>Inscribir y cobrar {pesos(priceCents)}</Button>
      </>}>
      <div className="stack">
        <CobroFields branchId={branchId} value={cobro} onChange={cambiarCobro} errores={errores} />
        {cobro.method === 'CASH' && <CambioEfectivo totalCents={BigInt(priceCents)} />}
      </div>
    </Dialog>
  );
}
