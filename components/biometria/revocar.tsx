'use client';

import { useEffect, useState } from 'react';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { api } from '@/lib/api';
import { MODALITY } from '@/lib/labels';
import { useSession, errorText } from '../session';
import { Button, Callout, CampoMotivo, Dialog, faltaMotivo } from '../ui';
import { esDeLaCamara, PLAZO_BORRADO_DIAS, type Enrollment } from './comun';

/**
 * REVOCAR un rostro o una huella. El texto dice lo que de verdad pasa según
 * dónde vive el registro: el de la cámara se borra en el acto; el de un lector
 * de sucursal espera la confirmación de la sede. Revocar SÍ pide motivo
 * (D6-06), de un toque con el catálogo del núcleo. Para un rostro que salió
 * mal no se revoca: se usa «Actualizar».
 */
export function RevocarDialog({ enrollment, memberName, onClose, onDone }: {
  enrollment: Enrollment | null; memberName: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const { branchName } = useSession();
  const [reason, setReason] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setReason(''); setError(null); }, [enrollment]);

  async function revocar() {
    if (!enrollment) return;
    setEnviando(true); setError(null);
    try {
      await api(`/biometric-enrollments/${enrollment.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      await onDone();
    } catch (e) {
      setError(errorText(e, 'No se pudo revocar'));
    } finally {
      setEnviando(false);
    }
  }

  const camara = enrollment ? esDeLaCamara(enrollment) : true;
  const que = enrollment ? MODALITY[enrollment.modality].toLowerCase() : 'rostro';
  return (
    <Dialog
      open={!!enrollment} onClose={() => { if (!enviando) onClose(); }}
      title={`Revocar ${enrollment?.modality === 'FINGERPRINT' ? 'la huella' : 'el rostro'} de ${memberName}`}
      sub={enrollment ? branchName(enrollment.branchId) : undefined}
      error={error}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="danger" onClick={() => void revocar()} loading={enviando} disabled={faltaMotivo(reason)}>Revocar</Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="warn" title="Qué pasa después">
          {camara
            ? <>Su {que} deja de reconocerse y su registro <strong>se borra ahora mismo</strong>. {memberName} entra por recepción hasta que vuelva a registrarse; para eso tendrá que firmar de nuevo.</>
            : <>Deja de reconocerse de inmediato. Su registro está en el lector de la sucursal: la sucursal tiene <strong>{PLAZO_BORRADO_DIAS} días</strong> para borrarlo y confirmarlo; mientras no lo haga, aparece como pendiente en Biometría.</>}
        </Callout>
        <CampoMotivo id="motivo-rev" autoFocus value={reason} onChange={setReason} motivos={textosDeMotivo('revocarBiometria')} />
        {camara && <p className="tiny muted">¿El rostro salió mal o cambió de aspecto? No lo revoques: usa «Actualizar», que lo sustituye sin volver a firmar.</p>}
      </div>
    </Dialog>
  );
}
