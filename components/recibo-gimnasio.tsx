'use client';

import { useEffect, useState } from 'react';
import type { GymLogo } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { telefono } from '@/lib/format';
import { useSession } from './session';

/**
 * LO QUE EL RECIBO IMPRIME DEL GIMNASIO (D-27, bloque 4.6): su logo arriba y,
 * al pie, su teléfono, su WhatsApp, su RFC y la leyenda del recibo. Todo lo
 * administra GymFlow (se pide en Mi gimnasio → «Pedir un cambio a GymFlow»);
 * lo que no esté registrado, simplemente no sale.
 */
export function LogoDeRecibo() {
  const { org } = useSession();
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (!org.hasLogo) return;
    // Si no carga, el recibo sale sin logo: no es motivo para no imprimirlo.
    api<GymLogo>('/organization/logo').then((r) => setLogo(r.logo)).catch(() => setLogo(null));
  }, [org.hasLogo]);
  // El logo viene como data: desde la API, no es una imagen del sitio
  return logo ? <img src={logo} alt="" className="recibo-logo" data-testid="recibo-logo" /> : null;
}

export function PieDeRecibo() {
  const { org } = useSession();
  const contacto = [org.phone ? `Tel. ${telefono(org.phone)}` : null, org.whatsapp ? `WhatsApp ${telefono(org.whatsapp)}` : null, org.rfc ? `RFC ${org.rfc}` : null].filter(Boolean);
  if (contacto.length === 0 && !org.receiptLegend) return null;
  return (
    <p className="recibo-pie" data-testid="recibo-pie">
      {org.receiptLegend}{org.receiptLegend && contacto.length > 0 ? '\n' : ''}{contacto.join(' · ')}
    </p>
  );
}
