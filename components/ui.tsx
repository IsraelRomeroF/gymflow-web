'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronRight, SearchX, MoreHorizontal } from 'lucide-react';
import { iniciales } from '@/lib/format';
import { useEnNavegador } from './dialogo';

/**
 * Piezas de interfaz del panel.
 *
 * Son deliberadamente delgadas: el aspecto vive en `globals.css` y aquí solo
 * está lo que se repite en marcado. Una pantalla nueva debería poder armarse
 * sin escribir un estilo en línea.
 */

// Las piezas que el panel comparte con el portal viven en compartido.tsx
// (archivo idéntico en los dos repos); aquí se reexportan para no cambiar importaciones.
import { Badge, Empty, Skeleton, type ButtonProps } from './compartido';
export { Badge, Button, Callout, Empty, ErrorCarga, IconButton, IconTile, Skeleton, type ButtonProps, type Tono } from './compartido';

export function ButtonLink({
  href, variant = 'secondary', size = 'md', icon, children,
}: { href: string; variant?: ButtonProps['variant']; size?: ButtonProps['size']; icon?: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className={`btn btn-${variant}${size !== 'md' ? ` btn-${size}` : ''}`}>
      {icon}{children}
    </Link>
  );
}

export function PageHeader({
  eyebrow, title, sub, actions,
}: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        {/* Un título compuesto (la ficha de un socio) trae su propio h1. */}
        {typeof title === 'string' ? <h1 className="page-title">{title}</h1> : title}
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  // En una sola línea (antes cada nivel salía en su propio renglón).
  return (
    <nav className="breadcrumb" aria-label="Ruta">
      {items.map((it, i) => (
        <span key={it.label} className="row gap-6">
          {it.href ? <Link href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
          {i < items.length - 1 && <ChevronRight size={13} aria-hidden />}
        </span>
      ))}
    </nav>
  );
}

export function Card({
  title, sub, actions, children, footer, pad, className, 'data-testid': testid,
}: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode;
  footer?: ReactNode; pad?: boolean; className?: string; 'data-testid'?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`} data-testid={testid}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {pad === false ? children : <div className="card-body">{children}</div>}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function Stat({
  label, value, note, icon, feature, danger,
}: { label: ReactNode; value: ReactNode; note?: ReactNode; icon?: ReactNode; feature?: boolean; danger?: boolean }) {
  return (
    <div className={`card stat${feature ? ' stat--feature' : ''}`}>
      <span className="stat-label">{icon}{label}</span>
      <span className={`stat-value${danger ? ' is-danger' : ''}`}>{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}


/*
 * ESQUELETOS CON FORMA (UX5-UI-07): mientras carga, la pantalla ya tiene la
 * silueta de lo que viene (filas, cifras, encabezado), así nada salta cuando
 * llegan los datos. Antes todo era el mismo bloque gris.
 */

/** Filas de tabla: una línea de texto ancha y cifras cortas a la derecha. */
export function EsqueletoTabla({ filas = 6, columnas = 4 }: { filas?: number; columnas?: number }) {
  return (
    <div className="esq-tabla" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esq-fila">
          <div className="esq-celda-principal"><Skeleton h={14} w={`${55 + ((i * 17) % 35)}%`} /><Skeleton h={10} w="35%" /></div>
          {Array.from({ length: columnas - 1 }, (_, j) => <Skeleton key={j} h={14} w={64} />)}
        </div>
      ))}
    </div>
  );
}

/** Lista con ícono o avatar a la izquierda: pendientes, socios, avisos. */
export function EsqueletoLista({ filas = 4 }: { filas?: number }) {
  return (
    <div aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esq-fila">
          <Skeleton h={36} w={36} r={10} />
          <div className="esq-celda-principal"><Skeleton h={14} w={`${45 + ((i * 23) % 40)}%`} /><Skeleton h={10} w="60%" /></div>
        </div>
      ))}
    </div>
  );
}

/** Una página: encabezado, una fila de cifras y una tarjeta con tabla. */
export function EsqueletoPagina({ cifras = 4, tabla = true }: { cifras?: number; tabla?: boolean }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Cargando">
      <div className="stack-sm"><Skeleton h={11} w={120} /><Skeleton h={30} w={320} /><Skeleton h={14} w={420} /></div>
      {cifras > 0 && (
        <div className={`grid grid-${Math.min(cifras, 4)}`}>
          {Array.from({ length: cifras }, (_, i) => (
            <div key={i} className="card stat"><Skeleton h={12} w={90} /><Skeleton h={30} w={120} /><Skeleton h={11} w={140} /></div>
          ))}
        </div>
      )}
      {tabla && <div className="card"><div className="card-head"><Skeleton h={16} w={180} /></div><EsqueletoTabla /></div>}
    </div>
  );
}


/**
 * Color estable por persona: el mismo socio tiene siempre el mismo color, lo
 * que ayuda a recepción a reconocerlo en una lista sin leer.
 */
/** Ocho tonos por token: en oscuro cambian a tinta oscura con texto claro (UI2-02). */
const TONOS = 8;

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = h % TONOS;
  return (
    <span className="avatar" style={{ '--size': `${size}px`, '--av-bg': `var(--av${t}-bg)`, '--av-fg': `var(--av${t}-fg)` } as React.CSSProperties}>
      {iniciales(name)}
    </span>
  );
}

/**
 * DIÁLOGO (26-03, 26-14): vive en `dialogo.tsx`, idéntico en el portal (allá
 * es la hoja inferior). Se pinta en `document.body`; aquí se reexporta para
 * no cambiar importaciones.
 */
export { Dialog, type DialogProps } from './dialogo';

/** Campo con su etiqueta, asterisco de obligatorio y error debajo: vive en `ui/campo.tsx`. */
export { Field } from './ui/campo';

/** Fecha siempre dd/mm/aaaa y hora de 24 con su equivalente de 12 (26-06, D26-02): `campos.tsx`, espejo en el portal. */
export { CampoFecha, CampoHora, etiquetaAtajo } from './campos';

/** El motivo con sus motivos frecuentes de un toque (26-09, D26-01). */
export { CampoMotivo, faltaMotivo, AYUDA_MOTIVO, ERROR_MOTIVO, MOTIVO_MINIMO } from './ui/motivo';

/** Lo que va a pasar antes de lo que no tiene vuelta atrás: bloqueos, avisos y cifras. */
export { VistaPrevia, sePuedeSeguir, type CifraPrevia } from './ui/vista-previa';

/** Cuánto cambió contra antes (con flecha y color solo si es notable), o de → a. */
export { Cambio } from './ui/cambio';

/** Elegir una o varias opciones, y el segmentado que no corta (26-04, 26-11): viven en `ui/opciones.tsx`. */
export { Opciones, Segmented, type Opcion, type OpcionesUna, type OpcionesVarias } from './ui/opciones';

export function Tabs<T extends string>({
  value, onChange, tabs,
}: {
  value: T; onChange: (v: T) => void;
  tabs: ReadonlyArray<{ value: T; label: string; icon?: ReactNode; count?: number }>;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value} role="tab" className="tab"
          aria-selected={t.value === value} onClick={() => onChange(t.value)}
        >
          {t.icon}{t.label}
          {t.count !== undefined && t.count > 0 && <Badge>{t.count}</Badge>}
        </button>
      ))}
    </div>
  );
}

/**
 * Un error de carga NUNCA se muestra como "no hay nada" (UI3-01, UXG-04):
 * "Socio no encontrado" con la red caída hacía creer que el socio no existe.
 */

/**
 * Lo que se buscó no existe (UX4-14): "Reintentar" nunca va a servir aquí.
 * Se usa cuando la API responde 404, o 422 porque el identificador de la
 * ruta ni siquiera tiene forma válida (una dirección escrita a mano).
 */
export function NoExiste({ titulo, texto, volverA, volverTexto }: { titulo: string; texto: string; volverA: string; volverTexto: string }) {
  return <Card><Empty icon={<SearchX />} title={titulo} text={texto} action={<ButtonLink href={volverA} variant="secondary">{volverTexto}</ButtonLink>} /></Card>;
}

/** ¿El error dice que el recurso no existe (o que la ruta no es válida)? */
export function esNoExiste(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 404 || status === 422 || status === 400;
}

/**
 * MENÚ "MÁS" (UX5-UI-03): las acciones secundarias de una pantalla o de una
 * fila, para que solo una quede como botón principal. Se cierra al elegir,
 * con Escape o al hacer clic fuera. La lista se pinta en `document.body`,
 * junto a su botón (como el diálogo, 26-03): dentro de una tabla con
 * desplazamiento ya no se corta, y si abajo no cabe se abre hacia arriba.
 */
export function MenuMas({ items, tam, etiqueta }: {
  items: Array<{ label: string; icon?: ReactNode; onClick: () => void; peligro?: boolean } | false | null | undefined>;
  /** `sm` en una fila de tabla o de lista. */
  tam?: 'sm';
  /** De quién son las acciones, para el lector de pantalla: «Más acciones de Lucía Fernández». */
  etiqueta?: string;
}) {
  const label = 'Más';
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const enNavegador = useEnNavegador();
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !lista.current?.contains(t)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);
  // Se coloca antes de pintarse: debajo del botón, alineada a su derecha, o arriba si no cabe.
  useLayoutEffect(() => {
    if (!abierto) return;
    const colocar = () => {
      const b = ref.current?.getBoundingClientRect(); const l = lista.current;
      if (!b || !l) return;
      const alto = l.offsetHeight; const ancho = l.offsetWidth;
      const cabeAbajo = b.bottom + 6 + alto <= window.innerHeight - 8;
      l.style.top = `${cabeAbajo ? b.bottom + 6 : Math.max(8, b.top - 6 - alto)}px`;
      l.style.left = `${Math.max(8, Math.min(b.right - ancho, window.innerWidth - 8 - ancho))}px`;
    };
    colocar();
    window.addEventListener('resize', colocar);
    window.addEventListener('scroll', colocar, true);
    return () => { window.removeEventListener('resize', colocar); window.removeEventListener('scroll', colocar, true); };
  }, [abierto]);
  const visibles = items.filter((x): x is { label: string; icon?: ReactNode; onClick: () => void; peligro?: boolean } => !!x);
  if (visibles.length === 0) return null;
  return (
    <div className="menu-mas" ref={ref}>
      {/* El clic no sigue a la fila que lo contiene: abrir el menú no es abrir la fila. */}
      <button type="button" className={`btn btn-secondary${tam === 'sm' ? ' btn-sm' : ''}`} aria-haspopup="menu" aria-expanded={abierto} aria-label={etiqueta}
        onClick={(e) => { e.stopPropagation(); setAbierto((x) => !x); }}>
        <MoreHorizontal />{label}
      </button>
      {abierto && enNavegador && createPortal(
        <div className="menu-mas-lista" role="menu" ref={lista}>
          {visibles.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={`menu-mas-item${it.peligro ? ' is-peligro' : ''}`}
              onClick={(e) => { e.stopPropagation(); setAbierto(false); it.onClick(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Título de sección dentro de una página (escala --t-md, UX5-UI-01). */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title" style={{ marginTop: 0 }}>{children}</h2>;
}

/**
 * INTERRUPTOR DESLIZABLE (2026-10-08): lo que se enciende o se apaga —qué ve
 * cada persona, si un plan se vende, si se cobra ahora— se ve como un
 * interruptor, no como una casilla. Por dentro es un checkbox: conserva el
 * foco, la etiqueta accesible y lo que las pruebas ya saben hacer.
 */
export function Switch({ checked, onChange, children, disabled, title, id, style }: {
  checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode; disabled?: boolean; title?: string; id?: string; style?: React.CSSProperties;
}) {
  return (
    <label className={`switch-field${disabled ? ' is-disabled' : ''}`} title={title} style={style}>
      <input id={id} type="checkbox" role="switch" className="switch-input" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true"><span /></span>
      {children !== undefined && <span className="switch-label">{children}</span>}
    </label>
  );
}

/** Lleva al primer campo con error: vive en `lib/formulario.ts` (con `useFormulario`, espejo en el portal). */
export { irAlPrimerError } from '@/lib/formulario';
