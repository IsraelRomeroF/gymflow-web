'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@gymflow/ui/format';
import { errorText } from '@/components/session';
import { Badge, Breadcrumb, Button, Callout, Card, PageHeader, Segmented, EsqueletoTabla } from '@/components/ui';

type Permiso = { key: string; domain: string; description: string; requiresReason: boolean; requiresApproval: boolean };
type Limites = {
  maxDiscountPercent: number | null; maxWaiverAmountCents: string | null; maxManualBalanceAdjustCents: string | null;
  maxCashWithdrawalCents: string | null; maxRefundAmountCents: string | null;
  maxManualAccessGrantsPerShift: number | null; maxPosVoidsPerShift: number | null;
};
type Rol = { key: string; name: string; permissions: string[]; limits: Limites | null };
type Matriz = { permissions: Permiso[]; roles: Rol[] };

/** Los puestos del gimnasio, en orden de responsabilidad (ADR-039). La plataforma va aparte. */
const ORDEN = ['OWNER', 'MANAGER', 'RECEPTION', 'COACH'] as const;
const AREA: Record<string, string> = {
  members: 'Socios', memberships: 'Membresías', billing: 'Cargos y descuentos', payments: 'Pagos', cash: 'Caja',
  pos: 'Punto de venta', access: 'Accesos', classes: 'Clases', training: 'Rutinas', catalog: 'Planes y precios',
  staff: 'Personal', reports: 'Reportes', expenses: 'Gastos fijos', audit: 'Bitácora', settings: 'Configuración',
};

/**
 * ROLES Y PERMISOS: qué puede ver y hacer cada persona. Se arma con el
 * catálogo y los topes de la base, así que siempre dice lo que el sistema
 * de verdad permite.
 */
