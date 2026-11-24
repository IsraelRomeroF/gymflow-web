'use client';

import { useEffect, useState } from 'react';
import { BellRing, BellOff, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession, useToast, errorText } from '@/components/session';
import { Button } from '@/components/ui';

/** El navegador quiere la llave en bytes, el servidor la da en base64url. */
function aBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** La llave con la que el navegador se suscribió, en base64url: si ya no es la del servidor, esa suscripción no recibe nada. */
function llaveDe(sub: PushSubscription): string | null {
  const k = sub.options?.applicationServerKey;
  if (!k) return null;
  let bin = '';
  for (const b of new Uint8Array(k)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** iPhone y iPad solo dan avisos a una página agregada a la pantalla de inicio (desde iOS 16.4). */
function esIosSinInstalar(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !instalada;
}

/** Una dirección que cambia al reiniciar GymFlow (el túnel sin cuenta): los avisos se pierden con ella. La fija es D-01. */
const direccionProvisional = () => /(^|\.)trycloudflare\.com$/.test(window.location.hostname);

/**
 * "RECIBIR AVISOS EN ESTE TELÉFONO" (DP-10): el dueño se entera de una
 * solicitud de firma aunque el panel esté cerrado. Solo aparece si el
 * servidor tiene llaves y el navegador sabe de notificaciones.
 *
 * D-01 (fase 3, bloque 3.1): los avisos van ligados a la DIRECCIÓN por la que
 * se entra. Con la dirección fija ya no se pierden en cada arranque; aquí se
 * cuida lo demás: si este equipo ya estaba suscrito, se vuelve a anotar en el
 * servidor al abrir (una suscripción que el servidor perdió decía «activos»
 * y no llegaba nada), una suscripción hecha con otras llaves se descarta,
 * «Probar» manda un aviso de verdad, y en iPhone se dice que primero hay que
 * agregar GymFlow a la pantalla de inicio.
 *
 * D-05 (fase 4, bloque 4.2): este botón enciende o apaga TODOS los avisos de
 * este equipo. Qué tipos suenan (caja sin cortar, corte con diferencia, el
 * resumen del lunes…) lo elige la dueña en «Mis avisos» (`/avisos`).
 */
export function AvisosEnTelefono({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const toast = useToast();
  const esDuena = useSession().mirada.roles.includes('OWNER');
  const [estado, setEstado] = useState<'cargando' | 'no-disponible' | 'instalar' | 'apagado' | 'encendido'>('cargando');
  const [llave, setLlave] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [probando, setProbando] = useState(false);
  const [provisional, setProvisional] = useState(false);

  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined') { setEstado('no-disponible'); return; }
      const r = await api<{ publicKey: string | null }>('/me/push/public-key').catch(() => ({ publicKey: null }));
      // Sin llaves en el servidor no hay nada que ofrecer.
      if (!r.publicKey) { setEstado('no-disponible'); return; }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setEstado(esIosSinInstalar() ? 'instalar' : 'no-disponible'); return; }
      setLlave(r.publicKey);
      setProvisional(direccionProvisional());
      const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => undefined);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      if (!sub || Notification.permission !== 'granted') { setEstado('apagado'); return; }
      // Suscrito con otras llaves (se cambiaron en el servidor): esa suscripción ya no recibe nada.
      const suya = llaveDe(sub);
      if (suya && suya !== r.publicKey) { await sub.unsubscribe().catch(() => undefined); setEstado('apagado'); return; }
      // Se vuelve a anotar en el servidor (no duplica): si la había perdido, vuelve a llegar.
      const anotada = await api('/me/push-subscriptions', { method: 'POST', body: JSON.stringify(sub.toJSON()) }).then(() => true, () => false);
      setEstado(anotada ? 'encendido' : 'apagado');
    })().catch(() => setEstado('no-disponible'));
  }, []);

  async function probar() {
    setProbando(true);
    try {
      const r = await api<{ sent: number }>('/me/push/test', { method: 'POST', body: '{}' });
      if (r.sent > 0) toast('ok', 'Aviso de prueba enviado: debe sonar en este equipo en unos segundos.');
      else toast('error', 'No salió ningún aviso: apágalos y vuelve a activarlos en este equipo.');
    } catch (e) { toast('error', errorText(e, 'No se pudo mandar el aviso de prueba')); } finally { setProbando(false); }
  }

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
      // D-05 (bloque 4.2): a la dueña le llegan además sus alertas y el resumen del lunes; cuáles, lo elige en «Mis avisos».
      toast('ok', esDuena ? 'Listo: las solicitudes de firma, tus alertas y el resumen del lunes llegan a este teléfono' : 'Listo: las solicitudes de firma te llegan a este teléfono');
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
  if (estado === 'instalar') {
    return <p className="tiny muted" data-testid="push-instalar">Para recibir avisos en este iPhone: toca Compartir, «Agregar a inicio», y abre GymFlow desde ese ícono.</p>;
  }
  return (
    <span className="row wrap gap-8">
      {estado === 'encendido' ? (
        <>
          <Button size={size} variant="ghost" icon={<BellOff />} loading={ocupado} onClick={() => void apagar()} data-testid="push-apagar">Avisos activos aquí</Button>
          <Button size={size} variant="ghost" icon={<Send />} loading={probando} onClick={() => void probar()} data-testid="push-probar">Probar</Button>
        </>
      ) : (
        <Button size={size} variant="secondary" icon={<BellRing />} loading={ocupado} onClick={() => void encender()} data-testid="push-encender">Recibir avisos en este teléfono</Button>
      )}
      {provisional && <span className="tiny muted" data-testid="push-provisional">Esta dirección es provisional: al reiniciar GymFlow cambia y hay que activarlos otra vez.</span>}
    </span>
  );
}
