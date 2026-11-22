import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SCRIPT_TEMA } from '@/components/tema';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'GymFlow', template: '%s · GymFlow' },
  description: 'Gestión integral de gimnasios',
  // Instalable en el teléfono (DP-10): la firma del dueño llega aunque el panel esté cerrado.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'GymFlow', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f12' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-theme` lo pone el script antes de hidratar: sin la advertencia
    // suprimida, React se quejaría de un atributo que él no puso.
    <html lang="es-MX" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
