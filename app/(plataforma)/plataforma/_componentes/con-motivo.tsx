'use client';

import { useState } from 'react';
import { Button, CampoMotivo, Dialog, irAlPrimerError } from '@/components/ui';

/** Un diálogo que pide motivo antes de hacer algo que la marca va a notar. */
export function ConMotivo({ titulo, texto, boton, peligro, sugerencias, onClose, onConfirmar }: {
  titulo: string; texto: string; boton: string; peligro?: boolean; sugerencias: string[];
  onClose: () => void; onConfirmar: (reason: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Botón siempre activo: si falta el motivo, se dice en el campo (UX7 Plataforma 8).
  const [intentado, setIntentado] = useState(false);
  const falta = motivo.trim().length < 3;
  return (
    <Dialog open onClose={onClose} title={titulo}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button variant={peligro ? 'danger' : 'primary'} loading={enviando} onClick={async () => {
        setIntentado(true);
        if (falta) { irAlPrimerError(); return; }
        setEnviando(true); try { await onConfirmar(motivo.trim()); } finally { setEnviando(false); }
      }}>{boton}</Button></>}>
      <div className="stack">
        <p>{texto}</p>
        <CampoMotivo id="pm-m" autoFocus value={motivo} onChange={setMotivo} motivos={sugerencias} hint="Queda en la bitácora de la marca."
          error={intentado && falta ? 'Escribe el motivo o elige uno de abajo: queda en la bitácora.' : null} />
      </div>
    </Dialog>
  );
}
