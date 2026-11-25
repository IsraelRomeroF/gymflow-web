'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Circle } from 'lucide-react';
import type { MemberOnboarding } from '@gymflow/core/contracts';
import { CAMPO, PASO_DEL_ALTA } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { useCarga, type Carga } from '@/lib/carga';
import { Skeleton } from '@/components/ui';

/**
 * EL CIERRE DEL ALTA, ÚNICO (auditoría 8, bloque 2.4; 9-01, 9-17).
 *
 * Lo que falta para terminar el alta de un socio, como LISTA DE PASOS y no
 * como un párrafo, y decidido por su estado (`GET /members/:id/onboarding`):
 * el exsocio vinculado que ya tiene plan no ve «Vender membresía». Lo usan
 * «Alta aprobada» y «Alta vinculada»; la ficha lo puede montar como la franja
 * «Para terminar su alta» mientras `show` sea verdadero (bloque 2.2), y el
 * paso del rostro es el que registra el bloque 2.3 al final del alta.
 */
type Paso = MemberOnboarding['steps'][number];

export function useOnboarding(memberId: string | null): Carga<MemberOnboarding> {
  const cargar = useCallback(() => api<MemberOnboarding>(`/members/${memberId}/onboarding`), [memberId]);
  return useCarga(memberId ? cargar : null);
}

/** A dónde lleva cada paso y cómo se llama su botón. */
export function accionDelPaso(o: Pick<MemberOnboarding, 'memberId' | 'owesCents'>, key: Paso['key']): { href: string; texto: string } {
  const ficha = `/socios/${o.memberId}`;
  if (key === 'SELL') return { href: `${ficha}?vender=1`, texto: 'Vender membresía' };
  if (key === 'COLLECT') return { href: `${ficha}?tab=cuenta`, texto: `Cobrar ${pesos(o.owesCents)}` };
  // Bloque 2.3: abre el asistente de una vez (la pestaña lo lee de `registrar=rostro`).
  if (key === 'FACE') return { href: `${ficha}?tab=biometria&registrar=rostro`, texto: 'Registrar su rostro' };
  // La ficha abre «Portal de {nombre}» al llegar con `?portal=1` (bloque 2.12).
  if (key === 'PORTAL') return { href: `${ficha}?portal=1`, texto: 'Dar su código del portal' };
  return { href: ficha, texto: 'Completar sus datos' };
}

/** Lo que dice cada paso debajo de su nombre. */
function detalle(o: MemberOnboarding, p: Paso): string | null {
  if (p.key === 'SELL') return o.membership ? `${o.membership.planName ?? 'Su plan'}${o.membership.currentPeriodEnd ? ` hasta el ${fecha(o.membership.currentPeriodEnd)}` : ''}`
    // Hecho sin plan vigente (bloque 4.16): ya tuvo uno, que se canceló o venció.
    : p.done ? 'Ya tuvo plan; hoy no tiene uno vigente.' : 'Todavía no tiene plan: sin él no puede entrar.';
  if (p.key === 'COLLECT') return `Debe ${pesos(o.owesCents)}.`;
  if (p.key === 'PORTAL') return p.done ? null : 'Con su código entra al portal desde su celular. Está en su ficha.';
  if (p.key === 'FACE') return p.done ? null : 'Para entrar con su rostro. Se le pide su consentimiento ahí mismo.';
  return `Falta: ${o.missingFields.map((c) => (CAMPO[c] ?? c).toLowerCase()).join(', ')}.`;
}

export function PasosDelAlta({ carga, alPulsar }: {
  carga: Carga<MemberOnboarding>;
  /**
   * DENTRO DE LA FICHA (la franja «Para terminar su alta», bloque 2.12): cada paso se hace ahí mismo. Devuelve
   * lo que hace el botón del paso, `'enlace'` para dejar su enlace de siempre, o `null` si quien mira no puede
   * hacerlo. Con esto TODOS los pasos sin hacer llevan botón, también el que sigue: en la ficha no hay un pie
   * de diálogo que lo traiga. Sin esto (los diálogos «Alta aprobada» y «Alta vinculada»), cada paso es un enlace
   * a la ficha y el que sigue es el botón principal del diálogo.
   */
  alPulsar?: (key: Paso['key']) => (() => void) | 'enlace' | null;
}) {
  if (carga.error !== null) return <p className="small muted">No se pudo revisar qué le falta: {carga.error}. Abre su ficha para verlo.</p>;
  const o = carga.datos;
  if (!o) return <Skeleton h={120} r={12} />;
  const siguiente = o.next;
  return (
    <ol className="pasos-alta" data-testid="pasos-del-alta" aria-label="Para terminar su alta">
      {o.steps.map((p, i) => {
        const ir = accionDelPaso(o, p.key);
        const texto = detalle(o, p);
        return (
          <li key={p.key} className="paso-alta" data-paso={p.key} data-hecho={p.done} data-siguiente={p.key === siguiente}>
            <span className="paso-alta-marca" aria-hidden>{p.done ? <Check /> : <Circle />}</span>
            <div className="flex-1 min-w-0">
              <p className="small strong">{i + 1}. {p.done ? PASO_DEL_ALTA[p.key]!.hecho : PASO_DEL_ALTA[p.key]!.porHacer}{!p.done && p.optional ? <span className="tiny muted"> · opcional</span> : null}</p>
              {texto && <p className="tiny muted">{texto}</p>}
            </div>
            {/* En un diálogo, el primero sin hacer es su botón principal: aquí van los demás. En la ficha, todos. */}
            {(() => {
              if (p.done) return null;
              if (!alPulsar) return p.key !== siguiente ? <Link className="btn btn-ghost btn-sm" href={ir.href}>{ir.texto}<ArrowRight /></Link> : null;
              const hacer = alPulsar(p.key);
              if (hacer === null) return null;
              // Secundarios todos: el principal de la ficha está en su cabecera; el paso que sigue ya va resaltado.
              const clase = 'btn btn-secondary btn-sm';
              return hacer === 'enlace'
                ? <Link className={clase} href={ir.href}>{ir.texto}</Link>
                : <button type="button" className={clase} onClick={hacer}>{ir.texto}</button>;
            })()}
          </li>
        );
      })}
    </ol>
  );
}
