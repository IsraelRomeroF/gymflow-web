'use client';

import type { ReactNode } from 'react';
import { Callout, ErrorCarga, Skeleton } from '../compartido';

export type CifraPrevia = {
  etiqueta: ReactNode;
  valor: ReactNode;
  /** Una línea debajo de la etiqueta: de dónde sale la cifra. */
  nota?: ReactNode;
  tono?: 'ok' | 'warn' | 'danger';
};

/**
 * VISTA PREVIA (consolidado, «Sistema de componentes»): antes de lo que no
 * tiene vuelta atrás —cerrar el mes, emitir las facturas, aplicar una
 * importación, cerrar una sucursal, apagar Caja, cambiar de puesto, publicar
 * un texto, anonimizar— se dice qué va a pasar, siempre en el mismo orden:
 *
 *   1. lo que lo IMPIDE (`bloqueos`, en rojo): con uno, el botón no procede;
 *   2. lo que hay que saber (`avisos`, en ámbar);
 *   3. las cifras, una por renglón (`cifras`).
 *
 * El botón principal lleva la cifra que importa («Emitir 18 facturas ·
 * $32,400»); eso lo arma cada pantalla. Con `cargando` o `error` (la vista
 * previa casi siempre se pide al servidor, con `useCarga`), pinta su
 * esqueleto o el error con «Reintentar»: nunca cifras viejas.
 */
export function VistaPrevia({ cifras = [], avisos = [], bloqueos = [], titulo = 'Lo que va a pasar', cargando, error, onReintentar, children }: {
  cifras?: ReadonlyArray<CifraPrevia>;
  avisos?: ReadonlyArray<ReactNode>;
  bloqueos?: ReadonlyArray<ReactNode>;
  /** El rótulo sobre las cifras. */
  titulo?: ReactNode;
  cargando?: boolean;
  error?: string | null;
  onReintentar?: () => void;
  children?: ReactNode;
}) {
  if (error) return <ErrorCarga titulo="No se pudo calcular lo que va a pasar" mensaje={error} onReintentar={onReintentar} />;
  if (cargando) {
    return (
      <div className="vista-previa" aria-busy="true" aria-label="Calculando lo que va a pasar">
        <Skeleton h={12} w={140} />
        <Skeleton h={36} /><Skeleton h={36} />
      </div>
    );
  }
  return (
    <div className="vista-previa">
      {bloqueos.length > 0 && (
        <Callout tone="danger" title={bloqueos.length === 1 ? 'Antes hay que resolver esto' : `Antes hay que resolver ${bloqueos.length} cosas`}>
          <Lista items={bloqueos} />
        </Callout>
      )}
      {avisos.length > 0 && <Callout tone="warn" title="Ten en cuenta"><Lista items={avisos} /></Callout>}
      {cifras.length > 0 && (
        <div className="vista-previa-cifras">
          {titulo && <p className="eyebrow">{titulo}</p>}
          <dl>
            {cifras.map((c, i) => (
              <div key={i} className="vista-previa-fila" data-tono={c.tono}>
                <dt>{c.etiqueta}{c.nota && <span className="hint block">{c.nota}</span>}</dt>
                <dd className="num">{c.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {children}
    </div>
  );
}

/** ¿Se puede seguir? Sin bloqueos, sí. */
export const sePuedeSeguir = (bloqueos?: ReadonlyArray<unknown>): boolean => !bloqueos || bloqueos.length === 0;

function Lista({ items }: { items: ReadonlyArray<ReactNode> }) {
  if (items.length === 1) return <p>{items[0]}</p>;
  return <ul className="vista-previa-lista">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}
