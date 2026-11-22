'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { CAMPO } from '@gymflow/core/vocabulario';
import { api, ApiError, finDeSesion } from '@/lib/api';
import { irAEntrar, salirDeEsteEquipo } from '@/lib/sesion';
import { errorALaVista, errorEnElDialogoAbierto } from './dialogo';

export type Me = {
  userId: string;
  fullName: string | null;
  email: string | null;
  organizationId: string;
  permissions: string[];
  /** OWNER, MANAGER… La dueña solo consulta: el panel le muestra su propio inicio. */
  roleKeys?: string[];
  branchScopes: Array<string | null>;
  /** La contraseña la puso otra persona: se cambia antes de seguir (SEC2-08). */
  mustChangePassword?: boolean;
  /** Los módulos que el gimnasio tiene encendidos (ADR-036). */
  modules?: string[];
  /** Lo que cada sucursal dejó de usar aunque el gimnasio lo tenga encendido. */
  disabledByBranch?: Record<string, string[]>;
  /** Secciones de Dirección y Cumplimiento que el dueño le liberó; null = es el dueño. */
  unlockedSections?: string[] | null;
  /** Esta sesión: desde cuándo, a qué hora se cierra aunque se use y cuánto le queda según el servidor (24-04). */
  session?: { startedAt: string; endsAt: string; secondsLeft: number } | null;
};
export type Organization = { id: string; legalName: string; tradeName: string; timezone: string };
export type Branch = { id: string; code: string; name: string; timezone: string | null; isActive: boolean; publicSlug?: string | null };

