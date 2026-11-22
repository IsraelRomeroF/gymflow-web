'use client';

import { periodo } from './textos';

/**
 * CAMPO DE MES de la consola. El `type="month"` del navegador decía «November
 * 2026» en inglés y dejaba elegir cualquier mes; este ofrece solo los meses
 * que se pueden facturar, con su nombre en español, y dice cuál ya tiene
 * factura (26-06, 23-06).
 */
export function CampoMes({ id, value, onChange, meses, disabled }: {
  id: string; value: string; onChange: (mes: string) => void;
  meses: ReadonlyArray<{ month: string; invoiced?: boolean }>; disabled?: boolean;
}) {
  return (
    <select id={id} className="select campo-corto" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {meses.map((m) => <option key={m.month} value={m.month}>{periodo(m.month)}{m.invoiced ? ' · facturado' : ''}</option>)}
    </select>
  );
}

/** El mes en curso y los dos anteriores, para emitir a todas las marcas. */
export function mesesRecientes(mesActual: string, cuantos = 3): Array<{ month: string }> {
  const [anio, mes] = mesActual.split('-').map(Number) as [number, number];
  return Array.from({ length: cuantos }, (_, i) => {
    const d = new Date(Date.UTC(anio, mes - 1 - i, 1));
    return { month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` };
  });
}
