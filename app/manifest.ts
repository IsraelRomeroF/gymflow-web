import type { MetadataRoute } from 'next';

/** El panel se instala en el teléfono del dueño (DP-10): así le llegan las firmas aunque esté cerrado. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GymFlow · Panel', short_name: 'GymFlow', description: 'Panel del gimnasio', lang: 'es-MX',
    start_url: '/panel', display: 'standalone', background_color: '#f5f6f4', theme_color: '#0d0f12',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}