export default function RolesPage() {
  const [m, setM] = useState<Matriz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ver, setVer] = useState<'TODOS' | (typeof ORDEN)[number]>('TODOS');
  // Las áreas nacen plegadas: abiertas, la matriz medía casi siete pantallas (UX5-G-08).
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  useEffect(() => { api<Matriz>('/roles/matrix').then(setM).catch((e) => setError(errorText(e, 'No se pudo cargar'))); }, []);
  // En el teléfono cuatro columnas no caben: se empieza por un rol y se cambia arriba.
  useEffect(() => { if (window.matchMedia('(max-width: 720px)').matches) setVer('RECEPTION'); }, []);

  const roles = useMemo(() => ORDEN.map((k) => m?.roles.find((r) => r.key === k)).filter((r): r is Rol => !!r), [m]);
  const columnas = ver === 'TODOS' ? roles : roles.filter((r) => r.key === ver);
  const areas = useMemo(() => {
    const g = new Map<string, Permiso[]>();
    for (const p of m?.permissions ?? []) {
      if (!AREA[p.domain]) continue;
      // Solo lo que algún rol del gimnasio tiene: lo de soporte no le dice nada a la dueña.
      if (!roles.some((r) => r.permissions.includes(p.key))) continue;
      g.set(p.domain, [...(g.get(p.domain) ?? []), p]);
    }
    return [...g.entries()];
  }, [m, roles]);

  return (
    <>
      <PageHeader eyebrow={<Breadcrumb items={[{ label: 'Personal', href: '/personal' }, { label: 'Puestos' }]} />} title="Puestos" sub="Qué puede ver y hacer cada puesto. Cada puesto se asigna por sucursal o para todo el gimnasio." />
      {error && <Callout tone="danger">{error}</Callout>}
      {!m ? <div className="card"><EsqueletoTabla filas={8} columnas={5} /></div> : (
        <div className="stack">
          <div className="grid grid-4">
            {roles.map((r) => (
              <Card key={r.key} title={r.name} sub={`${r.permissions.filter((k) => AREA[k.split(':')[0]!]).length} acciones`}>
                <ul className="small stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {resumenLimites(r.limits).map((l) => <li key={l}>{l}</li>)}
                </ul>
              </Card>
            ))}
          </div>
          <p className="tiny muted">
            <strong>Motivo</strong>: hay que escribir por qué y queda en la bitácora. <strong>2 firmas</strong>: además lo autoriza el dueño,
            aquí o desde su teléfono; nadie se autoriza a sí mismo.
          </p>

          <div className="row wrap gap-10">
            <Segmented value={ver} onChange={setVer} options={[{ value: 'TODOS' as const, label: 'Todos' }, ...roles.map((r) => ({ value: r.key as (typeof ORDEN)[number], label: r.name }))]} />
          </div>

          <div className="row wrap" style={{ gap: 10, justifyContent: 'space-between' }}>
            <span className="small muted">{areas.length} áreas · toca una para ver sus acciones</span>
            <Button size="sm" variant="ghost" onClick={() => setAbiertas(abiertas.size === areas.length ? new Set() : new Set(areas.map(([d]) => d)))}>
              {abiertas.size === areas.length ? 'Plegar todo' : 'Desplegar todo'}
            </Button>
          </div>
          {areas.map(([dominio, permisos]) => (
            <details key={dominio} className="card area-plegable" data-area={dominio} open={abiertas.has(dominio)}
              onToggle={(e) => { const abierta = (e.currentTarget as HTMLDetailsElement).open; setAbiertas((a) => { if (a.has(dominio) === abierta) return a; const n = new Set(a); if (abierta) n.add(dominio); else n.delete(dominio); return n; }); }}>
              <summary>
                <span className="strong">{AREA[dominio]}</span>
                <span className="area-conteo">
                  {columnas.map((r) => <span key={r.key} className="tiny muted">{columnas.length > 1 ? `${r.name} ` : ''}{permisos.filter((p) => r.permissions.includes(p.key)).length}/{permisos.length}</span>)}
                </span>
              </summary>
              <div className="table-wrap">
                <table className="table roles-tabla">
                  <thead>
                    <tr><th>Acción</th>{columnas.map((r) => <th key={r.key} className="center">{r.name}</th>)}</tr>
                  </thead>
                  <tbody>
                    {permisos.map((p) => (
                      <tr key={p.key}>
                        <td>
                          <span className="small">{p.description}</span>
                          {(p.requiresReason || p.requiresApproval) && (
                            <span className="row gap-4 mt-4">
                              {p.requiresReason && <Badge>Motivo</Badge>}
                              {p.requiresApproval && <Badge tone="warn">2 firmas</Badge>}
                            </span>
                          )}
                        </td>
                        {columnas.map((r) => (
                          <td key={r.key} className="center">
                            {r.permissions.includes(p.key)
                              ? <><Check size={16} aria-hidden style={{ color: 'var(--ok)' }} /><span className="sr-only">Sí</span></>
                              : <span className="faint"><span aria-hidden>—</span><span className="sr-only">No</span></span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <p className="tiny muted">El socio no tiene rol: en su portal ve y hace solo lo suyo (pagar, reservar, su rutina, descargar sus datos).</p>
        </div>
      )}
    </>
  );
}

function resumenLimites(l: Limites | null): string[] {
  if (!l) return ['Sin topes configurados'];
  const sinTope = (v: unknown) => v === null;
  if (Object.values(l).every(sinTope)) return ['Sin topes'];
  const dinero = (v: string | null, que: string) => (v === null ? `${que}: sin tope` : v === '0' ? `${que}: no` : `${que}: hasta ${pesos(v, { decimals: false })}`);
  return [
    l.maxDiscountPercent === null ? 'Descuento: sin tope' : l.maxDiscountPercent === 0 ? 'Descuento: no' : `Descuento: hasta ${l.maxDiscountPercent} %`,
    dinero(l.maxWaiverAmountCents, 'Condonar'),
    dinero(l.maxRefundAmountCents, 'Reembolsar'),
    dinero(l.maxCashWithdrawalCents, 'Retiro de caja'),
    ...(l.maxManualAccessGrantsPerShift !== null ? [`Accesos por excepción: ${l.maxManualAccessGrantsPerShift} por turno`] : []),
  ];
}
