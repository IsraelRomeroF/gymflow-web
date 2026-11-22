import { isErrorReason, type ErrorReason } from '@gymflow/core/errors';
import { SESSION_END_REASONS, type SessionEndReason } from '@gymflow/core/vocabulario';

/**
 * Cliente de la API. `credentials: 'include'` es obligatorio: la sesión viaja
 * en una cookie HttpOnly, no en un token en memoria (ADR-008).
 */
export class ApiError extends Error {
  /**
   * `detail` trae, cuando la API lo manda, la lista de problemas por campo
   * (JSON). Es lo que permite marcar cada campo del formulario en vez de un
   * solo mensaje arriba.
   */
  constructor(readonly status: number, message: string, readonly detail?: string, readonly data?: Record<string, unknown>) {
    super(message);
  }

  /** El porqué estable que manda la API (`reason`), si lo manda: el 401 de sesión dice por qué terminó. */
  get reason(): string | undefined {
    return typeof this.data?.reason === 'string' ? this.data.reason : undefined;
  }
}

/**
 * El porqué de NEGOCIO de un error (catálogo `ERROR_REASONS` del núcleo,
 * bloque 1.2, 28-13), o null si la API no mandó uno del catálogo. Con esto
 * una pantalla ofrece lo que toca («Abre un turno» frente a «Ya se cobró»)
 * sin leer el texto ni adivinar por el código HTTP:
 *
 *   if (motivoDe(e) === 'NO_OPEN_REGISTER') ofrecerAbrirTurno();
 *
 * Los porqués de fin de sesión no salen por aquí: son de `finDeSesion`.
 */
export function motivoDe(e: unknown): ErrorReason | null {
  if (!(e instanceof ApiError)) return null;
  const r = e.reason;
  return isErrorReason(r) ? r : null;
}

/**
 * Los porqués de un 401 de SESIÓN (bloque 1.12, 24-06): la sesión terminó y
 * hay que volver a entrar. Un 401 sin ellos es otra cosa (la contraseña de
 * quien firma, la actual al cambiarla) y no saca a nadie del panel.
 * La lista es la del núcleo (`SESSION_END_REASONS`, fase 1.1): la misma que
 * usa la API, más `PLATFORM_ACCOUNT` (una cuenta de la plataforma en el panel
 * de un gimnasio).
 */
export const MOTIVOS_DE_FIN_DE_SESION = SESSION_END_REASONS;
export type MotivoDeFinDeSesion = SessionEndReason;

/** ¿Este error dice que la sesión terminó? Devuelve el porqué, o null si es otro error. */
export function finDeSesion(e: unknown): MotivoDeFinDeSesion | null {
  if (!(e instanceof ApiError) || e.status !== 401) return null;
  const r = e.reason;
  return r && (MOTIVOS_DE_FIN_DE_SESION as readonly string[]).includes(r) ? r as MotivoDeFinDeSesion : null;
}

/**
 * UN solo lugar para la sesión que muere a media jornada (24-06): el marco
 * del panel (y el de la consola) se registra aquí y, con el primer 401 de
 * sesión, lleva al login con el motivo y la pantalla donde estaba. Antes
 * cada botón decía «Sesión requerida» en un aviso y la persona seguía viendo
 * un panel que ya no servía. Devuelve con qué darse de baja.
 */
let alPerder: ((motivo: MotivoDeFinDeSesion) => void) | null = null;
export function alPerderSesion(fn: ((motivo: MotivoDeFinDeSesion) => void) | null): () => void {
  alPerder = fn;
  return () => { if (alPerder === fn) alPerder = null; };
}

/**
 * Reconfirmación de la consola de plataforma: si la API responde
 * REAUTH_REQUIRED, el marco de la plataforma pide la contraseña y la petición
 * se repite UNA vez. Fuera de la plataforma no hay quien la atienda y el error sigue.
 */
let reconfirmar: (() => Promise<boolean>) | null = null;
export function alPedirReconfirmacion(fn: (() => Promise<boolean>) | null) { reconfirmar = fn; }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    try {
      return await apiUnaVez<T>(path, init);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.data?.error === 'REAUTH_REQUIRED' && reconfirmar && await reconfirmar()) {
        return await apiUnaVez<T>(path, init);
      }
      throw e;
    }
  } catch (e) {
    // La sesión terminó: quien esté registrado lleva al login con el motivo.
    // El error sigue su camino (quita el «cargando» de quien llamó).
    const motivo = finDeSesion(e);
    if (motivo && alPerder) alPerder(motivo);
    throw e;
  }
}

async function apiUnaVez<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      // Solo con cuerpo: un POST sin cuerpo pero con este encabezado lo rechaza
      // la API con 400 ("el cuerpo no puede estar vacío").
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    // Antes salía "Failed to fetch", en inglés (UI3-01).
    throw new ApiError(0, 'Sin conexión con el servidor. Revisa el internet y vuelve a intentar.');
  }
  const body = await res.json().catch(() => ({}));
  // `data`: la respuesta completa. Hay errores que traen con qué decidir —un
  // 409 de alta trae los posibles duplicados—, no solo un mensaje.
  if (!res.ok) {
    const mensaje = res.status >= 500 && !body.message
      ? 'El servidor tuvo un problema. Vuelve a intentar en un momento.'
      : res.status >= 500 && /internal server error/i.test(String(body.message)) ? 'El servidor tuvo un problema. Vuelve a intentar en un momento.'
        : body.message ?? 'No se pudo completar';
    throw new ApiError(res.status, mensaje, body.detail, body);
  }
  return body as T;
}
