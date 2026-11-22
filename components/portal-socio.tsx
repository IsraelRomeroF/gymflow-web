'use client';

import { UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast, errorText } from '@/components/session';
import { Button, Dialog } from '@/components/ui';

/** Un exsocio vuelve (PS-04): se reactiva su ficha en vez de abrir otra. */
export function ReactivarDialog({ memberId, nombre, onClose, onHecho }: { memberId: string; nombre: string; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('Regresó al gimnasio');
  const [enviando, setEnviando] = useState(false);

  async function reactivar() {
    setEnviando(true);
    try {
      await api(`/members/${memberId}/reactivate`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', `${nombre} vuelve a ser socio. Véndele una membresía para que pueda entrar.`);
      onHecho();
    } catch (e) {
      toast('error', errorText(e, 'No se pudo reactivar'));
    } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={enviando ? () => undefined : onClose} title={`Reactivar a ${nombre}`}
      sub="Conserva su código, su historia y lo que firmó. Queda sin membresía hasta que le vendas una."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<UserRoundCheck />} loading={enviando} disabled={motivo.trim().length < 3} onClick={() => void reactivar()}>Reactivar</Button></>}>
      <label className="field">
        <span className="label">Motivo</span>
        <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
      </label>
    </Dialog>
  );
}
