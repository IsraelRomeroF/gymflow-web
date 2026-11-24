'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Repeat, Ticket, CalendarDays, CalendarRange, Users, Building2, Snowflake, EyeOff, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@/lib/format';
import { ACCESO, MODELO, duracion, porPeriodo, type Plan } from '@/lib/plans';
import { useSession, errorText } from '@/components/session';
import { Badge, Button, ButtonLink, Callout, Card, Empty, PageHeader, Skeleton, ErrorCarga } from '@/components/ui';
import { Exportar } from '@/components/exportar';
import { PlanDialog, type DetalleDePlan } from './plan-dialog';
import { ProtegidosDialog } from './protegidos-dialog';

const ICONO: Record<Plan['billingModel'], React.ReactNode> = {
  RECURRING: <Repeat />, PREPAID_PERIOD: <CalendarRange />, VISIT_PACK: <Ticket />, DAY_PASS: <CalendarDays />,
};

/**
 * PLANES: donde la gerencia arma lo que se vende (bajo la llave del dueño).
 * Quien solo necesita saber cuánto cuesta algo tiene la Lista de precios
 * (`/precios`, 16-02). Cambiar un precio no toca lo ya cobrado, pero le
 * cambia a todos los que tienen el plan en su siguiente pago (D-19, bloque
 * 3.6), salvo a quienes «conservan su precio»; el formulario dice a quién
 * toca cada cambio ANTES de guardar (16-04).
 */