type Session = {
  me: Me;
  org: Organization;
  branches: Branch[];
  branchName: (id: string | null | undefined) => string;
  /** Para el menú y la puerta: qué ve esta persona. */
  mirada: { can: (p: string) => boolean; activo: (m: string) => boolean; roles: readonly string[]; liberadas: readonly string[] | null };
  can: (permission: string) => boolean;
  /** Lo tiene sobre TODA la organización: precios y planes valen para todas las sedes. */
  canOrg: (permission: string) => boolean;
  /** ¿Puede actuar sobre esta sucursal? `null` en los alcances = todas. */
  inScope: (branchId: string) => boolean;
  /**
   * ¿Esta persona tiene el módulo a la mano? Encendido en el gimnasio y en
   * alguna de sus sucursales (con alcance de toda la organización basta el
   * gimnasio). Lo apagado no existe para nadie.
   */
  activo: (modulo: string) => boolean;
  /** ¿Está encendido en ESA sucursal? */
  activoEn: (modulo: string, branchId: string | null | undefined) => boolean;
  /** Sucursales de esta persona que NO usan el módulo, por nombre. */
  sedesSin: (modulo: string) => string[];
  /** Vuelve a pedir la sesión: tras encender o apagar un módulo, el menú cambia. */
  recargar: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

/**
 * Sesión del personal: quién es, de qué organización y qué puede hacer.
 *
 * Se carga UNA vez al entrar al panel. Cada pantalla la lee en vez de volver a
 * pedir `/auth/me`, y el menú se arma con los mismos permisos que usa la API:
 * lo que no se puede hacer, no se ofrece.
 */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<{ me: Me; org: Organization; branches: Branch[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [me, org, branches] = await Promise.all([
        api<Me>('/auth/me'),
        api<Organization>('/organization'),
        api<Branch[]>('/branches'),
      ]);
      setData({ me, org, branches });
    } catch (e) {
      // Sin sesión: al login con el motivo y la pantalla a la que volver (24-06,
      // 24-08). Quien opera la plataforma va a su consola, no al login (UX4-26).
      if (e instanceof ApiError && e.status === 401) irAEntrar(finDeSesion(e));
      else setError('No se pudo conectar con el servidor.');
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const logout = useCallback(async () => {
    // Apaga los avisos de este equipo y borra lo guardado en el navegador (24-15).
    await salirDeEsteEquipo();
    router.replace('/login');
  }, [router]);

  const value = useMemo<Session | null>(() => {
    if (!data) return null;
    const perms = new Set(data.me.permissions);
    const porId = new Map(data.branches.map((b) => [b.id, b]));
    // Una API anterior a los módulos no manda la lista: entonces todo cuenta.
    const modulos = data.me.modules ? new Set(data.me.modules) : null;
    const porSede = data.me.disabledByBranch ?? {};
    const enSede = (m: string, b: string | null | undefined) => (modulos === null || modulos.has(m)) && (!b || !(porSede[b] ?? []).includes(m));
    const misSedes = data.me.branchScopes.includes(null) ? null : (data.me.branchScopes.filter((b): b is string => b !== null));
    return {
      ...data,
      activo: (m) => (modulos === null || modulos.has(m)) && (misSedes === null || misSedes.length === 0 || misSedes.some((b) => enSede(m, b))),
      activoEn: enSede,
      sedesSin: (m) => (misSedes ?? data.branches.map((b) => b.id)).filter((b) => !enSede(m, b)).map((b) => porId.get(b)?.name ?? 'Otra sucursal'),
      recargar: cargar,
      can: (p) => perms.has(p),
      // La llave del dueño: el dueño (null) ve todo; los demás, solo lo liberado.
      mirada: { can: (p) => perms.has(p), activo: (m) => (modulos === null || modulos.has(m)) && (misSedes === null || misSedes.length === 0 || misSedes.some((b) => enSede(m, b))), roles: data.me.roleKeys ?? [], liberadas: data.me.unlockedSections === null || (data.me.roleKeys ?? []).includes('OWNER') ? null : data.me.unlockedSections ?? [] },
      canOrg: (p) => perms.has(p) && data.me.branchScopes.includes(null),
      inScope: (id) => data.me.branchScopes.includes(null) || data.me.branchScopes.includes(id),
      branchName: (id) => (id ? porId.get(id)?.name ?? 'Otra sucursal' : 'Sin sucursal'),
      logout,
    };
  }, [data, logout, cargar]);

  if (error) {
    return (
      <div className="auth-form" style={{ minHeight: '100dvh' }}>
        <div className="card card-pad" style={{ maxWidth: 420 }}>
          <p className="strong">Sin conexión</p>
          <p className="muted small mt-4">{error} Revisa que la API esté arriba y vuelve a intentar.</p>
          <button className="btn btn-primary mt-16" onClick={() => window.location.reload()}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}

// ── Avisos flotantes ────────────────────────────────────────────────────────

type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const flotante = () => {
      const id = Date.now() + Math.random();
      // Como mucho dos a la vista: una pila de avisos tapaba lo que decían (UX7).
      setItems((xs) => [...xs.slice(-1), { id, kind, text }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
    };
    // Con un diálogo abierto, el error de su acción sale EN su pie, junto al
    // botón que se pulsó, y no en la esquina (bloque 1.2): quien cobra lo ve.
    // Si el diálogo se cerró en ese mismo gesto, el error no se pierde: sale flotante.
    if (kind === 'error' && errorEnElDialogoAbierto(text)) {
      setTimeout(() => { if (!errorALaVista(text)) flotante(); }, 300);
      return;
    }
    flotante();
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'ok' ? <CircleCheck /> : <CircleAlert />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Mensaje de un error de la API, para mostrarlo tal cual. */
/** Los nombres de campo de la API (`CAMPO`) son los del vocabulario del núcleo: los mismos del portal. */

/**
 * El mensaje que se le muestra a la persona. Un 422 trae QUÉ campo falló
 * (`issues`): antes solo se veía "Datos de entrada inválidos" y recepción no
 * sabía qué corregir (UXA-12).
 */
/**
 * Los errores de un 422, por campo (UX5-G-03): `{ phoneE164: 'Debe tener 10
 * dígitos' }`. Con esto el formulario marca EL campo que falló, en vez de un
 * aviso en la esquina que la persona tiene que leer y luego buscar.
 */
export function erroresPorCampo(e: unknown, opts: { rutaCompleta?: boolean } = {}): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.data?.issues)) return {};
  const out: Record<string, string> = {};
  for (const i of e.data.issues as Array<{ path?: string; message?: string }>) {
    // Con `rutaCompleta`, "owner.email" o "receptionists.1.email": un
    // formulario con varias personas necesita saber de cuál es el correo.
    const ruta = (i.path ?? '').replace(/^\$?body\.?/, '');
    const campo = opts.rutaCompleta ? ruta : ruta.split('.').filter((x) => !/^\d+$/.test(x)).at(-1) ?? '';
    if (campo && i.message && !out[campo]) out[campo] = i.message;
  }
  return out;
}

export function errorText(e: unknown, fallback = 'Algo salió mal'): string {
  if (e instanceof ApiError && Array.isArray(e.data?.issues) && e.data.issues.length > 0) {
    return (e.data.issues as Array<{ path?: string; message?: string }>)
      .slice(0, 3)
      .map((i) => {
        const campo = (i.path ?? '').split('.').filter((x) => !/^\d+$/.test(x)).at(-1) ?? '';
        return CAMPO[campo] ? `${CAMPO[campo]}: ${i.message}` : i.message ?? '';
      })
      .filter(Boolean)
      .join(' · ') || fallback;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}
