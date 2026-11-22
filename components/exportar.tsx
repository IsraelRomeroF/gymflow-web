'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * CSV que Excel abre bien (DP-06): UTF-8 con BOM, todo entre comillas. Lo
 * mismo que ya hacía Movimientos, en un solo lugar para todas las pantallas.
 */
export function descargarCsv(nombre: string, filas: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): void {
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre.endsWith('.csv') ? nombre : `${nombre}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Botón "Exportar" uniforme. `filas` se arma al pulsar: no cuesta nada mientras nadie exporta. */
export function Exportar({ nombre, filas, disabled, size = 'sm' }: {
  nombre: string; filas: () => ReadonlyArray<ReadonlyArray<string | number | null | undefined>>; disabled?: boolean; size?: 'sm' | 'md';
}) {
  return <Button variant="secondary" size={size} icon={<Download />} disabled={disabled} onClick={() => descargarCsv(nombre, filas())}>Exportar</Button>;
}
