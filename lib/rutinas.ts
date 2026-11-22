/** Contratos y etiquetas de rutinas, compartidos por el editor, la lista y la ficha. */

export type Grupo = 'CHEST' | 'BACK' | 'SHOULDERS' | 'BICEPS' | 'TRICEPS' | 'LEGS' | 'GLUTES' | 'ABS';

export const GRUPOS: ReadonlyArray<{ value: Grupo; label: string }> = [
  { value: 'CHEST', label: 'Pecho' }, { value: 'BACK', label: 'Espalda' }, { value: 'SHOULDERS', label: 'Hombro' },
  { value: 'BICEPS', label: 'Bíceps' }, { value: 'TRICEPS', label: 'Tríceps' }, { value: 'LEGS', label: 'Pierna' },
  { value: 'GLUTES', label: 'Glúteo' }, { value: 'ABS', label: 'Abdomen' },
];
export const GRUPO: Record<string, string> = Object.fromEntries(GRUPOS.map((g) => [g.value, g.label]));

export const OBJETIVOS: Record<string, string> = {
  HIPERTROFIA: 'Masa muscular', FUERZA: 'Fuerza', RESISTENCIA: 'Resistencia',
  PERDIDA_PESO: 'Pérdida de peso', GENERAL: 'Acondicionamiento general',
};
export const NIVELES: Record<string, string> = { PRINCIPIANTE: 'Principiante', INTERMEDIO: 'Intermedio', AVANZADO: 'Avanzado' };

export const DESCANSOS = [30, 45, 60, 90, 120, 180] as const;
export const descanso = (s: number | null) => (s === null ? '—' : s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`);

export type Ejercicio = { id: string; name: string; muscleGroup: Grupo; equipment: string | null; instructions: string | null; custom: boolean };
export type Item = {
  exerciseId: string; sets: number; reps: string; restSeconds: number | null; notes: string | null;
  exercise: { name: string; muscleGroup: Grupo; equipment: string | null; instructions: string | null };
};
export type Rutina = {
  id: string; name: string; goal: string | null; level: string | null; notes: string | null;
  updatedAt: string; archived: boolean;
  /** Cuántos socios la tienen hoy: editarla les cambia la suya (12-05). */
  activeMembers: number;
  /** Copia personal de un socio («Personalizar para…»): no sale en el catálogo. */
  personalFor: { memberId: string; name: string | null } | null;
  days: Array<{ name: string; items: Item[] }>;
};
export type Resumen = {
  id: string; name: string; goal: string | null; level: string | null;
  days: number; dayNames: string[]; exercises: number; activeMembers: number; updatedAt: string;
};

/** «Revisar en»: las semanas que se ofrecen al asignar; seis por omisión (12-09). */
export const SEMANAS_DE_REVISION = [4, 6, 8] as const;
export type SemanasDeRevision = (typeof SEMANAS_DE_REVISION)[number];
export const REVISION_POR_OMISION: SemanasDeRevision = 6;

/** «hoy», «hace 5 días», «hace 6 semanas»: desde cuándo tiene el socio su rutina. */
export function haceSemanas(iso: string, ahora = new Date()): string {
  const dias = Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 86_400_000));
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 14) return `hace ${dias} días`;
  return `hace ${Math.round(dias / 7)} semanas`;
}
