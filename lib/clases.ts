import { ATTENDANCE_WINDOW } from '@gymflow/core';
import type { ClassBookingPayment } from '@gymflow/core/contracts';

/*
 * CLASES — lo que comparten la página, la lista de la sesión, «Inscribir a
 * una clase» y la tarjeta de la ficha (bloque 2.5). Antes `Sesion` y la
 * ventana del pase de lista estaban escritas en tres archivos.
 */

/** La sesión como la devuelve `GET /classes/schedules`. */
export type Sesion = {
  id: string; branchId?: string; classTypeId: string; className: string | null; room: string | null;
  startsAt: string; endsAt: string; capacity: number; bookedCount: number; status: 'SCHEDULED' | 'CANCELED' | 'CLOSED';
  coachUserId?: string | null; coachName?: string | null;
  /** `null` en una sesión única (fuera del horario semanal). */
  templateId?: string | null;
};

export type Tipo = {
  id: string; name: string; description: string | null; defaultDurationMin: number; defaultCapacity: number;
  dropInPriceCents: string; isActive: boolean; includableInPlans: boolean;
};
export type Slot = { weekday: number; startMinute: number; durationMin: number; capacity: number };
export type Plantilla = {
  id: string; branchId: string; classTypeId: string; className: string | null; room: string | null;
  effectiveFrom: string; slots: Slot[]; coachUserId: string | null; coachName: string | null;
  /** Último día en que se da, incluido; `null` si no tiene fin. */
  until: string | null;
};

/** Lunes primero, como se lee un horario en México. `weekday` 0 = domingo. */
export const DIAS = [
  { w: 1, corto: 'Lun', largo: 'lunes' }, { w: 2, corto: 'Mar', largo: 'martes' }, { w: 3, corto: 'Mié', largo: 'miércoles' },
  { w: 4, corto: 'Jue', largo: 'jueves' }, { w: 5, corto: 'Vie', largo: 'viernes' }, { w: 6, corto: 'Sáb', largo: 'sábado' },
  { w: 0, corto: 'Dom', largo: 'domingo' },
] as const;

export const aHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const deHora = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** «Lun 07:00, Mié 07:00»: los bloques de un horario, en una línea. */
export const bloquesEnTexto = (slots: readonly Slot[]) => slots.map((s) => `${DIAS.find((x) => x.w === s.weekday)?.corto} ${aHora(s.startMinute)}`).join(', ');

/**
 * La misma ventana que la API (`ATTENDANCE_WINDOW` del núcleo): la lista se
 * abre una hora antes y se cierra media hora después de terminar.
 */
export function momentoDeClase(s: Pick<Sesion, 'startsAt' | 'endsAt'>, ahora = Date.now()): 'PROXIMA' | 'LISTA' | 'EN_CURSO' | 'TERMINADA' {
  const ini = new Date(s.startsAt).getTime();
  const fin = new Date(s.endsAt).getTime();
  if (ahora > fin + ATTENDANCE_WINDOW.afterMin * 60_000) return 'TERMINADA';
  if (ahora >= ini) return 'EN_CURSO';
  return ahora >= ini - ATTENDANCE_WINDOW.beforeMin * 60_000 ? 'LISTA' : 'PROXIMA';
}

/** Cómo va el dinero de un lugar, en palabras del mostrador. */
export function textoDePago(pago: ClassBookingPayment, falta: string | null): string {
  if (pago === 'PENDING') return falta ? `Por pagar ${falta}` : 'Por pagar';
  if (pago === 'PAID') return 'Pagada';
  if (pago === 'WAIVED') return 'Sin cobro';
  return 'Incluida';
}

/** «2 horas», «90 minutos», «1 día»: un plazo en minutos, como se dice. */
export function plazoEnTexto(minutos: number): string {
  if (minutos === 0) return 'el inicio de la clase';
  if (minutos % 1440 === 0) return minutos === 1440 ? '1 día' : `${minutos / 1440} días`;
  if (minutos % 60 === 0) return minutos === 60 ? '1 hora' : `${minutos / 60} horas`;
  return `${minutos} minutos`;
}
