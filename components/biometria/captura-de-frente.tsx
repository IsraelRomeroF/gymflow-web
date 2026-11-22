'use client';

import { useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import type { FaceCheck } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { grabar, useCamara } from '../camara-rostro';
import { errorText } from '../session';
import { Badge, Button, Callout } from '../ui';

/** Una captura ya revisada por el motor: los cuadros que se mandan y uno para enseñarla. */
export type Captura = { frames: string[]; muestra: string };

/**
 * CAPTURA DE FRENTE (6-09, 6-14; bloque 2.3). Sin giro de cabeza: recepción
 * tiene a la persona delante, así que la prueba de vida no protege de nada y
 * el giro metía perfiles en la plantilla. Seis cuadros en segundo y medio, y
 * el motor dice EN EL ACTO si sirven («no se vio su rostro», «mira de
 * frente»): el problema se corrige con el socio todavía ante la cámara, no
 * después de pulsar Registrar.
 */
export function CapturaDeFrente({ branchId, valor, onChange }: {
  branchId: string; valor: Captura | null; onChange: (c: Captura | null) => void;
}) {
  const { video, estado } = useCamara(!valor);
  const [fase, setFase] = useState<'lista' | 'tomando' | 'revisando'>('lista');
  const [problema, setProblema] = useState<string | null>(null);

  async function capturar() {
    if (!video.current) return;
    setProblema(null);
    setFase('tomando');
    const frames = await grabar(video.current, 6, 1500);
    if (frames.length < 3) { setFase('lista'); setProblema('La cámara no entregó imagen. Vuelve a capturar.'); return; }
    setFase('revisando');
    try {
      const r = await api<FaceCheck>('/access/face/check', { method: 'POST', body: JSON.stringify({ branchId, frames }) });
      if (r.ok) onChange({ frames, muestra: frames[Math.floor(frames.length / 2)]! });
      else setProblema(r.problema ?? 'La captura no sirve. Vuelve a capturar.');
    } catch (e) {
      setProblema(errorText(e, 'No se pudo revisar la captura'));
    } finally {
      setFase('lista');
    }
  }

  const ocupada = fase !== 'lista';
  return (
    <>
      <div className="capture" data-testid="captura-de-frente">
        {/* La imagen solo vive en esta pantalla mientras se revisa: no se guarda. */}
        {valor ? <img src={valor.muestra} alt="Captura revisada" /> : <video ref={video} muted playsInline />}
        {estado === 'sin-camara' && !valor && <div className="stack-sm items-center capture-sin"><Camera size={28} /><span className="small">La cámara dejó de responder. Cierra este diálogo y vuelve a abrirlo.</span></div>}
        <div className={`capture-guide${valor ? ' is-ok' : ''}`} />
        {valor && <span className="capture-sello"><Badge tone="ok" dot>Rostro detectado</Badge></span>}
        <div className="capture-hint" aria-live="polite">
          {valor ? '' : fase === 'tomando' ? 'No te muevas…' : fase === 'revisando' ? 'Revisando la captura…' : estado === 'vivo' ? 'Mira de frente a la cámara, sin gorra ni lentes oscuros' : ''}
        </div>
      </div>
      {problema && !valor && <div data-testid="captura-problema"><Callout tone="warn" title="Hay que repetir la captura">{problema}</Callout></div>}
      <div className="capture-acciones">
        {valor
          ? <Button variant="secondary" icon={<RotateCcw />} onClick={() => { onChange(null); setProblema(null); }}>Repetir</Button>
          : <Button variant="volt" size="lg" icon={<Camera />} loading={ocupada} onClick={() => void capturar()} disabled={estado !== 'vivo'}>
              {fase === 'tomando' ? 'Capturando…' : fase === 'revisando' ? 'Revisando…' : 'Capturar'}
            </Button>}
      </div>
      <p className="tiny muted text-center">La imagen no se guarda: solo un registro cifrado del rostro, en el servidor del gimnasio. Se borra al revocarlo.</p>
    </>
  );
}
