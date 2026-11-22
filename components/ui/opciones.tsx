'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/*
 * ELEGIR UNA (O VARIAS) OPCIONES (26-04, 26-11).
 *
 * Había cuatro controles para lo mismo, a veces en un solo diálogo: tarjetas
 * con ícono (`.choice`), chips negros (`.chip`), el segmentado gris y
 * interruptores que en realidad eran casillas. `Opciones` es uno con cuatro
 * formas, cada una con su uso:
 *
 *   forma        para qué                                       se ve como
 *   tarjetas     2 a 4 opciones con ícono: método, canal        `.choice`
 *   chips        opciones de texto, pueden ser muchas           `.chip`
 *   segmentado   2 a 6 opciones cortas de vista o filtro        `Segmented`
 *   casillas     varias a la vez (sucursales de una persona)    casillas
 *
 * Una sola opción es un grupo de radio de verdad (`role="radio"`): Tab entra
 * en la elegida y las flechas cambian, como en cualquier formulario. Varias a
 * la vez son botones que se encienden (`aria-pressed`) o casillas. El
 * segmentado conserva sus botones (`aria-pressed`): es un filtro de vista.
 * El `Switch` queda para encender o apagar algo que ya existe.
 */

export type Opcion<T> = { value: T; label: string; icono?: ReactNode; texto?: ReactNode; disabled?: boolean };

type Comun<T> = {
  opciones: ReadonlyArray<Opcion<T>>;
  /** Nombre del grupo para el lector de pantalla, si no lo da una etiqueta visible (`etiquetadaPor`). */
  etiqueta?: string;
  /** `id` del rótulo visible del grupo («¿Qué pasó?»). */
  etiquetadaPor?: string;
  disabled?: boolean;
  className?: string;
};

export type OpcionesUna<T> = Comun<T> & {
  multiple?: false;
  forma: 'tarjetas' | 'chips' | 'segmentado';
  /** `null` = nada elegido todavía (nada viene marcado de antemano, UX5-G-05). */
  value: T | null;
  onChange: (v: T) => void;
  /** Tarjetas: cuántas por renglón (2 por omisión; en el teléfono, una). */
  columnas?: 2 | 3 | 4;
  /** Tarjetas con el ícono arriba y el nombre debajo, para opciones de una palabra (canal, método). */
  compactas?: boolean;
  /** Segmentado: una fila que se desliza (ver `Segmented`). */
  desplazable?: boolean;
};

export type OpcionesVarias<T> = Comun<T> & {
  multiple: true;
  forma: 'chips' | 'casillas';
  value: readonly T[];
  onChange: (v: T[]) => void;
};

export function Opciones<T extends string | number>(props: OpcionesUna<T> | OpcionesVarias<T>) {
  if (props.multiple) return <Varias {...props} />;
  if (props.forma === 'segmentado') {
    return <Segmented value={props.value} onChange={props.onChange} options={props.opciones} desplazable={props.desplazable} etiqueta={props.etiqueta} />;
  }
  return <Una {...props} />;
}

