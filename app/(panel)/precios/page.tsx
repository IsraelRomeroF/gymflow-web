'use client';

import { useCallback, useState } from 'react';
import { Tags } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@/lib/format';
import { ACCESO, MODELO, duracion, porPeriodo, type Plan } from '@/lib/plans';
import { useSession } from '@/components/session';
import { ButtonLink, Card, Empty, EsqueletoTabla, PageHeader, Segmented } from '@/components/ui';
import { EstadoCarga, useCarga } from '@/lib/carga';

const ORDEN = ['RECURRING', 'PREPAID_PERIOD', 'VISIT_PACK', 'DAY_PASS'] as const;

/** Qué incluye, en una línea: lo que el cliente pregunta después del precio. */
function incluye(p: Plan, conClases: boolean): string {
  if (p.billingModel === 'DAY_PASS') return 'Entra el día que lo compra, en esta sucursal';
  const partes = [
    ACCESO[p.branchAccessScope],
    p.includesClasses && conClases ? (p.includedClassTypeIds?.length ? `${p.includedClassTypeIds.length} ${p.includedClassTypeIds.length === 1 ? 'clase incluida' : 'clases incluidas'}` : 'Clases incluidas') : null,
    (p.billingModel === 'RECURRING' || p.billingModel === 'PREPAID_PERIOD') && p.allowFreeze ? `Se puede congelar hasta ${p.maxFreezeDaysPerYear} días al año` : null,
    p.billingModel === 'VISIT_PACK' && !p.visitValidityDays ? 'No caduca' : null,
  ];
  return partes.filter(Boolean).join(' · ');
}

/**
 * LISTA DE PRECIOS (16-02): lo que se vende hoy en una sucursal y cuánto
 * cuesta ahí, con el precio propio de la sede si lo tiene. Solo consulta y sin
 * llave: es lo que recepción le enseña al cliente y lo que cualquiera abre para
 * contestar «¿cuánto cuesta la anualidad?» sin entrar a la ficha de un socio.
 * Los planes se arman y se cambian en Planes (Dirección).
 */
export default function PreciosPage() {
  const { branches, inScope, canOrg, activoEn } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sedeId, setSedeId] = useState<string | null>(sedes[0]?.id ?? null);
  const sede = sedes.find((b) => b.id === sedeId) ?? null;

  const cargar = useCallback(() => api<Plan[]>(`/plans?branchId=${sedeId}`), [sedeId]);
  const carga = useCarga(sedeId ? cargar : null);

  return (
    <div className="stack gap-20">
      <PageHeader title="Lista de precios"
        sub={sede ? `Lo que se vende hoy en ${sede.name} y cuánto cuesta ahí. Es de consulta: se cobra desde la ficha del socio.` : 'Lo que se vende hoy y cuánto cuesta.'}
        actions={canOrg('catalog:manage') ? <ButtonLink href="/planes" variant="secondary">Cambiar planes y precios</ButtonLink> : undefined} />

      {sedes.length > 1 && (
        <Segmented desplazable etiqueta="Sucursal" value={sedeId} onChange={setSedeId} options={sedes.map((b) => ({ value: b.id, label: b.name }))} />
      )}

      {!sede ? (
        <Card><Empty icon={<Tags />} title="No tienes una sucursal asignada" text="La lista de precios es por sucursal. Pídele a la gerencia que te asigne la tuya." /></Card>
      ) : (
        <EstadoCarga carga={carga} titulo="No se pudo cargar la lista de precios" esqueleto={<div className="card"><EsqueletoTabla filas={5} columnas={4} /></div>}
          esVacio={(planes) => planes.length === 0}
          vacio={<Card><Empty icon={<Tags />} title={`En ${sede.name} no se vende ningún plan todavía`} text="Cuando la gerencia ponga planes a la venta en esta sucursal, aparecen aquí con su precio." /></Card>}>
          {(planes) => (
            <div className="stack gap-20" data-testid="lista-de-precios">
              {ORDEN.map((m) => ({ m, xs: planes.filter((p) => p.billingModel === m) })).filter((g) => g.xs.length > 0).map((g) => (
                <Card key={g.m} title={MODELO[g.m].label} sub={MODELO[g.m].hint} pad={false}>
                  <div className="table-wrap">
                    <table className="table table-stack precios">
                      <thead><tr><th>Plan</th><th className="right">Precio</th><th className="right">Inscripción</th><th>Incluye</th></tr></thead>
                      <tbody>
                        {g.xs.map((p) => {
                          const precio = p.effectivePriceCents ?? p.priceCents;
                          const conInscripcion = p.billingModel !== 'DAY_PASS' && p.billingModel !== 'VISIT_PACK' && BigInt(p.signupFeeCents) > 0n;
                          return (
                            <tr key={p.id} data-plan={p.code}>
                              <td data-label="Plan">
                                <span className="strong">{p.name}</span>
                                <div className="tiny muted">{p.billingModel === 'DAY_PASS' ? 'Pase del día' : duracion(p)}</div>
                              </td>
                              <td className="right" data-label="Precio">
                                <span className="num strong precios-precio">{pesos(precio, { decimals: false })}</span>
                                {porPeriodo(p) && <span className="small muted"> {porPeriodo(p)}</span>}
                              </td>
                              <td className="right num" data-label="Inscripción">{conInscripcion ? pesos(p.signupFeeCents, { decimals: false }) : <span className="muted">Sin inscripción</span>}</td>
                              <td className="small" data-label="Incluye">{incluye(p, activoEn('classes', sede.id))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}
              <p className="small muted">Los precios son los de {sede.name}. Un descuento se aplica al vender, con su motivo.</p>
            </div>
          )}
        </EstadoCarga>
      )}
    </div>
  );
}
