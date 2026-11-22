import type { ReactNode } from 'react';

/**
 * CAMPO DE FORMULARIO (UX5-UI-08, 26-02): la etiqueta, el asterisco de lo
 * obligatorio y el error de ESE campo debajo (borde rojo con
 * `data-error`), no en un aviso en la esquina. Con `useFormulario`, los dos
 * salen de un solo lugar: `<Field label="Nombre" htmlFor="n" {...f.campo('nombre')}>`.
 * Lo opcional es lo que no lleva asterisco; no hace falta escribir «(opcional)».
 */
export function Field({
  label, hint, htmlFor, children, required, error,
}: {
  label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode;
  /** Marca el campo como obligatorio: el asterisco a la vista y «(obligatorio)» para el lector de pantalla. */
  required?: boolean;
  /** Error de ESTE campo: borde rojo y el mensaje debajo. */
  error?: string | null;
}) {
  return (
    <div className="field" data-error={error ? 'true' : undefined}>
      <label className="label" htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden> *</span>}{required && <span className="sr-only"> (obligatorio)</span>}</label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );
}
