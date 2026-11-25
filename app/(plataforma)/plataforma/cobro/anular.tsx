'use client';

import { useState } from 'react';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { api, motivoDe } from '@/lib/api';
import { useFormulario } from '@gymflow/ui/formulario';
import { errorText, useToast } from '@/components/session';
import { Button, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo } from '@/components/ui';
import type { Factura } from './textos';

/** ANULAR una factura que todavía debe todo: deja de cobrarse y el mes queda libre. Con pagos, primero se deshacen. */
export function Anular({ factura, onClose, onHecho }: { factura: Factura; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  // El botón queda encendido: si falta el motivo, el campo lo dice (26-02).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function anular() {
    setError(null);
    try {
      await api(`/platform/invoices/${factura.id}/void`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', `Factura ${factura.folio} anulada.`);
      onHecho();
    } catch (e) {
      // Ya estaba pagada o anulada: se dice y se recarga lo que hay.
      if (motivoDe(e) === 'ALREADY_PAID' || motivoDe(e) === 'ALREADY_VOIDED') { toast('error', errorText(e)); onHecho(); return; }
      setError(errorText(e, 'No se pudo anular'));
    }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`Anular la factura ${factura.folio}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(anular)}>Anular</Button></>}>
      <div className="stack">
        <p>Deja de cobrarse y el mes queda libre para emitir otra. La factura no se borra: queda anulada con su motivo.</p>
        <CampoMotivo id="an-m" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} hint="Queda en la bitácora de la marca."
          motivos={textosDeMotivo('anularFactura')} />
      </div>
    </Dialog>
  );
}
