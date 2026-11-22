'use client';

/*
 * COMPONENTES COMPARTIDOS — panel y portal (UX 2026-10-08).
 *
 * Este archivo es IDÉNTICO en gymflow-web y gymflow-portal
 * (`components/compartido.tsx`), igual que `app/tokens.css` y
 * `app/compartido.css`; `pnpm test:tokens` falla si difieren. Incluye Button. Para cambiarlo:
 * edítalo en uno, cópialo al otro y actualiza la huella en ambos scripts.
 *
 * Solo depende de React y lucide-react: nada de `@/…`, que en cada app es
 * otra cosa. Cada app ajusta las medidas con variables (`--c-*`), no con
 * otro componente: el portal es más grande porque se usa con el pulgar.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CircleAlert, CircleCheck, Info, RotateCw } from 'lucide-react';

export type Tono = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'volt';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'volt';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
};

/**
 * Botón (UX7 sistema): el mismo componente en las dos apps. Las medidas son
 * de cada una (el portal es más alto, para el pulgar); las variantes y el
 * comportamiento —giro mientras carga, ícono, a todo lo ancho— son uno.
 */
export function Button({ variant = 'primary', size = 'md', loading, block, icon, children, className, disabled, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' ? `btn-${size}` : '', block ? 'btn-block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Etiqueta de estado ("Al corriente", "Suspendida"). Antes: Badge en el panel, Pill en el portal. */
export function Badge({ tone = 'neutral', dot, children }: { tone?: Tono; dot?: boolean; children: ReactNode }) {
  return <span className={`badge${tone === 'neutral' ? '' : ` badge-${tone}`}${dot ? ' badge-dot' : ''}`}>{children}</span>;
}

const ICONO_AVISO = { info: Info, warn: AlertTriangle, danger: CircleAlert, ok: CircleCheck };

/** Aviso en recuadro. Antes: Callout en el panel, Notice en el portal. */
export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode }) {
  const Icono = ICONO_AVISO[tone];
  return (
    <div className={`callout callout-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icono aria-hidden />
      <div className="callout-body">
        {title && <p className="callout-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Lo que no cargó, con salida: qué pasó y "Reintentar". Una sola forma en las
 * dos apps (antes eran dos con props distintas).
 */
export function ErrorCarga({ titulo = 'No se pudo cargar', mensaje, onReintentar }: {
  titulo?: string; mensaje?: ReactNode; onReintentar?: () => void;
}) {
  return (
    <div className="callout callout-warn" role="alert">
      <AlertTriangle aria-hidden />
      <div className="callout-body">
        <p className="callout-title">{titulo}</p>
        <p>{mensaje ?? 'Revisa tu conexión y vuelve a intentar.'}</p>
        {onReintentar && (
          <button type="button" className="btn btn-secondary btn-sm callout-accion" onClick={onReintentar}>
            <RotateCw aria-hidden />Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

/** Vacío con ícono, título, explicación y, si la hay, la acción que lo llena. */
export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action && <div className="empty-accion">{action}</div>}
    </div>
  );
}

/** Bloque de carga. Las medidas son del lugar que ocupa, por eso van como props. */
export function Skeleton({ h = 14, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

/**
 * Mosaico de ícono con tono (UX7 sistema 6): sustituye a `.bio-slot-icon` e
 * `.item-icon` con el color escrito en línea.
 */
export function IconTile({ tone = 'neutral', size = 'md', children }: { tone?: Tono; size?: 'sm' | 'md' | 'lg'; children: ReactNode }) {
  return <span className={`icon-tile icon-tile-${size}${tone === 'neutral' ? '' : ` icon-tile-${tone}`}`} aria-hidden>{children}</span>;
}

/** Botón de solo ícono. La etiqueta es obligatoria: es lo único que oye un lector de pantalla. */
export function IconButton({ label, children, className, type = 'button', ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string; children: ReactNode }) {
  return <button type={type} className={`icon-btn${className ? ` ${className}` : ''}`} aria-label={label} title={label} {...rest}>{children}</button>;
}

/**
 * La marca de GymFlow (UX7 sistema 7): su propio trazo. Antes era la pesa de
 * lucide, que también significaba Rutinas y Clases.
 */
export function Marca({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19.5 8.5A8 8 0 1 0 20 14h-7" />
      <path d="M13 14l3-4 2 2.5" />
    </svg>
  );
}
