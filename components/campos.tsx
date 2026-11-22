'use client';

/*
 * CAMPOS DE FECHA Y HORA — panel y portal (auditoría 8, 26-06 y D26-02).
 *
 * Este archivo es IDÉNTICO en gymflow-web y gymflow-portal
 * (`components/campos.tsx`); `pnpm test:tokens` falla si difieren. Para
 * cambiarlo: edítalo en uno, cópialo al otro y actualiza su huella en los dos
 * `scripts/tokens-iguales.mjs`. Solo depende de React, lucide-react y de
 * `lib/format.ts` (también espejo); sus estilos viven en `app/compartido.css`.
 *
 * El `<input type="date">` del navegador pinta y pide la fecha según el idioma
 * de la computadora: en la PC del mostrador configurada en inglés salía
 * «mm/dd/yyyy» y «10/09/2026» se leía 9 de octubre; la hora salía «--:-- --»
 * con AM/PM o de 24 según el equipo. Estos campos escriben y muestran SIEMPRE
 * día/mes/año, y la hora de 24 con su equivalente de 12 al lado («18:30 ·
 * 6:30 pm»), sin depender de quién instaló la computadora (D26-02).
 *
 * Entregan el valor de siempre (AAAA-MM-DD y HH:MM, o vacío), así que
 * sustituyen al nativo sin tocar nada más. El calendario del navegador sigue a
 * un toque (el botón del costado, o Alt+↓), y los atajos («Hoy», «Mañana», «En
 * 3 días») cuentan desde hoy EN EL GIMNASIO (`hoyEn`). Lo que no se entiende
 * como fecha se dice debajo del campo al salir de él; mientras tanto el valor
 * queda vacío, como en el nativo con una fecha a medias.
 */

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { escribirFecha, escribirHora, fechaNumerica, hora12, hoyEn, leerFecha, leerHora, masDias } from '../lib/format';

