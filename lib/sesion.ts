/**
 * LA SESIÓN EN EL NAVEGADOR (bloque 1.12 · 24-04, 24-06, 24-07, 24-08, 24-13, 24-15).
 *
 * - Cuando la sesión termina, se va al login diciendo POR QUÉ (`/login?motivo=…`)
 *   y A DÓNDE volver (`&volver=/autorizaciones`): la firma que llegó al
 *   teléfono vence en 10 minutos y no se puede perder buscando la pantalla.
 * - Salir apaga los avisos de ESTE equipo y borra lo que el panel guardó en
 *   el navegador; solo se queda la apariencia (tema y lateral), que es del equipo.
 *
 * El motivo en la dirección va en palabras («vencida», «otro-equipo»), no
 * con el código de la API: es lo que se ve en la barra del navegador.
 */
import { api, type MotivoDeFinDeSesion } from './api';

export type MotivoDeSalida =
  | 'vencida' | 'inactividad' | 'cerrada' | 'otro-equipo' | 'todos' | 'contrasena' | 'temporal-nueva'
  | 'baja' | 'permisos' | 'bloqueada' | 'temporal' | 'temporal-vencida' | 'suspendido' | 'no-liberado' | 'red';

/** Del porqué de la API a la palabra del login. `NO_SESSION` se decide con lo que recuerda este navegador. */
const DE_LA_API: Record<Exclude<MotivoDeFinDeSesion, 'NO_SESSION' | 'PLATFORM_ACCOUNT'>, MotivoDeSalida> = {
  SESSION_EXPIRED: 'vencida',
  SESSION_IDLE: 'inactividad',
  SESSION_LOGGED_OUT: 'cerrada',
  SESSION_CLOSED_ELSEWHERE: 'otro-equipo',
  SESSION_CLOSED_EVERYWHERE: 'todos',
  PASSWORD_CHANGED: 'contrasena',
  PASSWORD_RESET: 'temporal-nueva',
  ACCOUNT_DEACTIVATED: 'baja',
  ACCESS_CHANGED: 'permisos',
  ACCOUNT_LOCKED: 'bloqueada',
  TEMPORARY_PASSWORD: 'temporal',
  TEMPORARY_PASSWORD_EXPIRED: 'temporal-vencida',
  SERVICE_SUSPENDED: 'suspendido',
  SERVICE_PENDING: 'no-liberado',
  NETWORK_NOT_ALLOWED: 'red',
  SESSION_REVOKED: 'cerrada',
};

/** Lo que dice el login, ARRIBA del formulario, según por qué se llegó ahí. */
export const AVISO_DE_SALIDA: Record<MotivoDeSalida, { tono: 'info' | 'warn' | 'danger'; titulo: string; texto: string }> = {
  vencida: { tono: 'info', titulo: 'Tu sesión terminó', texto: 'Cada sesión dura un tiempo fijo desde que entras, aunque la sigas usando. Vuelve a entrar para seguir.' },
  inactividad: { tono: 'info', titulo: 'Tu sesión se cerró por inactividad', texto: 'Vuelve a entrar.' },
  cerrada: { tono: 'info', titulo: 'Tu sesión se cerró', texto: 'Vuelve a entrar para seguir.' },
  'otro-equipo': { tono: 'warn', titulo: 'Tu sesión se cerró desde otro equipo', texto: 'Alguien con tu cuenta tocó «Cerrar las demás» en otro equipo. Si no fuiste tú, entra y cambia tu contraseña.' },
  todos: { tono: 'info', titulo: 'Se cerró tu sesión en todos los equipos', texto: 'Vuelve a entrar para seguir.' },
  contrasena: { tono: 'warn', titulo: 'Tu contraseña cambió', texto: 'Se cambió desde otro equipo y esta sesión se cerró. Entra con la nueva. Si no fuiste tú, pide a tu gerente una contraseña temporal.' },
  'temporal-nueva': { tono: 'info', titulo: 'Te dieron una contraseña temporal nueva', texto: 'Tus sesiones se cerraron. Entra con la temporal para elegir la tuya.' },
  baja: { tono: 'danger', titulo: 'Tu cuenta se dio de baja', texto: 'Ya no puedes entrar a este gimnasio. Si crees que es un error, pregúntale a tu gerente.' },
  permisos: { tono: 'info', titulo: 'Cambió lo que puedes ver', texto: 'Cambiaron tu puesto o tus permisos. Vuelve a entrar para ver lo nuevo.' },
  bloqueada: { tono: 'danger', titulo: 'Tu cuenta se bloqueó por intentos fallidos', texto: 'Espera unos minutos y vuelve a entrar.' },
  temporal: { tono: 'info', titulo: 'Primero elige tu contraseña', texto: 'Con la contraseña temporal solo puedes elegir la tuya. Entra con ella.' },
  'temporal-vencida': { tono: 'danger', titulo: 'Tu contraseña temporal venció', texto: 'Dura 7 días. Pide una nueva a quien te la dio.' },
  suspendido: { tono: 'danger', titulo: 'El servicio de tu gimnasio está suspendido', texto: 'Mientras tanto nadie del gimnasio puede entrar. Pregunta a GymFlow.' },
  'no-liberado': { tono: 'warn', titulo: 'El servicio de tu gimnasio todavía no está liberado', texto: 'Pregunta a GymFlow.' },
  red: { tono: 'danger', titulo: 'Esta red no puede entrar a la consola', texto: 'Entra desde una red permitida.' },
};

