'use client';

/*
 * LAS FIRMAS QUE EL MOSTRADOR ESTÁ ESPERANDO (D29-03, bloque 2.10).
 *
 * Antes, pedir una firma al teléfono de la dueña dejaba el mostrador inmóvil
 * hasta diez minutos: el diálogo tapaba la pantalla y cerrarlo cancelaba la
 * solicitud. Ahora «Seguir atendiendo» guarda la espera aquí y el marco del
 * panel la pinta como una franja (`FranjaDeFirmas`).
 *
 * Una espera tiene dos situaciones:
 *  - `atendida`: el diálogo que la pidió sigue montado (la pantalla no se
 *    dejó). Él consulta al servidor y, cuando llega la firma, la operación
 *    sigue sola como siempre. La franja solo refleja lo que él publica.
 *  - sin atender: la persona se fue a otra pantalla. La franja consulta por
 *    su cuenta y dice el desenlace; con la firma ya dada, manda de vuelta a
 *    la pantalla, y el diálogo que se abra ahí para LA MISMA operación
 *    (`clave`) retoma esta solicitud en vez de pedir otra.
 *
 * No cambia cómo se registra nada: la firma sigue atada a la operación y al
 * importe, y solo la usa la pantalla que hace la operación.
 */

import { useSyncExternalStore } from 'react';
import type { ApprovalRequestState } from '@gymflow/core/contracts';

/** `LISTA`: la firma llegó y la pantalla que la pidió ya siguió con la operación. */
export type EstadoDeEspera = ApprovalRequestState['status'] | 'LISTA';

export type Espera = {
  id: string;
  /** La operación exacta (permiso, registro, importe, sede): solo esa retoma esta solicitud. */
  clave: string;
  /** «Retiro a caja fuerte · $150.00». */
  titulo: string;
  /** A quién se le pidió. */
  quienes: string;
  /** La pantalla donde se pidió, para volver a ella. */
  ruta: string;
  estado: EstadoDeEspera;
  /** Hasta cuándo vale la pendiente, en el reloj de esta PC pero contado con el del servidor (29-06). */
  limite: number | null;
  /** Lo último que dijo el servidor: con qué pintar el desenlace. */
  solicitud: ApprovalRequestState | null;
  atendida: boolean;
  /** La persona tocó «Seguir atendiendo»: el diálogo está guardado y la franja lo representa. */
  minimizada: boolean;
};

const LLAVE = 'gymflow:firmas-en-espera';
let esperas: readonly Espera[] = [];
let cargadas = false;
const oyentes = new Set<() => void>();
/** Cómo volver a abrir el diálogo de cada espera atendida. */
const abrir = new Map<string, () => void>();

function guardar(): void {
  try {
    // Solo lo que hace falta para retomarla tras recargar; el desenlace lo vuelve a decir el servidor.
    const vivas = esperas.filter((e) => e.estado === 'PENDING' || e.estado === 'APPROVED')
      .map(({ id, clave, titulo, quienes, ruta }) => ({ id, clave, titulo, quienes, ruta }));
    if (vivas.length) window.sessionStorage.setItem(LLAVE, JSON.stringify(vivas));
    else window.sessionStorage.removeItem(LLAVE);
  } catch { /* sin almacenamiento (ventana privada): la franja vive mientras no se recargue */ }
}

function cargar(): void {
  if (cargadas || typeof window === 'undefined') return;
  cargadas = true;
  try {
    const crudo = window.sessionStorage.getItem(LLAVE);
    const lista: unknown = crudo ? JSON.parse(crudo) : [];
    if (!Array.isArray(lista)) return;
    const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
    const previas = lista.flatMap((x): Espera[] => {
      const e = x as Partial<Espera> | null;
      if (!e || !texto(e.id) || !texto(e.clave) || !texto(e.titulo) || !texto(e.ruta)) return [];
      if (esperas.some((y) => y.id === e.id)) return [];
      return [{ id: e.id, clave: e.clave, titulo: e.titulo, quienes: texto(e.quienes) ? e.quienes : '', ruta: e.ruta, estado: 'PENDING', limite: null, solicitud: null, atendida: false, minimizada: true }];
    });
    if (previas.length) esperas = [...esperas, ...previas];
  } catch { /* lo guardado no se entiende: se empieza sin esperas */ }
}

function publicar(siguiente: readonly Espera[]): void {
  esperas = siguiente;
  guardar();
  for (const o of oyentes) o();
}

/** Nace o se actualiza una espera. Lo que no se manda se conserva. */
export function ponerEspera(e: Pick<Espera, 'id'> & Partial<Espera>): void {
  cargar();
  const previa = esperas.find((x) => x.id === e.id);
  if (!previa) {
    if (!e.clave || !e.titulo || !e.ruta) return;
    publicar([...esperas, {
      id: e.id, clave: e.clave, titulo: e.titulo, quienes: e.quienes ?? '', ruta: e.ruta, estado: e.estado ?? 'PENDING',
      limite: e.limite ?? null, solicitud: e.solicitud ?? null, atendida: e.atendida ?? false, minimizada: e.minimizada ?? false,
    }]);
    return;
  }
  const nueva = { ...previa, ...e };
  if ((Object.keys(nueva) as Array<keyof Espera>).every((k) => nueva[k] === previa[k])) return;
  publicar(esperas.map((x) => (x.id === e.id ? nueva : x)));
}

export function quitarEspera(id: string): void {
  abrir.delete(id);
  if (esperas.some((x) => x.id === id)) publicar(esperas.filter((x) => x.id !== id));
}

/** El diálogo que la pidió (o el que la retomó) se hace cargo: él consulta y él sigue con la operación. */
export function atenderEspera(id: string, reabrir: () => void): void {
  abrir.set(id, reabrir);
  ponerEspera({ id, atendida: true });
}

/** El diálogo se desmontó (la persona cambió de pantalla): si seguía viva, la franja la lleva. */
export function soltarEspera(id: string): void {
  abrir.delete(id);
  const e = esperas.find((x) => x.id === id);
  if (!e) return;
  if (e.estado === 'PENDING' || e.estado === 'APPROVED') ponerEspera({ id, atendida: false, minimizada: true });
  else if (!e.minimizada) quitarEspera(id);
  else ponerEspera({ id, atendida: false });
}

/** «Ver» en la franja: vuelve a abrir el diálogo de una espera atendida. Devuelve false si ya no hay diálogo. */
export function abrirEspera(id: string): boolean {
  const fn = abrir.get(id);
  if (!fn) return false;
  fn();
  return true;
}

/** Una solicitud viva de ESTA operación que nadie atiende: el diálogo que se abre la retoma. */
export function esperaParaRetomar(clave: string): Espera | null {
  cargar();
  return esperas.find((e) => e.clave === clave && !e.atendida && (e.estado === 'PENDING' || e.estado === 'APPROVED')) ?? null;
}

const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
const VACIAS: readonly Espera[] = [];

/** Las esperas, para la franja. */
export function useEsperas(): readonly Espera[] {
  return useSyncExternalStore(suscribir, () => { cargar(); return esperas; }, () => VACIAS);
}
