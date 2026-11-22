'use client';

import Link from 'next/link';
import { respuestaDePuerta, seccionDeRuta } from '@/modules/registro';
import { useSession } from '@/components/session';

export type PestanaDelGimnasio = 'datos' | 'sucursales' | 'modulos';

const PESTANAS: ReadonlyArray<{ clave: PestanaDelGimnasio; etiqueta: string; href: string; puerta: string }> = [
  // Datos cuelga de la misma llave que Sucursales (`settings:org` vive ahí): sin llave nueva.
  { clave: 'datos', etiqueta: 'Datos', href: '/gimnasio', puerta: '/sucursales' },
  { clave: 'sucursales', etiqueta: 'Sucursales', href: '/sucursales', puerta: '/sucursales' },
  { clave: 'modulos', etiqueta: 'Módulos', href: '/modulos', puerta: '/modulos' },
];

/** ¿Esta persona entra a esa pantalla? Lo mismo que contesta la puerta. */
export function useEntraA(ruta: string): boolean {
  const { mirada } = useSession();
  const seccion = seccionDeRuta(ruta);
  return !!seccion && respuestaDePuerta(seccion, mirada) === 'pasa';
}

/**
 * «MI GIMNASIO» (19-02): Datos, Sucursales y Módulos son una sola pantalla con
 * tres pestañas. Cada pestaña conserva su dirección (`/gimnasio`, `/sucursales`,
 * `/modulos`) y su llave: nada de lo que ya enlazaba a ellas se rompe, y quien
 * solo tiene liberada una ve solo esa. Son pestañas (`role="tab"`), no enlaces.
 * En el menú lateral las tres son UNA entrada, «Mi gimnasio» (bloque 2.12:
 * `MI_GIMNASIO` en `modules/registro.ts`), que queda marcada en cualquiera.
 */
export function PestanasGimnasio({ actual }: { actual: PestanaDelGimnasio }) {
  const { mirada } = useSession();
  const visibles = PESTANAS.filter((p) => {
    const s = seccionDeRuta(p.puerta);
    return p.clave === actual || (!!s && respuestaDePuerta(s, mirada) === 'pasa');
  });
  if (visibles.length < 2) return null;
  return (
    <nav className="gimnasio-nav" aria-label="Mi gimnasio" data-testid="mi-gimnasio">
      <p className="eyebrow">Mi gimnasio</p>
      <div className="tabs" role="tablist">
        {visibles.map((p) => (
          <Link key={p.clave} href={p.href} role="tab" className="tab" aria-selected={p.clave === actual}>{p.etiqueta}</Link>
        ))}
      </div>
    </nav>
  );
}
