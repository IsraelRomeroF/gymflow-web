'use client';

import { useCallback, useState } from 'react';
import { FileSignature } from 'lucide-react';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { useToast, errorText } from '../session';
import { Badge, Button, Callout, Dialog, ErrorCarga, Skeleton, Switch } from '../ui';
import { textoBiometricoVigente } from './comun';

/**
 * VOLVER A FIRMAR el texto biométrico vigente (6-03, 21-09), sin volver a
 * capturar el rostro. Quien firmó un texto anterior lo lee aquí, delante de
 * recepción, y acepta. La firma anterior se conserva tal cual: es la
 * evidencia de lo que aceptó entonces. El texto lo pone el servidor.
 */
export function FirmarTextoVigenteDialog({ memberId, memberName, onClose, onDone }: {
  memberId: string; memberName: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const doc = useCarga(useCallback(() => textoBiometricoVigente(), []));
  const [acepta, setAcepta] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function firmar() {
    setEnviando(true);
    try {
      // La versión que leyó: si cambió mientras tanto, la API no firma otra en su lugar.
      const r = await api<{ documentVersion: string }>(`/members/${memberId}/consents/renew-biometric`, {
        method: 'POST', body: JSON.stringify(doc.datos ? { documentVersion: doc.datos.version } : {}),
      });
      toast('ok', `Firma registrada: ${memberName} aceptó la versión ${r.documentVersion}.`);
      onDone();
    } catch (e) {
      toast('error', errorText(e, 'No se pudo registrar la firma'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open size="lg" onClose={() => { if (!enviando) onClose(); }}
      title={`Volver a firmar · ${memberName}`}
      sub="El texto biométrico cambió. Su rostro no se vuelve a capturar."
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<FileSignature />} loading={enviando} disabled={!acepta || !doc.datos} onClick={() => void firmar()}>Registrar su firma</Button>
      </>}>
      {doc.error ? <ErrorCarga titulo="No se pudo cargar el texto" mensaje={doc.error} onReintentar={() => void doc.recargar()} />
        : doc.datos === undefined ? <Skeleton h={220} r={12} />
          : doc.datos === null ? <Callout tone="warn" title="No hay texto biométrico publicado">Sin un texto publicado no hay nada que firmar.</Callout>
            : (
              <div className="stack">
                <div className="row-between">
                  <div className="row gap-8">
                    <FileSignature size={16} className="muted" />
                    <span className="strong small">{doc.datos.title}</span>
                  </div>
                  <Badge>Versión {doc.datos.version}</Badge>
                </div>
                <div className="doc">{doc.datos.bodyText}</div>
                <Switch checked={acepta} onChange={(v) => setAcepta(v)}><strong>{memberName}</strong> leyó este texto y lo acepta.</Switch>
                <p className="tiny muted">Si no lo acepta, revoca su rostro: desde ese momento entra por recepción.</p>
              </div>
            )}
    </Dialog>
  );
}
