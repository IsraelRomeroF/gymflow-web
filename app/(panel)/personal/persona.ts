import { effectiveSections } from '@gymflow/core/secciones';
import { SECCIONES } from '@/modules/registro';
import { SECCIONES_LLAVE, tiene } from '@/components/llave-secciones';
import type { Ajustes } from '@/components/permisos-persona';

/** Una cuenta del personal tal como la cuenta `GET /users`. */
export type Persona = {
  id: string; email: string; fullName: string; phoneE164: string | null; isActive: boolean;
  lastLoginAt: string | null; role: { key: string; name: string } | null; branchIds: string[];
  mustChangePassword?: boolean;
  /** Su temporal ya no abre (dura 7 días): se le da otra (A4-N1). */
  temporaryExpired?: boolean;
  temporaryExpiresAt?: string | null;
  /** Gerente nuevo al que la dueña todavía no le decide qué ve (17-06). */
  sectionsReviewPending?: boolean;
  /** Secciones de Dirección y Cumplimiento que el dueño le liberó; null = es el dueño. */
  unlockedSections?: string[] | null;
  /** Ajustes sobre su puesto (recepción y coach); null = no se le ajustan. */
  permissionOverrides?: Ajustes | null;
};

/** Un puesto (cuatro desde el 2026-10-05): qué hace, su alcance y cuántos lo tienen (ADR-039). */
export type Rol = {
  key: string; name: string; permissions: number; assignable: boolean;
  description: string | null; sees: string | null; scope: 'org' | 'branch' | 'any'; inUse: number;
};

/** El estado de una cuenta en una sola insignia (UX5-G-08): lo que pide atención va primero. */
export function estadoCuenta(p: Persona): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (!p.isActive) return { label: 'Dada de baja', tone: 'neutral' };
  // Vencida ya no abre: «Aún no entra» hacía creer que bastaba con esperar.
  if (p.mustChangePassword && p.temporaryExpired) return { label: 'Temporal vencida', tone: 'danger' };
  if (p.mustChangePassword) return { label: p.lastLoginAt ? 'Contraseña temporal' : 'Aún no entra', tone: 'warn' };
  return { label: 'Activa', tone: 'ok' };
}

/**
 * LAS SECCIONES CON EFECTO PARA UN PUESTO (17-05). La llave solo quita: abrirle
 * Tablero a una recepcionista no le daba nada, porque su puesto no trae esa
 * pantalla. Son las de las pantallas que su puesto sí trae (`effectiveSections`
 * del núcleo; `registro.test.ts` la compara con los `puestos` del registro).
 */
export function llavesConEfecto(puesto: string | null | undefined): ReadonlySet<string> {
  if (!puesto) return new Set();
  // La regla es del núcleo (`effectiveSections`), la misma con que la API debe validar la llave.
  return new Set(effectiveSections(puesto));
}

/** Las secciones de la llave que tienen efecto para ese puesto, en el orden de siempre. */
export function seccionesConEfecto(puesto: string | null | undefined) {
  const efecto = llavesConEfecto(puesto);
  return SECCIONES_LLAVE.filter((x) => efecto.has(x.key));
}

/** El módulo de producto de cada sección: si el gimnasio lo apagó, liberarla no se nota hoy. */
export function moduloDeLlave(llave: string): string | null {
  return SECCIONES.find((s) => s.llave === llave)?.modulo ?? null;
}

/** Solo lo que tiene efecto para el puesto: lo demás no hace nada y no se guarda (17-05). */
export function soloConEfecto(lista: readonly string[], puesto: string | null | undefined): string[] {
  const efecto = llavesConEfecto(puesto);
  return lista.filter((k) => efecto.has(k.replace(/^-/, '')));
}

/**
 * La nota de la lista: qué ve de lo que la dueña libera, contado sobre lo que
 * de verdad aplica a su puesto («Ve 1 de 3»; antes «1 de 12» a una
 * recepcionista con 9 pantallas que su puesto nunca le daría).
 */
export function resumenLlave(p: Persona): string | null {
  if (p.unlockedSections === null || p.unlockedSections === undefined || !p.role) return null;
  const secciones = seccionesConEfecto(p.role.key);
  const liberables = secciones.filter((x) => !x.abierta);
  const vistas = liberables.filter((x) => tiene(x, p.unlockedSections!)).length;
  const quitadas = secciones.filter((x) => x.abierta && !tiene(x, p.unlockedSections!)).map((x) => x.name);
  if (liberables.length === 0 && quitadas.length === 0) return null;
  const base = vistas === 0 ? 'Solo operación' : `Ve ${vistas} de ${liberables.length} de Dirección y Cumplimiento`;
  return `${base}${quitadas.length ? ` · sin ${quitadas.join(' ni ')}` : ''}`;
}

/** Lo que la persona ve hoy de lo que libera la dueña, en palabras («Retención y Planes»). */
export function queVeHoy(p: Persona): string[] {
  if (!p.role || !p.unlockedSections) return [];
  return seccionesConEfecto(p.role.key).filter((x) => !x.abierta && tiene(x, p.unlockedSections!)).map((x) => x.name);
}

/** ¿Este gerente administra al personal? Activo y con Personal liberado (17-04, D17-05). */
export const administra = (p: Persona) => p.isActive && p.role?.key === 'MANAGER' && (p.unlockedSections ?? []).includes('personal');

export const frase = (xs: readonly string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(xs);
