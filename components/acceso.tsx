'use client';

import type { AccessSummaryItem } from '@gymflow/core/contracts';
import { fecha } from '@/lib/format';
import { useResumenAccesoPorLotes } from '@/lib/resumen-acceso';
import { Badge } from './ui';

/**
 * El resumen de acceso de un socio: el contrato del núcleo (`GET
 * /members/access-summary`, fase 1.1/1.4) más la política del gimnasio, que la
 * respuesta trae una vez y aquí se reparte a cada fila para que diga lo mismo
 * que la puerta (UX4-01). `membership.paidThrough` es el último día que cubren
 * sus cuotas PAGADAS (3-01): menor que `coveredThrough` = su periodo en curso
 * no está pagado.
 */
export type ResumenAcceso = AccessSummaryItem & { allowWhilePastDue?: boolean };

/**
 * Resumen de acceso de los socios que se ven en pantalla.
 * `version` cambia cuando algo pudo moverlo (una venta, un cobro) y lo vuelve a pedir.
 * Es lo que decide la insignia: el estado del socio ("activo") no dice si
 * puede entrar; esto sí, con la misma regla que la puerta.
 *
 * Delega en el cálculo por lotes de `lib/resumen-acceso.ts` (2-06): una sola
 * manera de pedirlo. Este conserva la forma de siempre (solo el mapa) para la
 * ficha y la entrada, que piden uno o unos pocos.
 */
export function useResumenAcceso(ids: readonly string[], version = ''): Map<string, ResumenAcceso> {
  return useResumenAccesoPorLotes(ids, version).mapa;
}

/**
 * ¿Su periodo en curso está sin pagar? Lo dice `paidThrough` (3-01): si lo
 * pagado no llega al fin del periodo, le toca pagar aunque siga activa (4-14,
 * el día de corte). Sin el dato, no se presume nada.
 */
function periodoSinPagar(m: NonNullable<ResumenAcceso['membership']>): boolean {
  return !!m.paidThrough && m.paidThrough < m.coveredThrough;
}

/**
 * La línea del veredicto verde (UX7 Mostrador 6): lo que recepción confirma
 * en voz alta — plan y hasta cuándo — y si vence en 3 días o menos.
 */
export function vigenciaEntrada(r: ResumenAcceso | undefined, hoy = new Date()): { texto: string; vencePronto: boolean } | null {
  if (!r) return null;
  const dias = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - hoy.getTime()) / 86_400_000);
  const m = r.membership;
  if (m && (m.status === 'ACTIVE' || m.status === 'TRIALING' || m.status === 'PAST_DUE')) {
    const plan = m.planName ?? (m.status === 'TRIALING' ? 'Prueba' : 'Membresía');
    if (m.status === 'PAST_DUE' && m.graceUntil) return { texto: `${plan} · pago pendiente, entra hasta ${fecha(m.graceUntil)}`, vencePronto: true };
    // El día de corte entra, pero recepción le cobra al pasar (4-14).
    if (m.status === 'ACTIVE' && periodoSinPagar(m)) return { texto: `${plan} · le toca pagar (pagado hasta ${fecha(m.paidThrough!)})`, vencePronto: true };
    return { texto: `${plan} · vigente hasta ${fecha(m.coveredThrough)}`, vencePronto: dias(m.coveredThrough) <= 3 };
  }
  // El pase del día (1.8): vale hoy, en la sede donde se vendió.
  if (r.dayPass) return { texto: 'Pase del día · vale hoy', vencePronto: false };
  if (r.pack && r.pack.status === 'ACTIVE') {
    const quedan = r.pack.visitsLeft;
    return {
      texto: `Paquete · le ${quedan === 1 ? 'queda 1 visita' : `quedan ${quedan} visitas`}${r.pack.expiresOn ? ` · vence ${fecha(r.pack.expiresOn)}` : ''}`,
      vencePronto: quedan <= 1 || (!!r.pack.expiresOn && dias(r.pack.expiresOn) <= 3),
    };
  }
  return null;
}

/** En palabras de recepción, y con el mismo vocabulario que el portal. */
function textoAcceso(r: ResumenAcceso): { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' } {
  const m = r.membership;
  // Con pase del día de hoy (1.8) entra aunque no tenga membresía que lo habilite: lo mismo que dirá la puerta.
  if (r.dayPass && !(m && (m.status === 'ACTIVE' || m.status === 'TRIALING' || m.status === 'PAST_DUE'))) {
    return { label: 'Pase del día · entra hoy', tone: 'ok' };
  }
  if (m) {
    switch (m.status) {
      // El día de corte no está «al corriente»: su periodo nuevo no se ha pagado (4-14).
      case 'ACTIVE': return periodoSinPagar(m)
        ? { label: `Le toca pagar · pagado hasta ${fecha(m.paidThrough!)}`, tone: 'warn' }
        : { label: `Al corriente · hasta ${fecha(m.coveredThrough)}`, tone: 'ok' };
      case 'TRIALING': return { label: 'En prueba', tone: 'info' };
      // Lo mismo que dirá la puerta: si el gimnasio no deja pasar en mora, se cobra al entrar.
      case 'PAST_DUE': return r.allowWhilePastDue
        ? { label: m.graceUntil ? `Pago pendiente · entra hasta ${fecha(m.graceUntil)}` : 'Pago pendiente · entra', tone: 'warn' }
        : { label: 'Pago pendiente · cóbrale al entrar', tone: 'warn' };
      case 'SUSPENDED': return { label: 'Suspendida · no entra', tone: 'danger' };
      case 'FROZEN': return { label: 'Congelada', tone: 'info' };
      case 'PENDING': return { label: 'Por activar · falta el pago', tone: 'warn' };
    }
  }
  if (r.pack) {
    if (r.pack.status === 'PENDING_PAYMENT') return { label: 'Paquete sin pagar', tone: 'warn' };
    return r.canEnter
      ? { label: `Paquete · ${r.pack.visitsLeft} ${r.pack.visitsLeft === 1 ? 'visita' : 'visitas'}`, tone: 'ok' }
      : { label: 'Paquete agotado o vencido', tone: 'danger' };
  }
  return { label: 'Sin plan', tone: 'neutral' };
}

/** La insignia única de "¿puede entrar?" para búsqueda, padrón y ficha. */
export function AccesoBadge({ resumen, archivado }: { resumen: ResumenAcceso | undefined; archivado?: boolean }) {
  if (archivado) return <Badge dot>Dado de baja</Badge>;
  if (!resumen) return <Badge dot>…</Badge>;
  const t = textoAcceso(resumen);
  return <Badge tone={t.tone === 'neutral' ? undefined : t.tone} dot>{t.label}</Badge>;
}
