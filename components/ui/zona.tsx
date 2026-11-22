'use client';

import { useSession } from '@/components/session';
import { fijarZona } from '@/lib/format';

/**
 * LA ZONA DEL GIMNASIO PARA TODO EL PANEL (26-06): fija la de la organización
 * en `lib/format.ts`, así `fecha()`, `hora()` y compañía pintan la hora del
 * gimnasio y no la de la computadora. Va dentro de `SessionProvider` y ANTES
 * del marco: se fija al pintarse, así el primer cuadro ya sale con la hora
 * correcta (un efecto llegaría un cuadro tarde). Una sucursal con su propia
 * zona la pasa explícita: `hora(iso, zonaDe(sede, org))`.
 */
export function ZonaDelGimnasio(): null {
  const { org } = useSession();
  fijarZona(org.timezone);
  return null;
}
