'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { nombrePlanArchivo } from '@/lib/importar';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Callout, Card, ErrorCarga, Field } from '@/components/ui';
import type { Carga } from '@gymflow/ui/carga';
import { NO_CARGAR, type Detalle, type Plan } from './tipos';

/**
 * Planes y sucursales del archivo. Cada plan que trae vigencias exige una
 * decisión explícita (18-03): «cargar como <plan>» o «no cargar su vigencia»;
 * mientras falte, no se aplica. No hay valor por omisión que deje sin
 * membresía a socios que ya pagaron.
 */
export function Asignaciones({ d, planes: planesCarga, editable, onGuardado }: { d: Detalle; planes: Carga<Plan[]>; editable: boolean; onGuardado: () => void }) {
  const planes = planesCarga.datos ?? [];
  // Sin el catálogo a la vista no se decide: la única opción sería «No cargar».
  const sinPlanes = planesCarga.datos === undefined;
  const toast = useToast();
  const { branches, inScope, branchName } = useSession();
  const casa = branchName(d.branchId);
  // Sucursales del archivo que no se reconocieron (18-11): sus socios van a la de casa si nadie elige otra.
  const [planMap, setPlanMap] = useState(d.planMap);
  const [branchMap, setBranchMap] = useState(d.branchMap);
  const sinReconocer = d.labels.branches.filter((b) => !branchMap[b.label]);
  const [guardando, setGuardando] = useState(false);
  const cambiado = JSON.stringify(planMap) !== JSON.stringify(d.planMap) || JSON.stringify(branchMap) !== JSON.stringify(d.branchMap);
  const decidido = (label: string) => Object.prototype.hasOwnProperty.call(planMap, label);
  const faltan = d.labels.plans.filter((p) => p.vigentes > 0 && !decidido(p.label));
  async function guardar() {
    setGuardando(true);
    try {
      await api(`/member-imports/${d.id}/maps`, { method: 'PUT', body: JSON.stringify({ planMap, branchMap }) });
      onGuardado();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setGuardando(false); }
  }
  return (
    <Card title="2 · Planes y sucursales del archivo" sub="Las vigencias se cargan con el plan de GymFlow que elijas para cada plan del archivo, con su precio de hoy en la sucursal del socio. Elige también si alguna no se carga: sin esa decisión no se aplica."
      actions={editable && cambiado ? <Button size="sm" loading={guardando} onClick={() => void guardar()}>Guardar</Button> : undefined} data-testid="asignaciones">
      <div className="stack">
        {editable && faltan.length > 0 && (
          <Callout tone="warn">Falta elegir qué hacer con {faltan.map((p) => `${nombrePlanArchivo(p.label)} (${p.vigentes} con vigencia)`).join(', ')}.</Callout>
        )}
        {sinReconocer.length > 0 && (
          <Callout tone="warn" title={sinReconocer.length === 1 ? 'Una sucursal del archivo no se reconoció' : `${sinReconocer.length} sucursales del archivo no se reconocieron`}>
            {sinReconocer.map((b) => `«${b.label}» (${b.rows} ${b.rows === 1 ? 'socio' : 'socios'})`).join(', ')}: {editable ? 'si no eliges su sucursal, irán' : 'fueron'} a {casa}, la sucursal de casa de esta importación.
          </Callout>
        )}
        {planesCarga.error && <ErrorCarga titulo="No se pudieron cargar los planes de GymFlow" mensaje={planesCarga.error} onReintentar={() => void planesCarga.recargar()} />}
        <div className="grid grid-2">
          {d.labels.plans.length > 0 && (
            <div className="stack-sm">
              <p className="label">Planes</p>
              {d.labels.plans.map((p) => {
                const valor = !decidido(p.label) ? '' : planMap[p.label] === null ? NO_CARGAR : planMap[p.label]!;
                return (
                  <Field key={p.label} label={<>{nombrePlanArchivo(p.label)} <span className="tiny muted">· {p.rows} {p.rows === 1 ? 'socio' : 'socios'}{p.vigentes ? `, ${p.vigentes} con vigencia` : ''}</span></>}
                    htmlFor={`plan-${p.label || 'sin-plan'}`} required={p.vigentes > 0}>
                    <select id={`plan-${p.label || 'sin-plan'}`} className="select" disabled={!editable || sinPlanes} value={valor}
                      onChange={(e) => setPlanMap({ ...planMap, [p.label]: e.target.value === NO_CARGAR ? null : e.target.value })}>
                      <option value="" disabled>Elige qué hacer…</option>
                      <option value={NO_CARGAR}>No cargar su vigencia{p.vigentes ? ` (${p.vigentes} ${p.vigentes === 1 ? 'socio quedará' : 'socios quedarán'} sin membresía)` : ''}</option>
                      {planes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </Field>
                );
              })}
            </div>
          )}
          {d.labels.branches.length > 0 && (
            <div className="stack-sm">
              <p className="label">Sucursales</p>
              {d.labels.branches.map((b) => (
                <Field key={b.label} label={<>{b.label} <span className="tiny muted">· {b.rows} {b.rows === 1 ? 'socio' : 'socios'}</span></>} htmlFor={`sede-${b.label}`}
                  hint={!branchMap[b.label] ? <span className="text-warn">No coincide con ninguna sucursal: irán a {casa}.</span> : undefined}>
                  <select id={`sede-${b.label}`} className="select" disabled={!editable} value={branchMap[b.label] ?? ''} onChange={(e) => setBranchMap({ ...branchMap, [b.label]: e.target.value || null })}>
                    <option value="">La sucursal de casa de la importación ({casa})</option>
                    {branches.filter((x) => x.isActive && inScope(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
