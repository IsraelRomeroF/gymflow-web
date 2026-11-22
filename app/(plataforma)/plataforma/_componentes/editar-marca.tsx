'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ZONAS } from '@/lib/zonas';
import { useToast, errorText } from '@/components/session';
import { Button, Dialog, Field, irAlPrimerError } from '@/components/ui';
import type { Detalle } from './tipos';

/** Corregir los datos de la marca: nombre, razón social, zona horaria y correo de cobros. Con motivo. */
export function EditarMarca({ marca, onClose, onHecho }: { marca: Detalle; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ tradeName: marca.tradeName, legalName: marca.legalName, timezone: marca.timezone, billingEmail: marca.billingEmail ?? '', reason: '' });
  const [enviando, setEnviando] = useState(false);
  const errores: Record<string, string> = {
    ...(f.tradeName.trim().length < 2 ? { tradeName: 'Escribe el nombre comercial.' } : {}),
    ...(f.legalName.trim().length < 3 ? { legalName: 'Escribe la razón social.' } : {}),
    ...(f.billingEmail.trim() !== '' && !/@/.test(f.billingEmail) ? { billingEmail: 'Escribe un correo válido o déjalo vacío.' } : {}),
    ...(f.reason.trim().length < 3 ? { reason: 'Escribe el motivo: queda en la bitácora.' } : {}),
  };
  const [intentado, setIntentado] = useState(false);
  const e = (k: string) => (intentado ? errores[k] ?? null : null);
  async function guardar() {
    setIntentado(true);
    if (Object.keys(errores).length > 0) { irAlPrimerError(); return; }
    setEnviando(true);
    try {
      await api(`/platform/organizations/${marca.id}`, { method: 'PUT', body: JSON.stringify({ tradeName: f.tradeName.trim(), legalName: f.legalName.trim(), timezone: f.timezone.trim(), billingEmail: f.billingEmail.trim() || null, reason: f.reason.trim() }) });
      toast('ok', 'Marca actualizada.'); onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Editar ${marca.tradeName}`} sub="Lo que la plataforma puede corregir de la marca. Queda en su bitácora."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} onClick={() => void guardar()}>Guardar</Button></>}>
      <div className="stack">
        <div className="grid grid-2">
          <Field label="Nombre comercial" htmlFor="em-t" required error={e('tradeName')}><input id="em-t" className="input" value={f.tradeName} onChange={(e) => setF({ ...f, tradeName: e.target.value })} /></Field>
          <Field label="Razón social" htmlFor="em-l" required error={e('legalName')}><input id="em-l" className="input" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></Field>
          <Field label="Zona horaria" htmlFor="em-z" hint="Cada sucursal puede tener la suya.">
            <select id="em-z" className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {!ZONAS.some(([z]) => z === f.timezone) && <option value={f.timezone}>{f.timezone}</option>}
              {ZONAS.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
            </select>
          </Field>
          <Field label="Correo de cobros (opcional)" htmlFor="em-c" error={e('billingEmail')} hint="Se guarda para tenerlo a la mano: GymFlow todavía no envía nada a este correo."><input id="em-c" className="input" type="email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} /></Field>
        </div>
        <Field label="Motivo" htmlFor="em-m" required error={e('reason')}><input id="em-m" className="input" maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Cambió de razón social…" /></Field>
      </div>
    </Dialog>
  );
}
