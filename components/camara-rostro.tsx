'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CÁMARA PARA EL ROSTRO (2026-10-09): la de la PC de recepción hace de lector,
 * como en las estaciones de HRFlow. Pide un movimiento (la prueba de vida:
 * una foto no gira la cabeza) y toma varios cuadros mientras se hace. Los
 * cuadros solo viajan al servidor para sacar la huella del rostro; nunca se
 * guardan.
 */
export type Reto = 'turn_left' | 'turn_right' | 'move_closer';
export const TEXTO_RETO: Record<Reto, string> = {
  turn_left: 'Gira despacio la cabeza a tu izquierda',
  turn_right: 'Gira despacio la cabeza a tu derecha',
  move_closer: 'Acércate un poco a la cámara',
};
// Solo giros (2026-10-09): "acércate" exige crecer 12 % en el cuadro y fallaba
// seguido; el giro es el reto que se cumple a la primera.
export const retoAlAzar = (): Reto => (['turn_left', 'turn_right'] as const)[Math.floor(Math.random() * 2)]!;

/** Enciende la cámara frontal en el <video>; la apaga al desmontar. */
export function useCamara(encendida = true) {
  const video = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<'pidiendo' | 'vivo' | 'sin-camara'>('pidiendo');
  useEffect(() => {
    if (!encendida) return;
    let cancelado = false; let s: MediaStream | null = null;
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        if (cancelado) { s.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
        setEstado('vivo');
      } catch { if (!cancelado) setEstado('sin-camara'); }
    })();
    return () => { cancelado = true; s?.getTracks().forEach((t) => t.stop()); };
  }, [encendida]);
  return { video, estado };
}

/** Un cuadro en JPEG, reducido a 480 px de ancho: suficiente para el motor y ligero para la red. */
export function cuadro(v: HTMLVideoElement): string | null {
  if (!v.videoWidth) return null;
  const ancho = Math.min(480, v.videoWidth); const alto = Math.round(v.videoHeight * (ancho / v.videoWidth));
  const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
  c.getContext('2d')?.drawImage(v, 0, 0, ancho, alto);
  return c.toDataURL('image/jpeg', 0.8);
}

/** `n` cuadros a lo largo de `ms` milisegundos: lo que dura el movimiento pedido. */
export async function grabar(v: HTMLVideoElement, n = 6, ms = 1600): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = cuadro(v); if (f) out.push(f);
    await new Promise((r) => setTimeout(r, ms / n));
  }
  return out;
}

/**
 * ¿Presta este navegador la cámara? (6-02; bloque 2.3). Se pregunta ANTES de
 * pedirle nada al socio y se contesta en palabras de mostrador: el navegador
 * solo presta la cámara en la propia computadora (`localhost`) o por `https`;
 * por `http://IP` desde otra computadora no la presta, y eso se dice así.
 */
export type EstadoDeCamara = { ok: true } | { ok: false; motivo: string };
export async function comprobarCamara(): Promise<EstadoDeCamara> {
  if (typeof window === 'undefined') return { ok: false, motivo: 'La cámara solo se puede usar desde el navegador.' };
  if (!window.isSecureContext) {
    return { ok: false, motivo: 'Esta computadora abrió el panel sin conexión segura (https) y el navegador no presta la cámara. Abre el panel con la dirección https del gimnasio (la instala la gerencia) o registra el rostro en la computadora donde corre GymFlow.' };
  }
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, motivo: 'Este navegador no puede usar la cámara. Usa Chrome o Edge actualizados.' };
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    s.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) {
    const nombre = (e as { name?: string } | null)?.name;
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return { ok: false, motivo: 'El navegador tiene bloqueada la cámara para esta página. Toca el candado de la barra de direcciones, permite la cámara y vuelve a intentar.' };
    if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return { ok: false, motivo: 'Esta computadora no tiene una cámara conectada.' };
    if (nombre === 'NotReadableError' || nombre === 'AbortError') return { ok: false, motivo: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentar.' };
    return { ok: false, motivo: 'No se pudo encender la cámara de esta computadora.' };
  }
}
