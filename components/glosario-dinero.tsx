import type { ReactNode } from 'react';
import { GLOSARIO, type TerminoDelGlosario } from '@/lib/glosario';

/**
 * EL MISMO GLOSARIO EN TABLERO, MOVIMIENTOS E INICIO (auditoría 8, D-24).
 * Cada pantalla dice qué términos usa y aquí salen con LA MISMA palabra y la
 * misma explicación: antes cada una tenía su párrafo y no decían lo mismo.
 */
export function GlosarioDinero({ titulo, terminos, children }: { titulo: string; terminos: readonly TerminoDelGlosario[]; children?: ReactNode }) {
  return (
    <details className="explica glosario-dinero" data-testid="glosario-dinero">
      <summary className="small strong">{titulo}</summary>
      <dl className="glosario-lista">
        {terminos.map((t) => (
          <div key={t}>
            <dt className="small strong">{GLOSARIO[t].nombre}</dt>
            <dd className="small muted">{GLOSARIO[t].explica}</dd>
          </div>
        ))}
      </dl>
      {children && <p className="tiny muted">{children}</p>}
    </details>
  );
}
