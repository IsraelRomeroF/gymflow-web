'use client';

/*
 * CARGA CON SUS TRES ESTADOS — panel y portal (auditoría 8, 26-01).
 *
 * Este archivo es IDÉNTICO en gymflow-web y gymflow-portal (`lib/carga.tsx`).
 * Vive aparte de `components/compartido.tsx` para no mover la huella de los
 * archivos espejo que vigila `pnpm test:tokens`; si lo cambias en uno, cópialo
 * al otro. Solo depende de React y de las piezas de `compartido.tsx`.
 *
 * Un error de red NUNCA se muestra como «no hay nada» (UI3-01): cada carga
 * dice si está llegando, si falló (con «Reintentar») o si llegó vacía de verdad.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorCarga, Skeleton } from '../components/compartido';

/** El mensaje de un error para quien lo lee: el de la API (ya viene en español) o uno genérico. */
export function mensajeDeError(e: unknown, siNo = 'Revisa tu conexión y vuelve a intentar.'): string {
  return e instanceof Error && e.message ? e.message : siNo;
}

/** Lo que devuelve `useCarga`: los tres estados de una carga, nunca un error disfrazado de vacío (26-01). */
export type Carga<T> = {
  /** Lo que llegó bien. `undefined` mientras llega la primera vez, o si la última vez falló. */
  datos: T | undefined;
  /** Qué falló, dicho para quien lo lee; `null` si no falló. */
  error: string | null;
  /** Hay una petición en curso (la primera o una recarga): sirve para atenuar lo que ya se ve. */
  cargando: boolean;
  /** Vuelve a pedir: el «Reintentar», o después de guardar algo. */
  recargar: () => Promise<void>;
  /** Cambia lo cargado en su lugar (quitar una fila, sumar otra) sin volver a pedir. */
  poner: (cambio: T | ((antes: T | undefined) => T)) => void;
};

/**
 * Una carga con sus tres estados (26-01): llegando, falló (con «Reintentar»)
 * o llegó, aunque sea vacía. `cargar` debe ser estable (`useCallback`):
 * cuando cambia —otra sucursal, otro mes— se vuelve a pedir, lo de antes deja
 * de verse (salvo `conservar`, para atenuarlo mientras llega lo nuevo) y la
 * respuesta vieja ya no pisa a la nueva. `recargar` sí deja lo de antes a la
 * vista mientras llega. Con `null` no se pide nada (falta un dato o el puesto
 * no lo ve). Si falla, lo anterior se descarta: un error nunca deja a la
 * vista las cifras de antes como si fueran las de ahora (13-18).
 */
export function useCarga<T>(cargar: (() => Promise<T>) | null, opciones?: { conservar?: boolean }): Carga<T> {
  const conservar = opciones?.conservar ?? false;
  const [estado, setEstado] = useState<{ datos: T | undefined; error: string | null; cargando: boolean }>(
    () => ({ datos: undefined, error: null, cargando: cargar !== null }));
  const vigente = useRef(cargar);
  const turno = useRef(0);
  const recargar = useCallback(async () => {
    const fn = vigente.current;
    const n = ++turno.current;
    if (!fn) {
      setEstado((e) => (e.datos === undefined && e.error === null && !e.cargando ? e : { datos: undefined, error: null, cargando: false }));
      return;
    }
    setEstado((e) => ({ ...e, error: null, cargando: true }));
    try {
      const datos = await fn();
      if (n === turno.current) setEstado({ datos, error: null, cargando: false });
    } catch (e) {
      if (n === turno.current) setEstado({ datos: undefined, error: mensajeDeError(e), cargando: false });
    }
  }, []);
  useEffect(() => {
    vigente.current = cargar;
    if (!conservar) setEstado((e) => (e.datos === undefined ? e : { ...e, datos: undefined }));
    void recargar();
  }, [cargar, recargar, conservar]);
  const poner = useCallback((cambio: T | ((antes: T | undefined) => T)) => setEstado((e) => ({
    ...e, error: null, datos: typeof cambio === 'function' ? (cambio as (antes: T | undefined) => T)(e.datos) : cambio,
  })), []);
  return { ...estado, recargar, poner };
}

/**
 * Pinta UNO de los tres estados de una carga (26-01): el esqueleto mientras
 * llega, el error con «Reintentar» o, con una respuesta correcta, el vacío de
 * verdad o el contenido. Mientras se vuelve a pedir, lo de antes sigue a la
 * vista (la pantalla no brinca). `relleno` da al error y al esqueleto el
 * margen de una tarjeta que no trae el suyo.
 */
export function EstadoCarga<T>({ carga, titulo, esqueleto, vacio, esVacio, relleno, children }: {
  carga: Pick<Carga<T>, 'datos' | 'error' | 'recargar'>;
  /** Qué no cargó: «No se pudieron cargar las sucursales». */
  titulo?: string;
  esqueleto?: ReactNode;
  /** Solo con una respuesta correcta y nada que mostrar. */
  vacio?: ReactNode;
  /** Cuándo cuenta como vacío; por omisión, una lista sin elementos. */
  esVacio?: (datos: T) => boolean;
  relleno?: boolean;
  children: (datos: T) => ReactNode;
}) {
  const envolver = (x: ReactNode) => (relleno ? <div className="estado-carga">{x}</div> : <>{x}</>);
  if (carga.error !== null) return envolver(<ErrorCarga titulo={titulo} mensaje={carga.error} onReintentar={() => void carga.recargar()} />);
  if (carga.datos === undefined) return envolver(esqueleto ?? <Skeleton h={64} />);
  const vacia = esVacio ? esVacio(carga.datos) : Array.isArray(carga.datos) && carga.datos.length === 0;
  if (vacia && vacio !== undefined) return <>{vacio}</>;
  return <>{children(carga.datos)}</>;
}