export function esMotivoDeSalida(m: string | null | undefined): m is MotivoDeSalida {
  return !!m && Object.prototype.hasOwnProperty.call(AVISO_DE_SALIDA, m);
}

// ── Lo que recuerda este navegador de su sesión ───────────────────────────────

/** Cuándo se cierra la sesión abierta en este navegador (reloj de este equipo). */
const CLAVE_FIN = 'gf-sesion-fin';

/** `segundos`: lo que le queda según el servidor; se cuenta con el reloj de aquí, como la cookie. */
export function recordarFin(segundos: number): number {
  const fin = Date.now() + Math.max(0, segundos) * 1000;
  try { localStorage.setItem(CLAVE_FIN, String(fin)); } catch { /* sin almacenamiento: el login no sabrá decir «terminó» */ }
  return fin;
}

function finRecordado(): number | null {
  try { const n = Number(localStorage.getItem(CLAVE_FIN)); return Number.isFinite(n) && n > 0 ? n : null; } catch { return null; }
}

/**
 * La palabra del login para un porqué de la API. Sin cookie (`NO_SESSION`)
 * la API no sabe qué pasó: si este navegador tenía una sesión y ya llegó su
 * hora, terminó; si tenía una y no, se cerró; si nunca tuvo, no hay aviso.
 */
export function motivoDeSalida(reason: string | null | undefined): MotivoDeSalida | null {
  if (reason && reason in DE_LA_API) return DE_LA_API[reason as keyof typeof DE_LA_API];
  const fin = finRecordado();
  if (fin === null) return null;
  return Date.now() >= fin - 60_000 ? 'vencida' : 'cerrada';
}

// ── A dónde volver ─────────────────────────────────────────────────────────────

/**
 * Solo rutas de AQUÍ: empieza con una sola «/», sin esquema ni otro servidor,
 * y nunca el login ni la API. Lo que no cumple se ignora y se va al inicio.
 */
export function volverSeguro(ruta: string | null | undefined): string | null {
  if (!ruta || ruta.length > 512 || !ruta.startsWith('/') || ruta.startsWith('//') || ruta.startsWith('/\\')) return null;
  // Ni caracteres de control ni «\»: el navegador los convierte en «/» y la ruta saldría del sitio.
  if ([...ruta].some((c) => c.charCodeAt(0) < 32 || c === '\\')) return null;
  let u: URL;
  try { u = new URL(ruta, 'http://gymflow.invalid'); } catch { return null; }
  if (u.origin !== 'http://gymflow.invalid') return null;
  if (u.pathname === '/' || u.pathname === '/login' || u.pathname.startsWith('/login/') || u.pathname === '/api' || u.pathname.startsWith('/api/')) return null;
  return `${u.pathname}${u.search}${u.hash}`;
}

/** Tras entrar: a donde iba, si es de su lado (la consola o el panel); si no, a su inicio. */
export function destinoTrasEntrar(volver: string | null | undefined, plataforma: boolean): string {
  const v = volverSeguro(volver);
  const deConsola = !!v && (v === '/plataforma' || v.startsWith('/plataforma/') || v.startsWith('/plataforma?'));
  if (plataforma) return v && deConsola ? v : '/plataforma';
  return v && !deConsola ? v : '/panel';
}

export function rutaDeEntrada(motivo: MotivoDeSalida | null, volver: string | null): string {
  const q = new URLSearchParams();
  if (motivo) q.set('motivo', motivo);
  const v = volverSeguro(volver);
  if (v) q.set('volver', v);
  const s = q.toString();
  return s ? `/login?${s}` : '/login';
}