export default function PlanesPage() {
  const { canOrg, branchName, activo } = useSession();
  const [planes, setPlanes] = useState<Array<Plan & DetalleDePlan> | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [editar, setEditar] = useState<(Plan & DetalleDePlan) | 'nuevo' | null>(null);
  const [protegidos, setProtegidos] = useState<Plan | null>(null);
  // Un plan vale para todo el gimnasio: lo maneja quien tiene alcance organizacional (SEC2-04).
  const gestiona = canOrg('catalog:manage');

  // Una sola petición con disponibilidad y socios de cada plan (OPT2-01).
  const cargar = useCallback(async () => { setPlanes(await api<Array<Plan & DetalleDePlan>>('/plans?includeInactive=true&include=details')); }, []);

  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(() => { void cargar().catch((e) => { setFallo(errorText(e, 'No se pudieron cargar los planes')); setPlanes([]); }); }, [cargar]);

  const visibles = (planes ?? []).filter((p) => verInactivos || p.isActive);
  const grupos = (['RECURRING', 'PREPAID_PERIOD', 'VISIT_PACK', 'DAY_PASS'] as const)
    .map((m) => ({ m, xs: visibles.filter((p) => p.billingModel === m) }))
    .filter((g) => g.xs.length > 0);
  const inactivos = (planes ?? []).filter((p) => !p.isActive).length;

  return (
    <>
      <PageHeader
        title="Planes"
        sub="Lo que se vende en el mostrador y a qué precio. Cada cambio queda en la bitácora con su motivo."
        actions={<>
          {/* Sin planes no hay qué exportar ni dos "Nuevo plan": el aviso de abajo trae el suyo. */}
          {planes && planes.length > 0 && <Exportar nombre="planes" size="md" filas={() => [['Código', 'Nombre', 'Modelo', 'Duración', 'Precio', 'Inscripción', 'IVA (pb)', 'Activo'],
            ...(planes ?? []).map((p) => [p.code, p.name, MODELO[p.billingModel]?.label ?? p.billingModel, duracion(p), (Number(BigInt(p.priceCents)) / 100).toFixed(2), (Number(BigInt(p.signupFeeCents)) / 100).toFixed(2), p.taxRateBps ?? '', p.isActive ? 'Sí' : 'No'])]} />}
          {inactivos > 0 && (
            <Button variant="ghost" icon={verInactivos ? <EyeOff /> : <Eye />} onClick={() => setVerInactivos(!verInactivos)}>
              {verInactivos ? 'Ocultar' : 'Ver'} desactivados ({inactivos})
            </Button>
          )}
          {gestiona && visibles.length > 0 && <Button icon={<Plus />} onClick={() => setEditar('nuevo')}>Nuevo plan</Button>}
        </>}
      />

      {!gestiona && (
        <div className="mb-16">
          <Callout tone="info">
            Puedes consultar el catálogo. Crear planes y cambiar precios lo hace la gerencia de toda la organización.
            <div className="callout-accion"><ButtonLink href="/precios" size="sm" variant="secondary">Ver la lista de precios</ButtonLink></div>
          </Callout>
        </div>
      )}

      {fallo ? <ErrorCarga mensaje={fallo} onReintentar={() => { setFallo(null); setPlanes(null); void cargar().catch((e) => setFallo(errorText(e, 'No se pudieron cargar los planes'))); }} /> : planes === null ? (
        <div className="grid grid-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={210} r={16} />)}</div>
      ) : visibles.length === 0 ? (
        <Card><Empty icon={<Ticket />} title="Todavía no hay planes" text="Crea el primero: sin planes no se puede vender ninguna membresía."
          action={gestiona && <Button icon={<Plus />} onClick={() => setEditar('nuevo')}>Nuevo plan</Button>} /></Card>
      ) : grupos.map((g) => (
        <section key={g.m} className="mb-28" aria-label={MODELO[g.m].label}>
          <h2 className="plan-grupo">{MODELO[g.m].label} <span className="plan-grupo-nota">· {MODELO[g.m].hint}</span></h2>
          <div className="grid grid-3">
            {g.xs.map((p) => {
              const enVenta = p.availability.filter((a) => a.isAvailable);
              // El precio propio de una sede, a la vista (16-03): se cobra ahí aunque la tarjeta diga otro.
              const propios = enVenta.filter((a) => a.priceOverrideCents !== null && a.priceOverrideCents !== p.priceCents);
              const reglas = [
                p.includesClasses && activo('classes') ? (p.includedClassTypeIds?.length ? `Incluye ${p.includedClassTypeIds.length} ${p.includedClassTypeIds.length === 1 ? 'clase' : 'clases'}` : 'Incluye todas las clases') : null,
                // Congelar solo es de las membresías por tiempo: en un paquete o una visita no aplica y no se dice.
                p.billingModel === 'RECURRING' || p.billingModel === 'PREPAID_PERIOD' ? (p.allowFreeze ? `Congela hasta ${p.maxFreezeDaysPerYear} días` : 'Sin congelamiento') : null,
                p.billingModel === 'VISIT_PACK' && !p.visitValidityDays ? 'No caduca' : null,
              ].filter((x): x is string => !!x);
              const tienen = [
                p.billingModel !== 'VISIT_PACK' || p.liveMemberships > 0 ? `${p.liveMemberships} ${p.liveMemberships === 1 ? 'socio' : 'socios'}` : null,
                p.livePacks > 0 || p.billingModel === 'VISIT_PACK' ? `${p.livePacks} ${p.livePacks === 1 ? 'paquete vivo' : 'paquetes vivos'}` : null,
              ].filter(Boolean).join(' · ');
              return (
                <Card key={p.id} pad={false} className={p.isActive ? undefined : 'is-muted'}>
                  <div className="card-body stack-sm plan-tarjeta">
                    <div className="row-between">
                      <span className="choice-icon">{ICONO[p.billingModel]}</span>
                      {/* Todo lo visible está a la venta: la insignia solo avisa de lo que no. */}
                      {!p.isActive && <Badge>Desactivado</Badge>}
                    </div>
                    <div className="mt-6">
                      <p className="strong plan-nombre">{p.name}</p>
                      <p className="tiny muted"><code>{p.code}</code> · {p.billingModel === 'DAY_PASS' ? 'vale el día que se compra' : duracion(p)}</p>
                    </div>
                    <p className="mt-4">
                      <span className="num plan-precio">{pesos(p.priceCents, { decimals: false })}</span>
                      <span className="small muted"> {porPeriodo(p)}</span>
                    </p>
                    <div className="stack-sm tiny muted gap-4">
                      {propios.map((a) => <span key={a.branchId} className="plan-precio-sede">{branchName(a.branchId)} {pesos(a.priceOverrideCents!, { decimals: false })}</span>)}
                      {BigInt(p.signupFeeCents) > 0n && p.billingModel !== 'DAY_PASS' && <span>+ inscripción {pesos(p.signupFeeCents, { decimals: false })}</span>}
                      <span className="row gap-6"><Building2 size={13} />{p.billingModel === 'DAY_PASS' ? 'En la sucursal donde se compra' : ACCESO[p.branchAccessScope]}</span>
                      {reglas.length > 0 && <span className="row gap-6">{p.allowFreeze && (p.billingModel === 'RECURRING' || p.billingModel === 'PREPAID_PERIOD') ? <Snowflake size={13} /> : <CalendarDays size={13} />}{reglas.join(' · ')}</span>}
                    </div>
                  </div>
                  <div className="card-foot row-between gap-8">
                    <span className="tiny muted min-w-0">
                      <span className="row gap-6"><Users size={13} />{tienen}</span>
                      {/* Quiénes no cambian solos al cambiar el precio (D-19): se ve y se administra desde aquí. */}
                      {gestiona && p.liveMemberships > 0 && (
                        <button type="button" className="row-link plan-conservan" onClick={() => setProtegidos(p)}>
                          {(p.protectedPrices ?? 0) === 0 ? 'Nadie conserva su precio' : `${p.protectedPrices} ${p.protectedPrices === 1 ? 'conserva' : 'conservan'} su precio`}
                        </button>
                      )}
                      <span className="ellipsis block">{enVenta.length ? enVenta.map((a) => branchName(a.branchId)).join(' · ') : 'No se vende en ninguna sede'}</span>
                    </span>
                    {gestiona && <Button variant="secondary" size="sm" icon={<Pencil />} onClick={() => setEditar(p)}>Editar</Button>}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      {protegidos && <ProtegidosDialog plan={protegidos} onClose={() => setProtegidos(null)} onCambio={() => void cargar()} />}
      {editar && (
        <PlanDialog
          plan={editar === 'nuevo' ? null : editar}
          onClose={() => setEditar(null)}
          onDone={async () => { setEditar(null); await cargar(); }}
        />
      )}
    </>
  );
}
