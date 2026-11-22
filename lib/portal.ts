'use client';

import { useEffect, useState } from 'react';

/**
 * Dirección pública del portal del socio. La entrega la API al arrancar
 * (`PORTAL_PUBLIC_URL`, p. ej. el túnel para probar desde el teléfono), no se
 * fija al compilar: así un dominio o túnel nuevo no obliga a recompilar.
 * Sin ella, el portal está en el mismo equipo que el panel, puerto 3002.
 */
export const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3002').replace(/\/$/, '');

const mismoEquipo = () => (typeof window === 'undefined' ? PORTAL_URL : `${window.location.protocol}//${window.location.hostname}:3002`);
let cache: string | null = null;
let pedido: Promise<string> | null = null;

export function usePortalUrl(): string {
  const [url, setUrl] = useState<string>(cache ?? PORTAL_URL);
  useEffect(() => {
    if (cache) { setUrl(cache); return; }
    pedido ??= fetch('/api/public/config')
      .then((r) => r.json() as Promise<{ portalUrl: string | null }>)
      .then((j) => (cache = (j.portalUrl ?? process.env.NEXT_PUBLIC_PORTAL_URL ?? mismoEquipo()).replace(/\/$/, '')))
      .catch(() => (cache = mismoEquipo()));
    void pedido.then(setUrl);
  }, []);
  return url;
}

/**
 * Enlace del formulario de alta de una sucursal: lo que codifica el QR. Con
 * su enlace corto (`/alta/fuerza-centro`) si lo tiene: uno con UUID no se puede
 * dictar ni poner en Instagram (UXB-14).
 */
export const enlaceAlta = (portal: string, idOEnlace: string) => `${portal}/alta/${idOEnlace}`;
