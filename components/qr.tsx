'use client';

import qrcode from 'qrcode-generator';

/**
 * Código QR en SVG, generado en el navegador: nada sale a un servicio externo
 * y se imprime nítido a cualquier tamaño.
 */
export function Qr({ value, size = 220, dark = '#111317' }: { value: string; size?: number; dark?: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const margen = 2;
  const total = n + margen * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) d += `M${x + margen} ${y + margen}h1v1h-1z`;
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} role="img" aria-label="Código QR" shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#fff" />
      <path d={d} fill={dark} />
    </svg>
  );
}
