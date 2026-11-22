'use client';

import { useEffect, useState } from 'react';
import { BellRing, BellOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast, errorText } from '@/components/session';
import { Button } from '@/components/ui';

/** El navegador quiere la llave en bytes, el servidor la da en base64url. */
function aBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * "RECIBIR AVISOS EN ESTE TELÉFONO" (DP-10): el dueño se entera de una
 * solicitud de firma aunque el panel esté cerrado. Solo aparece si el
 * servidor tiene llaves y el navegador sabe de notificaciones.
 */
export function AvisosEnTelefono({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const toast = useToast();
  const [estado, setEstado] = useState<'cargando' | 'no-disponible' | 'apagado' | 'encendido'>('cargando');
  const [llave, setLlave] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setEstado('no-disponible'); return; }
      const r = await api<{ publicKey: string | null }>('/me/push/public-key').catch(() => ({ publicKey: null }));
      if (!r.publicKey) { setEstado('no-disponible'); return; }
      setLlave(r.publicKey);
      const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => undefined);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      setEstado(sub && Notification.permission === 'granted' ? 'encendido' : 'apagado');
    })().catch(() => setEstado('no-disponible'));
  }, []);

  async function encender() {
    if (!llave) return;
    setOcupado(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') { toast('error', 'El navegador no dio permiso. Actívalo en los ajustes del sitio.'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(llave) });
      await api('/me/push-subscriptions', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
      setEstado('encendido');
      toast('ok', 'Listo: las solicitudes de firma te llegan a este teléfono');
    } catch (e) { toast('error', errorText(e, 'No se pudieron activar los avisos')); } finally { setOcupado(false); }
  }
  async function apagar() {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api('/me/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined); await sub.unsubscribe(); }
      setEstado('apagado');
      toast('ok', 'Avisos apagados en este teléfono');
    } catch (e) { toast('error', errorText(e, 'No se pudieron apagar')); } finally { setOcupado(false); }
  }

  if (estado === 'cargando' || estado === 'no-disponible') return null;
  return estado === 'encendido'
    ? <Button size={size} variant="ghost" icon={<BellOff />} loading={ocupado} onClick={() => void apagar()} data-testid="push-apagar">Avisos activos aquí</Button>
    : <Button size={size} variant="secondary" icon={<BellRing />} loading={ocupado} onClick={() => void encender()} data-testid="push-encender">Recibir avisos en este teléfono</Button>;
}
