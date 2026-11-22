'use client';

import { LOCKABLE_SECTIONS, SECTION_GROUP_NAMES, isSectionOpen, setSectionOpen } from '@gymflow/core/secciones';

/**
 * LLAVE DE SECCIONES — la lista y las dos cuentas de la llave que el dueño
 * maneja para su personal (Personal → «Qué ve», `personal/que-ve.tsx`). El
 * bloque de interruptores que vivía aquí (`SeccionesLlave`) se retiró en 2.12:
 * Personal usa `QueVe` y la consola de plataforma, su `que-ve-dueno.tsx`.
 * Operación viene abierta y se QUITA ("-clave"); Dirección y Cumplimiento se
 * liberan una por una ("clave").
 *
 * La lista, sus textos y sus reglas son las del núcleo (`LOCKABLE_SECTIONS`):
 * antes el panel tenía su propia copia con otros textos y una sección nueva
 * del núcleo no aparecía aquí (17-14, 27-02).
 */
export type GrupoDeLlave = 'Operación' | 'Dirección' | 'Cumplimiento';
export type SeccionDeLlave = { key: string; name: string; group: GrupoDeLlave; text: string; abierta?: boolean };

export const SECCIONES_LLAVE: SeccionDeLlave[] = LOCKABLE_SECTIONS.map((s) => ({
  key: s.key,
  name: s.name,
  group: SECTION_GROUP_NAMES[s.group] as GrupoDeLlave,
  text: s.text,
  ...(s.defaultOpen ? { abierta: true } : {}),
}));

/** ¿Tiene la sección? Las de Operación sí salvo "-clave"; las demás no salvo "clave". */
export const tiene = (x: { key: string }, lista: readonly string[]): boolean => isSectionOpen(x.key, lista);
/** La lista con esa sección abierta o cerrada. */
export const conSeccion = (x: { key: string }, lista: readonly string[], si: boolean): string[] => setSectionOpen(x.key, lista, si);
