'use client';

import type { ReactNode } from 'react';
import { Field } from './campo';

/** Lo mínimo para que un motivo diga algo; es lo que exige la API en casi todas las acciones con motivo. */
export const MOTIVO_MINIMO = 3;
/** ¿Falta el motivo (o es tan corto que no dice nada)? */
export const faltaMotivo = (motivo: string): boolean => motivo.trim().length < MOTIVO_MINIMO;
/** La ayuda de siempre debajo del motivo. */
export const AYUDA_MOTIVO = 'Queda en la bitácora con tu nombre.';
/** El error de siempre cuando falta: dice qué hacer y por qué importa. */
export const ERROR_MOTIVO = 'Escribe el motivo: queda en la bitácora.';

/**
 * MOTIVO (26-09, D26-01): una sola pieza para los 42 «Motivo» que estaban
 * hechos a mano, cada uno con su asterisco o sin él, su ayuda y su regla.
 * Etiqueta «Motivo *», el texto libre y, debajo, los motivos frecuentes de
 * ESA acción de un toque (D26-01: recepción no teclea «viaje de trabajo» diez
 * veces al día; la bitácora sigue diciendo quién y por qué, y se podrá contar
 * cuántas congelaciones son por lesión). Tocar uno lo escribe; tocarlo otra
 * vez lo borra; escribir otra cosa es «otro motivo». El catálogo de motivos
 * por acción vendrá del núcleo (`core/motivos.ts`, fase 1.1); mientras, cada
 * pantalla pasa los suyos.
 */
export function CampoMotivo({
  id, value, onChange, motivos, error, label = 'Motivo', hint = AYUDA_MOTIVO, required = true,
  placeholder, autoFocus, maxLength = 300, disabled, renglones,
}: {
  id: string;
  value: string;
  onChange: (motivo: string) => void;
  /** Motivos frecuentes de ESTA acción, de un toque. */
  motivos?: readonly string[];
  /** El error a la vista (con `useFormulario`: `f.error('motivo')`). */
  error?: string | null;
  label?: ReactNode;
  hint?: ReactNode;
  /** Casi siempre lo es; se apaga para un motivo opcional («Motivo (opcional)» ya no hace falta). */
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  maxLength?: number;
  disabled?: boolean;
  /** Para una explicación larga: un `textarea` de ese alto. */
  renglones?: number;
}) {
  const elegido = motivos?.find((m) => m === value.trim());
  const comun = { id, value, disabled, autoFocus, maxLength, placeholder: placeholder ?? (motivos?.length ? 'Elige uno de abajo o escríbelo' : undefined), 'aria-invalid': !!error || undefined };
  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
      {renglones
        ? <textarea className="textarea" rows={renglones} {...comun} onChange={(e) => onChange(e.target.value)} />
        : <input className="input" {...comun} onChange={(e) => onChange(e.target.value)} />}
      {motivos && motivos.length > 0 && (
        // El nombre del grupo no dice «Motivo»: el campo se encuentra por su etiqueta, y es uno solo.
        <div className="motivos-rapidos" role="group" aria-label="De un toque">
          {motivos.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={elegido === m} disabled={disabled}
              onClick={() => onChange(elegido === m ? '' : m)}>{m}</button>
          ))}
        </div>
      )}
    </Field>
  );
}
