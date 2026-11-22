'use client';

/*
 * DIÁLOGO — panel y portal (auditoría 8, 26-03 y 26-14).
 *
 * Este archivo es IDÉNTICO en gymflow-web y gymflow-portal
 * (`components/dialogo.tsx`); `pnpm test:tokens` falla si difieren. Para
 * cambiarlo: edítalo en uno, cópialo al otro y actualiza su huella en los dos
 * `scripts/tokens-iguales.mjs`. Solo depende de React, lucide-react y
 * `compartido.tsx`: nada de `@/…`, que en cada app es otra cosa.
 *
 * Una sola pieza para las dos apps: el diálogo del panel (centrado; en el
 * teléfono, hoja inferior por CSS) y la hoja del portal (`hoja`), que antes
 * era otro componente, sin trampa de Tab y con el Escape escuchado en
 * `window`. Los dos:
 *  - se pintan en `document.body` (26-03): no heredan el `nowrap`, la
 *    alineación ni el recorte de la fila o la tarjeta donde se declaran;
 *  - atienden el teclado EN el diálogo: Escape cierra solo el de arriba y Tab
 *    da la vuelta dentro en vez de escaparse al menú de atrás (UX-14);
 *  - devuelven el foco a donde estaba al cerrarse;
 *  - se cierran con la X, con Escape o tocando afuera, salvo `obligatorio`;
 *  - dicen el error de su acción EN el pie, junto al botón que se pulsó
 *    (bloque 1.2): con el diálogo abierto, un aviso en la esquina queda detrás
 *    de la mirada (y en el teléfono, detrás de la hoja), y quien cobra no sabe
 *    si se cobró. `error` lo pone la pantalla; `errorEnElDialogoAbierto` lo
 *    pone quien solo tiene el texto (el aviso flotante del panel).
 * Las clases son las de cada app: `dialog-*` en el panel y `sheet-*` en el
 * portal, cada una con su `globals.css`.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Callout, IconButton } from './compartido';

const sinSuscripcion = () => () => {};
/** Verdadero solo en el navegador ya hidratado: el servidor no tiene `document.body`. */
export function useEnNavegador(): boolean {
  return useSyncExternalStore(sinSuscripcion, () => true, () => false);
}

/** Los diálogos abiertos, del primero al de arriba: cada uno deja con qué ponerle su error y cuál muestra. */
type Abierto = { poner: (texto: string) => void; texto: string | null };
const abiertos: Abierto[] = [];

/**
 * Pone el error de una acción en el pie del diálogo de ARRIBA y devuelve
 * `true`; sin diálogo abierto no hace nada y devuelve `false` (quien llama
 * lo muestra como siempre). El error se quita solo cuando la persona corrige
 * algo o vuelve a pulsar un botón del pie, y al cerrar.
 */
export function errorEnElDialogoAbierto(texto: string): boolean {
  const arriba = abiertos.at(-1);
  if (!arriba || !texto) return false;
  arriba.texto = texto;
  arriba.poner(texto);
  return true;
}

/**
 * ¿Algún diálogo abierto muestra ese error ahora? Si el diálogo se cerró en
 * el mismo gesto en que falló su acción, el error ya no está a la vista:
 * quien lo mandó lo enseña de otra manera para que no se pierda.
 */
export function errorALaVista(texto: string): boolean {
  return abiertos.some((a) => a.texto === texto);
}

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogProps = {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode;
  children: ReactNode; footer?: ReactNode;
  /** `sm` (440 px) para confirmar con un motivo; `lg` (720 px) para asistentes y conteos. Sin tamaño, 560 px. */
  size?: 'sm' | 'lg';
  /** Sin X, sin Escape y sin clic afuera: solo se sale terminando (p. ej. la contraseña temporal). */
  obligatorio?: boolean;
  /** Hoja que sube desde abajo con su agarradera: la del portal del socio. */
  hoja?: boolean;
  /** El error de la acción del diálogo: sale en el pie, arriba de los botones. */
  error?: ReactNode;
};

/**
 * La API es la del `Dialog` de siempre: `title`, `sub`, cuerpo y `footer`.
 * Los eventos de React siguen subiendo por el árbol donde se declara, aunque
 * el diálogo se pinte en `body`.
 */
export function Dialog({ open, onClose, title, sub, children, footer, size, obligatorio = false, hoja = false, error }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  // El error que llegó por `errorEnElDialogoAbierto`; el de la pantalla (`error`) manda.
  const [avisado, setAvisado] = useState<string | null>(null);
  const registro = useRef<Abierto | null>(null);
  const id = useId();
  const enNavegador = useEnNavegador();
  // `onClose` suele llegar como flecha nueva en cada render. Si fuera
  // dependencia del efecto, el foco saltaría al diálogo con cada tecla.
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    if (!open || !enNavegador) return;
    const previo = document.activeElement as HTMLElement | null;
    // Solo si nada dentro pidió el foco (un campo con autoFocus lo hace).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { previo?.focus?.(); };
  }, [open, enNavegador]);

  useEffect(() => {
    if (!open || !enNavegador) return;
    const yo: Abierto = { poner: (texto) => setAvisado(texto), texto: null };
    abiertos.push(yo);
    registro.current = yo;
    return () => {
      const i = abiertos.lastIndexOf(yo);
      if (i >= 0) abiertos.splice(i, 1);
      registro.current = null;
      setAvisado(null);
    };
  }, [open, enNavegador]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); if (!obligatorio) cerrar.current(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const enfocables = [...ref.current.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((el) => el.offsetParent !== null);
    if (enfocables.length === 0) { e.preventDefault(); return; }
    const primero = enfocables[0]!, ultimo = enfocables.at(-1)!;
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === ref.current)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  if (!open || !enNavegador) return null;
  const c = hoja ? 'sheet' : 'dialog';
  const fallo = error ?? avisado;
  // Corregir un campo o volver a pulsar un botón del pie quita el error anterior.
  const olvidar = () => { if (avisado) { setAvisado(null); if (registro.current) registro.current.texto = null; } };
  return createPortal(
    <div className={`${c}-backdrop`} onMouseDown={(e) => { if (e.target === e.currentTarget && !obligatorio) onClose(); }}>
      <div className={hoja ? 'sheet' : `dialog${size ? ` dialog-${size}` : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}
        aria-labelledby={`${id}-t`} aria-describedby={sub ? `${id}-s` : undefined} onKeyDown={onKeyDown}>
        {hoja && <div className="sheet-grip" aria-hidden />}
        <div className={`${c}-head`}>
          <div>
            <h2 className={`${c}-title`} id={`${id}-t`}>{title}</h2>
            {sub && <p className="muted small mt-4" id={`${id}-s`}>{sub}</p>}
          </div>
          {!obligatorio && <IconButton label="Cerrar" className={hoja ? 'sheet-cerrar' : undefined} onClick={onClose}><X /></IconButton>}
        </div>
        <div className={`${c}-body`} onInputCapture={olvidar}>{children}</div>
        {fallo && <div className={`${c}-aviso`} data-testid="error-del-dialogo"><Callout tone="danger">{fallo}</Callout></div>}
        {footer && <div className={`${c}-foot`} onClickCapture={olvidar}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