type Comun = {
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Para un `<form>` que se lee con `FormData`: un campo oculto con ese nombre lleva el valor. */
  name?: string;
  'aria-label'?: string;
  /** Lo marca quien lo usa (su `Field` ya dice el error): el campo no repite su propio aviso. */
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/** «Hoy», «Mañana», «En 3 días», «En una semana», «Ayer»… para un atajo de `n` días desde hoy. */
export function etiquetaAtajo(n: number): string {
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  if (n === 7) return 'En una semana';
  if (n === -7) return 'Hace una semana';
  return n > 0 ? `En ${n} días` : `Hace ${-n} días`;
}

/**
 * FECHA, SIEMPRE dd/mm/aaaa. Se escribe con números («19112026» se acomoda
 * como 19/11/2026), se pega en cualquier formato que `leerFecha` entienda o
 * se elige del calendario. `value` y `onChange` hablan AAAA-MM-DD.
 */
export function CampoFecha({ value, onChange, min, max, atajos, hoy, id, disabled, autoFocus, className, name, ...aria }: Comun & {
  value: string;
  onChange: (iso: string) => void;
  /** Límites AAAA-MM-DD: el calendario no ofrece lo de fuera y los atajos que caen fuera se apagan. */
  min?: string;
  max?: string;
  /** Atajos de un toque, en días desde hoy: `[0, 1, 3, 7]` → «Hoy», «Mañana», «En 3 días», «En una semana». */
  atajos?: readonly number[];
  /** Hoy en el gimnasio (AAAA-MM-DD). Sin él, el de la zona fijada (`fijarZona`). */
  hoy?: string;
}) {
  const propio = useId();
  const nativo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState(() => fechaNumerica(value));
  const [salio, setSalio] = useState(false);
  // El valor cambió desde fuera (un atajo, un reinicio, otra fecha propuesta): el texto lo sigue.
  const [visto, setVisto] = useState(value);
  if (value !== visto) {
    setVisto(value);
    if ((leerFecha(texto) ?? '') !== value) { setTexto(fechaNumerica(value)); setSalio(false); }
  }
  const leida = leerFecha(texto);
  const invalida = salio && texto.trim() !== '' && !leida;
  const enRango = (iso: string | null) => (iso && (!min || iso >= min) && (!max || iso <= max) ? iso : '');
  const dehoy = hoy ?? hoyEn();

  function poner(iso: string) { if (iso !== value) onChange(iso); }
  function elegir(iso: string) { setTexto(fechaNumerica(iso)); setSalio(false); poner(iso); }
  function abrirCalendario() {
    const n = nativo.current;
    if (!n || disabled) return;
    // `showPicker` es lo nuevo; donde no existe, el foco en el campo nativo abre el suyo.
    try { n.showPicker(); } catch { n.focus(); n.click(); }
  }
  function teclas(e: KeyboardEvent<HTMLInputElement>) {
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); abrirCalendario(); }
  }

  const aviso = invalida && !aria['aria-invalid'] ? `${propio}-aviso` : undefined;
  return (
    <div className={`campo-fecha${className ? ` ${className}` : ''}`} data-invalida={invalida || undefined}>
      <div className="campo-fecha-caja">
        <input id={id} className="input" type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" maxLength={10} size={10}
          value={texto} disabled={disabled} autoFocus={autoFocus} aria-label={aria['aria-label']}
          aria-invalid={aria['aria-invalid'] || invalida || undefined}
          aria-describedby={[aria['aria-describedby'], aviso].filter(Boolean).join(' ') || undefined}
          onChange={(e) => { const t = escribirFecha(e.target.value); setTexto(t); setSalio(false); poner(leerFecha(t) ?? ''); }}
          onBlur={() => { if (leida) setTexto(fechaNumerica(leida)); setSalio(true); }}
          onKeyDown={teclas} />
        <button type="button" className="campo-fecha-boton" tabIndex={-1} aria-label="Abrir el calendario" title="Abrir el calendario"
          disabled={disabled} onClick={abrirCalendario}>
          <CalendarDays aria-hidden />
        </button>
        {/* El calendario del navegador, sin texto propio: solo se abre y entrega lo elegido.
            Fuera de rango queda vacío, para que un `<form>` no se frene por un campo que no se ve. */}
        <input ref={nativo} type="date" className="campo-fecha-nativo" tabIndex={-1} aria-hidden="true" min={min} max={max}
          value={enRango(leida)} disabled={disabled} onChange={(e) => { if (e.target.value) elegir(e.target.value); }} />
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {aviso && <span className="campo-aviso" id={aviso} role="alert">Escribe la fecha como día/mes/año, por ejemplo 19/11/2026.</span>}
      {atajos && atajos.length > 0 && (
        <div className="campo-atajos" role="group" aria-label="Atajos de fecha">
          {atajos.map((n) => {
            const iso = masDias(dehoy, n);
            return (
              <button key={n} type="button" className="chip" aria-pressed={value === iso}
                disabled={disabled || (!!min && iso < min) || (!!max && iso > max)}
                onClick={() => (value === iso ? elegir('') : elegir(iso))}>{etiquetaAtajo(n)}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * HORA, SIEMPRE de 24 con su equivalente de 12 al lado. Se escribe con
 * números («1830» → 18:30) o como se diga («6:30 pm», «6 pm»).
 * `value` y `onChange` hablan HH:MM.
 */
export function CampoHora({ value, onChange, id, disabled, autoFocus, className, name, ...aria }: Comun & {
  value: string;
  onChange: (hhmm: string) => void;
}) {
  const propio = useId();
  const [texto, setTexto] = useState(value);
  const [salio, setSalio] = useState(false);
  const [visto, setVisto] = useState(value);
  if (value !== visto) {
    setVisto(value);
    if ((leerHora(texto) ?? '') !== value) { setTexto(value); setSalio(false); }
  }
  const leida = leerHora(texto);
  const invalida = salio && texto.trim() !== '' && !leida;
  function poner(hhmm: string) { if (hhmm !== value) onChange(hhmm); }
  const aviso = invalida && !aria['aria-invalid'] ? `${propio}-aviso` : undefined;
  return (
    <div className={`campo-hora${className ? ` ${className}` : ''}`} data-invalida={invalida || undefined}>
      <div className="campo-hora-caja">
        <input id={id} className="input" type="text" inputMode="numeric" autoComplete="off" placeholder="hh:mm" maxLength={10} size={8}
          value={texto} disabled={disabled} autoFocus={autoFocus} aria-label={aria['aria-label']}
          aria-invalid={aria['aria-invalid'] || invalida || undefined}
          aria-describedby={[aria['aria-describedby'], aviso].filter(Boolean).join(' ') || undefined}
          onChange={(e) => { const t = escribirHora(e.target.value); setTexto(t); setSalio(false); poner(leerHora(t) ?? ''); }}
          onBlur={() => { if (leida) setTexto(leida); setSalio(true); }} />
        {leida && <span className="campo-hora-doce" aria-hidden>{hora12(leida)}</span>}
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {aviso && <span className="campo-aviso" id={aviso} role="alert">Escribe la hora como 18:30 o 6:30 pm.</span>}
    </div>
  );
}
