'use client';

import { useCallback } from 'react';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorCarga, Switch } from '@/components/ui';
import { useCarga } from '@gymflow/ui/carga';

type Catalogo = {
  groups: Array<{ name: string; permissions: Array<{ key: string; description: string }> }>;
  /** `adjustable`: lo que se le ajusta a ESE puesto (17-02); sin él, todo el catálogo. */
  roles: Array<{
    key: string; permissions: string[]; adjustable?: string[];
    /** Lo que nunca se le enciende a ese puesto, con su porqué (P-09 y P-10, bloque 4.19). */
    never?: Array<{ key: string; description: string; why: string }>;
  }>;
};
export type Ajustes = { add: string[]; remove: string[] };

/** Otra persona del mismo puesto de quien se pueden copiar las excepciones (D17-04). */
type Otra = { id: string; fullName: string; isActive: boolean; permissionOverrides?: Ajustes | null };

/**
 * PERMISOS POR PERSONA (2026-10-09): encender o apagar acciones sueltas a
 * recepción o a un coach, sobre su puesto. La lista la cierra el servidor:
 * nunca personal, segundas firmas, bitácora ni configuración. Y es por puesto
 * (17-02): al coach solo se le ajusta lo de su trabajo, nunca dinero, caja,
 * venta, acceso ni altas; aquí solo aparece lo que se le puede ajustar.
 *
 * Quien no las ajusta (la dueña, mientras haya un gerente que administre) las
 * ve en lectura: lo que no te toca se lee, no desaparece (17-11).
 *
 * Lo que antes se ofrecía y ya no se enciende a ese puesto (anular ventas y la
 * nota de salud, a recepción: P-09 y P-10, bloque 4.19) no desaparece en
 * silencio: se dice que no se enciende y por qué.
 */
export function PermisosPersona({ roleKey, valor, onChange, editable = true, otras = [], onCopiar }: {
  roleKey: string; valor: Ajustes; onChange: (a: Ajustes) => void;
  editable?: boolean;
  otras?: readonly Otra[];
  onCopiar?: (de: Otra) => void;
}) {
  // Sin red la sección no desaparece en silencio (26-01): se dice que no cargó.
  const carga = useCarga(useCallback(() => api<Catalogo>('/users/adjustable-permissions'), []));
  const cat = carga.datos;
  if (carga.error) {
    return (
      <div className="field">
        <span className="label">Qué puede hacer</span>
        <ErrorCarga titulo="No se pudieron cargar los permisos que se le pueden ajustar" mensaje={carga.error} onReintentar={() => void carga.recargar()} />
      </div>
    );
  }
  if (!cat) return null;
  const puesto = cat.roles.find((r) => r.key === roleKey);
  const base = new Set(puesto?.permissions ?? []);
  const ajustables = puesto?.adjustable ? new Set(puesto.adjustable) : null;
  const grupos = cat.groups
    .map((g) => ({ ...g, permissions: g.permissions.filter((p) => !ajustables || ajustables.has(p.key)) }))
    .filter((g) => g.permissions.length > 0);
  const descripcion = new Map(cat.groups.flatMap((g) => g.permissions.map((p) => [p.key, p.description] as const)));
  const activo = (k: string) => (base.has(k) ? !valor.remove.includes(k) : valor.add.includes(k));
  const poner = (k: string, on: boolean) => {
    const add = valor.add.filter((x) => x !== k);
    const remove = valor.remove.filter((x) => x !== k);
    if (base.has(k) && !on) remove.push(k);
    if (!base.has(k) && on) add.push(k);
    onChange({ add, remove });
  };
  const cambios = valor.add.length + valor.remove.length;
  const nunca = puesto?.never ?? [];
  const noSeEnciende = nunca.length > 0 && (
    <div className="mt-8" data-testid="permisos-nunca">
      <span className="eyebrow">No se le encienden a este puesto</span>
      <ul className="list small">
        {nunca.map((n) => <li key={n.key}><span className="strong">{n.description}.</span> {n.why}</li>)}
      </ul>
    </div>
  );

  if (!editable) {
    return (
      <div className="field" data-testid="permisos-persona">
        <span className="label">Qué puede hacer</span>
        {cambios === 0
          ? <p className="small">Exactamente lo de su puesto, sin excepciones.</p>
          : (
            <ul className="list small">
              {valor.add.map((k) => <li key={`+${k}`}>Además: {descripcion.get(k) ?? k}</li>)}
              {valor.remove.map((k) => <li key={`-${k}`}>Sin: {descripcion.get(k) ?? k}</li>)}
            </ul>
          )}
        <p className="hint">Las excepciones al puesto las ajusta la gerencia.</p>
        {noSeEnciende}
      </div>
    );
  }

  // Solo las que ajustan algo a ESTE puesto: copiar la de otro puesto no tendría sentido.
  const copiables = otras.filter((o) => o.permissionOverrides);
  return (
    <div className="field" data-testid="permisos-persona">
      <div className="row-between">
        <span className="label">Qué puede hacer</span>
        <span className="row gap-8 items-center">
          {copiables.length > 0 && (
            <label className="row gap-6 items-center tiny muted">
              <Copy size={14} aria-hidden />
              <span className="sr-only">Copiar las excepciones de otra persona del mismo puesto</span>
              <select className="select w-auto" value="" data-testid="copiar-permisos"
                onChange={(e) => {
                  const de = copiables.find((o) => o.id === e.target.value);
                  if (!de?.permissionOverrides) return;
                  // Solo lo que se le ajusta a este puesto; lo demás el servidor lo rechazaría.
                  const vale = (k: string) => !ajustables || ajustables.has(k);
                  onChange({ add: de.permissionOverrides.add.filter(vale), remove: de.permissionOverrides.remove.filter(vale) });
                  onCopiar?.(de);
                }}>
                <option value="">Copiar lo de…</option>
                {copiables.map((o) => <option key={o.id} value={o.id}>{o.fullName}{o.isActive ? '' : ' (dada de baja)'}</option>)}
              </select>
            </label>
          )}
          {cambios > 0 && <button type="button" className="row-link tiny" onClick={() => onChange({ add: [], remove: [] })}>Volver a lo de su puesto</button>}
        </span>
      </div>
      <p className="hint mb-8">Lo marcado de inicio es lo de su puesto. {cambios > 0 ? `${cambios} ${cambios === 1 ? 'excepción' : 'excepciones'} sobre su puesto.` : 'Sin excepciones.'} Lo que pide segunda firma la sigue pidiendo.</p>
      {grupos.map((g) => (
        <div key={g.name} className="mb-8">
          <span className="eyebrow">{g.name}</span>
          <div className="grid grid-2 gap-4 mt-4">
            {g.permissions.map((p) => (
              <Switch key={p.key} checked={activo(p.key)} onChange={(v) => poner(p.key, v)}>
                {p.description}{base.has(p.key) !== activo(p.key) && <span className="muted"> · ajustado</span>}
              </Switch>
            ))}
          </div>
        </div>
      ))}
      {noSeEnciende}
    </div>
  );
}