export function rutaActual(): string | null {
  return typeof window === 'undefined' ? null : `${window.location.pathname}${window.location.search}`;
}

/**
 * La sesión terminó a media pantalla: al login, de una vez y sin volver a
 * intentar nada (24-06). Es una carga completa, así no queda nada del panel
 * ofreciendo botones que ya no sirven. Solo la primera vez cuenta.
 */
let yendo = false;
export function irAEntrar(reason: MotivoDeFinDeSesion | null | undefined): void {
  if (yendo || typeof window === 'undefined') return;
  yendo = true;
  // Una cuenta de la plataforma en el panel de un gimnasio: su lugar es la consola.
  if (reason === 'PLATFORM_ACCOUNT') { window.location.replace('/plataforma'); return; }
  window.location.replace(rutaDeEntrada(motivoDeSalida(reason), rutaActual()));
}

/**
 * «Volver a entrar ahora», poco antes del tope: cierra ESTA sesión sin apagar
 * los avisos (la persona regresa enseguida) y va al login con la pantalla
 * donde estaba, para empezar una sesión completa.
 */
export async function volverAEntrar(): Promise<void> {
  await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
  if (yendo) return;
  yendo = true;
  window.location.replace(rutaDeEntrada(null, rutaActual()));
}

/**
 * ¿Vale la pena mostrar la IP de una sesión? La de esta misma computadora
 * (127.0.0.1) no dice nada: en el gimnasio todos llegan por el panel local.
 */
export function ipVisible(ip: string | null | undefined): ip is string {
  return !!ip && !/^(127\.|::1$|::ffff:127\.)/.test(ip);
}

// ── Salir de este equipo ─────────────────────────────────────────────────────

/** La suscripción de avisos de ESTE navegador, si tiene (DP-10). */
export async function suscripcionDeAvisos(): Promise<PushSubscription | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch { return null; }
}

/** Apaga los avisos aquí: la suscripción y las notificaciones que siguen a la vista (con su resumen e importe). */
async function apagarAvisosAqui(sub: PushSubscription | null): Promise<void> {
  try { await sub?.unsubscribe(); } catch { /* la del servidor ya se borró: no llegan más */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
    for (const n of (await reg?.getNotifications()) ?? []) n.close();
  } catch { /* sin trabajador de avisos: no hay nada a la vista */ }
}

/** Lo que el panel guardó en este navegador. Se quedan la apariencia del equipo (tema y lateral). */
const SE_QUEDAN: ReadonlySet<string> = new Set(['gf-tema', 'gf-lateral']);
export function limpiarNavegador(): void {
  try { sessionStorage.clear(); } catch { /* sin almacenamiento de pestaña */ }
  try {
    for (const k of Object.keys(localStorage)) if (!SE_QUEDAN.has(k)) localStorage.removeItem(k);
  } catch { /* sin almacenamiento */ }
  try {
    if (typeof caches !== 'undefined') void caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => undefined);
  } catch { /* sin caché */ }
}

/** El login dice «Saliste…» una vez, en la pestaña donde se salió (sin tocar la dirección). */
const CLAVE_SALIDA = 'gf-salida';
export function leerSalida(): { avisos: boolean } | null {
  try {
    const v = sessionStorage.getItem(CLAVE_SALIDA);
    sessionStorage.removeItem(CLAVE_SALIDA);
    return v ? { avisos: v === 'avisos' } : null;
  } catch { return null; }
}

/**
 * «Cerrar sesión» (24-15): el servidor cierra la sesión y borra la
 * suscripción de avisos de este equipo; aquí se apagan las notificaciones a
 * la vista y se borra lo guardado. Nunca falla: sin red, igual se limpia.
 */
export async function salirDeEsteEquipo(ruta: '/auth/logout' | '/platform/logout' = '/auth/logout'): Promise<void> {
  const sub = await suscripcionDeAvisos();
  const r = await api<{ notificationsOff?: number }>(ruta, { method: 'POST', body: JSON.stringify(sub ? { endpoint: sub.endpoint } : {}) }).catch(() => null);
  await apagarAvisosAqui(sub);
  limpiarNavegador();
  try { sessionStorage.setItem(CLAVE_SALIDA, sub || (r?.notificationsOff ?? 0) > 0 ? 'avisos' : 'sesion'); } catch { /* el login no dirá «Saliste» */ }
}
