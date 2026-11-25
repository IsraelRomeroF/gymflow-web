import type { ReactNode } from 'react';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { comparar, compararConteo } from '@gymflow/ui/format';

type Comparacion = {
  /** Lo de ahora y lo de antes: centavos (texto o bigint) o, con `conteo`, números. */
  actual: bigint | number | string;
  antes: bigint | number | string;
  /** Contra qué, en palabras: «ayer a esta hora», «el mes pasado a la misma fecha». */
  contra: string;
  /** Entradas o socios en vez de pesos. */
  conteo?: boolean;
};
type Paso = { de: ReactNode; a: ReactNode; tono?: 'ok' | 'warn' | 'danger' };

/**
 * CAMBIO (UX5-D-03, consolidado «Sistema de componentes»). Dos usos:
 *
 * - Contra antes: «↗ $6,385 más que ayer a esta hora (+12 %)». La flecha dice
 *   hacia dónde y el color solo aparece si la diferencia pasa del 10 % y de
 *   $500 (`comparar` en `@gymflow/ui/format`): un cambio de $40 no se pinta de
 *   rojo. Si las dos cifras son cero, no pinta nada.
 * - De → a: «$650 → $715», para lo que va a cambiar (un precio, un plan, un
 *   puesto) en una vista previa o una confirmación.
 */
export function Cambio(props: Comparacion | Paso) {
  if ('de' in props) {
    return (
      <span className="cambio-paso" data-tono={props.tono}>
        <span className="cambio-antes">{props.de}</span>
        <ArrowRight aria-hidden /><span className="sr-only"> pasa a </span>
        <span className="cambio-despues">{props.a}</span>
      </span>
    );
  }
  const { actual, antes, contra, conteo } = props;
  const c = conteo ? compararConteo(Number(actual), Number(antes), contra) : comparar(BigInt(actual), BigInt(antes), contra);
  if (!c.texto) return null;
  const dif = conteo ? Number(actual) - Number(antes) : Number(BigInt(actual) - BigInt(antes));
  const Icono = dif > 0 ? TrendingUp : TrendingDown;
  return <span className="cambio-valor" data-tono={c.tono}>{dif !== 0 && <Icono aria-hidden />}{c.texto}</span>;
}
