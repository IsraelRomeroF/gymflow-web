'use client';

import { SessionProvider, ToastProvider } from '@/components/session';
import { Shell, ShellSkeleton } from '@/components/shell';
import { ZonaDelGimnasio } from '@/components/ui/zona';

/** Todo lo que vive detrás del inicio de sesión comparte sesión, marco y avisos. */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider fallback={<ShellSkeleton />}>
        {/* Antes del marco: fechas y horas en la zona del gimnasio desde el primer cuadro (26-06). */}
        <ZonaDelGimnasio />
        <Shell>{children}</Shell>
      </SessionProvider>
    </ToastProvider>
  );
}
