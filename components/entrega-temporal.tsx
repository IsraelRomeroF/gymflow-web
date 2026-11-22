'use client';

import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from './ui';
import { enlaceWhatsapp } from '@/lib/entrega-temporal';

/**
 * WhatsApp con SU clave, al celular de esa persona (22-03). Sin celular
 * capturado, lo pide ahí mismo: el número solo sirve para este envío. Nunca
 * abre un chat sin destinatario ni junta las claves de varias personas.
 */
export function WhatsappTemporal({ nombre, telefono, mensaje }: { nombre: string; telefono?: string | null; mensaje: string }) {
  const [pedir, setPedir] = useState(false);
  const [celular, setCelular] = useState('');
  const etiqueta = `Mandar su clave por WhatsApp a ${nombre}`;
  const directo = enlaceWhatsapp(telefono, mensaje);
  if (directo) {
    return <a className="btn btn-ghost btn-sm" href={directo} target="_blank" rel="noreferrer" aria-label={etiqueta}><MessageCircle />WhatsApp</a>;
  }
  if (!pedir) return <Button variant="ghost" size="sm" icon={<MessageCircle />} onClick={() => setPedir(true)} aria-label={etiqueta}>WhatsApp</Button>;
  const tecleado = enlaceWhatsapp(celular, mensaje);
  return (
    <span className="row gap-8 flex-wrap items-center">
      <input className="input w-auto" inputMode="tel" autoFocus aria-label={`Celular de ${nombre}`} placeholder="Su celular a 10 dígitos"
        value={celular} onChange={(e) => setCelular(e.target.value)} />
      {tecleado
        ? <a className="btn btn-secondary btn-sm" href={tecleado} target="_blank" rel="noreferrer"><MessageCircle />Abrir WhatsApp</a>
        : <span className="tiny muted">Escribe sus 10 dígitos.</span>}
    </span>
  );
}
