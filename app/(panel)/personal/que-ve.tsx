'use client';

import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Switch } from '@/components/ui';
import { useSession } from '@/components/session';
import { conSeccion, tiene } from '@/components/llave-secciones';
import { frase, moduloDeLlave, seccionesConEfecto, soloConEfecto, type Persona } from './persona';

/**
 * Lo que la sección le da a ESE puesto cuando no es lo mismo que a la gerencia
 * (17-05): a recepción, Planes le muestra los precios pero no la deja
 * cambiarlos. Sin entrada, vale el texto de la sección.
 */
const PARA_EL_PUESTO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  RECEPTION: {
    caja: 'Abre y cierra su turno y hace su corte.',
    pos: 'Vende producto en el mostrador.',
    retencion: 'Ve a quién llamar antes de que deje de venir y anota la llamada.',
    planes: 'Consulta los planes y sus precios; no los cambia.',
    consentimientos: 'Consulta el aviso de privacidad y el reglamento publicados; no los publica.',
  },
  COACH: {
    planes: 'Consulta los planes y sus precios; no los cambia.',
  },
};

const GRUPOS = ['Operación', 'Dirección', 'Cumplimiento'] as const;

/**
 * QUÉ VE (la llave de la dueña), solo con lo que tiene efecto para su puesto
 * (17-05): a una recepcionista, Caja, Punto de venta, Retención, Planes y
 * Textos de consentimiento; a un coach, Planes; a un gerente, las catorce.
 * Cada interruptor dice debajo qué le da (17-13). «Copiar lo de…» trae la
 * lista de otra persona del mismo puesto (D17-04): el gerente que reemplaza
 * a otro hereda lo suyo con un toque, y la dueña lo revisa antes de guardar.
 */
export function QueVe({ puesto, liberadas, onChange, editable, otras, onCopiar, hint }: {
  puesto: string; liberadas: string[]; onChange: (l: string[]) => void; editable: boolean;
  /** Personas del mismo puesto de quien se puede copiar. */
  otras: readonly Persona[];
  onCopiar?: (de: Persona) => void;
  hint?: ReactNode;
}) {
  const { activo } = useSession();
  const secciones = seccionesConEfecto(puesto);
  if (secciones.length === 0) return null;
  const explicacion = (x: (typeof secciones)[number]) => PARA_EL_PUESTO[puesto]?.[x.key] ?? x.text;
  const apagada = (key: string) => { const m = moduloDeLlave(key); return !!m && !activo(m); };

  if (!editable) {
    const ve = secciones.filter((x) => !x.abierta && tiene(x, liberadas)).map((x) => x.name);
    const sin = secciones.filter((x) => x.abierta && !tiene(x, liberadas)).map((x) => x.name);
    return (
      <div className="field" data-testid="secciones-llave">
        <span className="label">Qué ve</span>
        <p className="small">
          {ve.length === 0 ? 'Solo la operación de su puesto' : `Además de la operación: ${frase(ve)}`}
          {sin.length > 0 && `; sin ${frase(sin)}`}.
        </p>
        {hint && <p className="hint">{hint}</p>}
      </div>
    );
  }

  const copiables = otras.filter((o) => o.unlockedSections);
  return (
    <div className="field" data-testid="secciones-llave">
      <div className="row-between">
        <span className="label">Qué ve</span>
        {copiables.length > 0 && (
          <label className="row gap-6 items-center tiny muted">
            <Copy size={14} aria-hidden />
            <span className="sr-only">Copiar lo que ve otra persona del mismo puesto</span>
            <select className="select w-auto" value="" data-testid="copiar-que-ve"
              onChange={(e) => {
                const de = copiables.find((o) => o.id === e.target.value);
                if (!de) return;
                onChange(soloConEfecto(de.unlockedSections ?? [], puesto));
                onCopiar?.(de);
              }}>
              <option value="">Copiar lo de…</option>
              {copiables.map((o) => <option key={o.id} value={o.id}>{o.fullName}{o.isActive ? '' : ' (dada de baja)'}</option>)}
            </select>
          </label>
        )}
      </div>
      {hint && <p className="hint mb-8">{hint}</p>}
      {GRUPOS.map((g) => {
        const del = secciones.filter((x) => x.group === g);
        if (del.length === 0) return null;
        const todas = del.every((x) => tiene(x, liberadas));
        return (
          <div key={g} className="mb-8">
            <div className="row-between mb-4">
              <span className="eyebrow">{g}</span>
              {/* Con tres o menos se marcan a mano; «Marcar todo» sobra (17-05). */}
              {del.length > 3 && <button type="button" className="row-link tiny" onClick={() => onChange(del.reduce((lista, x) => conSeccion(x, lista, !todas), liberadas))}>{todas ? 'Quitar todo' : 'Marcar todo'}</button>}
            </div>
            <div className="grid grid-2 gap-4">
              {del.map((x) => (
                <div key={x.key}>
                  <Switch checked={tiene(x, liberadas)} onChange={(v) => onChange(conSeccion(x, liberadas, v))}>{x.name}</Switch>
                  <p className="hint mt-2">{explicacion(x)}{apagada(x.key) ? ' Hoy está apagado en el gimnasio.' : ''}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
