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
      sub={`${clase} · clase suelta ${pesos(priceCents)}. ${sub ?? 'Ya quedó inscrito; si no cobras ahora, el cargo queda en su cuenta.'}`}
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