function Una<T extends string | number>({ forma, opciones, value, onChange, etiqueta, etiquetadaPor, disabled, className, columnas, compactas }: OpcionesUna<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const habil = (o: Opcion<T>) => !disabled && !o.disabled;
  // Tab entra por la elegida (o por la primera que se pueda): las demás se alcanzan con las flechas.
  const entrada = opciones.find((o) => o.value === value && habil(o)) ?? opciones.find(habil);
  function flechas(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    for (let k = 1; k <= opciones.length; k++) {
      const j = (i + paso * k + opciones.length) % opciones.length;
      const o = opciones[j]!;
      if (habil(o)) { onChange(o.value); ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus(); return; }
    }
  }
  const tarjetas = forma === 'tarjetas';
  const clases = tarjetas
    ? `choice-grid opciones-tarjetas${columnas && columnas !== 2 ? ` opciones-col-${columnas}` : ''}${compactas ? ' opciones-compactas' : ''}`
    : 'opciones-chips';
  return (
    <div ref={ref} className={`${clases}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={etiqueta} aria-labelledby={etiquetadaPor}>
      {opciones.map((o, i) => {
        const elegida = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={elegida} tabIndex={o === entrada ? 0 : -1}
            className={tarjetas ? 'choice' : 'chip'} disabled={!habil(o)}
            onClick={() => onChange(o.value)} onKeyDown={(e) => flechas(e, i)}>
            {tarjetas ? (
              <>
                {o.icono && <span className="choice-icon">{o.icono}</span>}
                <span className="opcion-cuerpo">
                  <span className="choice-title">{o.label}</span>
                  {o.texto && <span className="choice-text">{o.texto}</span>}
                </span>
              </>
            ) : <>{o.icono}{o.label}</>}
          </button>
        );
      })}
    </div>
  );
}

function Varias<T extends string | number>({ forma, opciones, value, onChange, etiqueta, etiquetadaPor, disabled, className }: OpcionesVarias<T>) {
  const cambiar = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  if (forma === 'casillas') {
    return (
      <div className={`opciones-casillas${className ? ` ${className}` : ''}`} role="group" aria-label={etiqueta} aria-labelledby={etiquetadaPor}>
        {opciones.map((o) => (
          <label key={String(o.value)} className={`check${disabled || o.disabled ? ' is-disabled' : ''}`}>
            <input type="checkbox" checked={value.includes(o.value)} disabled={disabled || o.disabled} onChange={() => cambiar(o.value)} />
            <span className="opcion-cuerpo">
              <span>{o.label}</span>
              {o.texto && <span className="hint block">{o.texto}</span>}
            </span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className={`opciones-chips${className ? ` ${className}` : ''}`} role="group" aria-label={etiqueta} aria-labelledby={etiquetadaPor}>
      {opciones.map((o) => (
        <button key={String(o.value)} type="button" className="chip" aria-pressed={value.includes(o.value)} disabled={disabled || o.disabled} onClick={() => cambiar(o.value)}>
          {o.icono}{o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * SEGMENTADO (26-04, 13-07, 14-15): nunca corta una opción. Con pocas, si no
 * caben en un renglón bajan a otro, parejas (fase 0.10). Con muchas
 * (`desplazable`, por omisión más de seis), una sola fila que se desliza con
 * el dedo: el borde se desvanece del lado donde hay más y la elegida siempre
 * queda a la vista. En la Bitácora del teléfono, nueve categorías ocupaban
 * cuatro renglones antes de la primera línea de la bitácora.
 */
export function Segmented<T extends string | number>({ value, onChange, options, desplazable, etiqueta }: {
  value: T | null; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  desplazable?: boolean;
  /** Qué se elige, para el lector de pantalla («Periodo», «Categoría»). */
  etiqueta?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const desliza = desplazable ?? options.length > 6;
  const [bordes, setBordes] = useState({ antes: false, despues: false });
  useEffect(() => {
    const el = ref.current;
    if (!desliza || !el) return;
    const medir = () => setBordes((b) => {
      // Unos píxeles de holgura: el ajuste al primer botón deja el desplazamiento en 3, no en 0.
      const antes = el.scrollLeft > 6;
      const despues = el.scrollLeft + el.clientWidth < el.scrollWidth - 6;
      return b.antes === antes && b.despues === despues ? b : { antes, despues };
    });
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const tamano = new ResizeObserver(medir);
    tamano.observe(el);
    return () => { el.removeEventListener('scroll', medir); tamano.disconnect(); };
  }, [desliza]);
  // La elegida siempre a la vista, también al llegar con una ya elegida al final de la fila.
  useEffect(() => {
    const el = ref.current;
    const b = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!desliza || !el || !b) return;
    const izq = b.offsetLeft - 24;
    const der = b.offsetLeft + b.offsetWidth + 24;
    if (izq < el.scrollLeft) el.scrollTo({ left: Math.max(0, izq) });
    else if (der > el.scrollLeft + el.clientWidth) el.scrollTo({ left: der - el.clientWidth });
  }, [value, desliza]);
  return (
    <div ref={ref} className={`segmented${desliza ? ' segmented--desplazable' : ''}`} role="group" aria-label={etiqueta}
      data-antes={bordes.antes || undefined} data-despues={bordes.despues || undefined}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
