'use client';

import { useCallback, useMemo, useState } from 'react';
import type { PlanImpact } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { pesos } from '@/lib/format';
import { MODELO, type Plan } from '@/lib/plans';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Callout, CampoMotivo, Dialog, ErrorCarga, Field, Segmented, Switch, VistaPrevia, type CifraPrevia } from '@/components/ui';
import { useCarga, type Carga } from '@/lib/carga';
import { parsePesos } from '@/lib/pesos';

export type DetalleDePlan = {
  availability: Array<{ branchId: string; isAvailable: boolean; priceOverrideCents: string | null }>;
  liveMemberships: number;
  livePacks: number;
};

type Form = {
  code: string; name: string; billingModel: Plan['billingModel'];
  durationUnit: Plan['durationUnit']; durationValue: string;
  precio: string; inscripcion: string;
  visitsIncluded: string; visitValidityDays: string;
  branchAccessScope: Plan['branchAccessScope']; includesClasses: boolean;
  /** Vacío = todas las que se pueden incluir en un plan. */
  includedClassTypeIds: string[]; soloAlgunas: boolean;
  defaultGraceDays: string; allowFreeze: boolean; minFreezeDays: string; maxFreezeDaysPerYear: string;
  autoRenewDefault: boolean; isActive: boolean; branchIds: string[]; reason: string;
};

const aPesos = (c: string) => (Number(BigInt(c)) / 100).toString();
const aCentavos = (s: string): string | null => { const c = parsePesos(s); return c !== null ? c.toString() : null; };
const socios = (n: number) => `${n.toLocaleString('es-MX')} ${n === 1 ? 'socio' : 'socios'}`;
const paquetes = (n: number) => `${n.toLocaleString('es-MX')} ${n === 1 ? 'paquete vivo' : 'paquetes vivos'}`;
const frase = (xs: readonly string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(xs);

/** Al cambiar el tipo, la unidad se ajusta sola: un paquete se mide en visitas. */
function unidadPara(m: Plan['billingModel'], actual: Plan['durationUnit']): Plan['durationUnit'] {
  if (m === 'VISIT_PACK') return 'VISIT';
  if (m === 'DAY_PASS') return 'DAY';
  return actual === 'VISIT' || actual === 'DAY' ? 'MONTH' : actual;
}

const MOTIVOS_NUEVO = ['Plan nuevo', 'Plan de temporada', 'Abrimos sucursal'];
const MOTIVOS_EDITAR = ['Ajuste de precio', 'Corrección de datos', 'Ya no se vende'];

/**
 * «Nuevo plan» y «Editar …» en tres bloques, siempre en el mismo orden: qué
 * vendes, cuánto cuesta y sus reglas. Antes de guardar dice a quién toca el
 * cambio (16-04): al mover el precio, al dejar de venderlo en una sucursal y
 * al desactivarlo. La visita suelta se vende como pase del día: sin
 * inscripción, gracia ni duración (16-08, 16-11).
 */
export function PlanDialog({ plan, onClose, onDone }: { plan: (Plan & DetalleDePlan) | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { branches, activo, branchName } = useSession();
  const toast = useToast();
  const sedes = branches.filter((b) => b.isActive);
  const enVentaAntes = useMemo(() => (plan ? plan.availability.filter((a) => a.isAvailable).map((a) => a.branchId) : []), [plan]);
  const [f, setF] = useState<Form>(() => plan ? {
    code: plan.code, name: plan.name, billingModel: plan.billingModel,
    durationUnit: plan.durationUnit, durationValue: String(plan.durationValue),
    precio: aPesos(plan.priceCents), inscripcion: aPesos(plan.signupFeeCents),
    visitsIncluded: plan.visitsIncluded?.toString() ?? '', visitValidityDays: plan.visitValidityDays?.toString() ?? '',
    branchAccessScope: plan.branchAccessScope, includesClasses: plan.includesClasses,
    includedClassTypeIds: plan.includedClassTypeIds ?? [], soloAlgunas: (plan.includedClassTypeIds ?? []).length > 0,
    defaultGraceDays: String(plan.defaultGraceDays), allowFreeze: plan.allowFreeze,
    minFreezeDays: String(plan.minFreezeDays), maxFreezeDaysPerYear: String(plan.maxFreezeDaysPerYear),
    autoRenewDefault: plan.autoRenewDefault, isActive: plan.isActive,
    branchIds: enVentaAntes, reason: '',
  } : {
    code: '', name: '', billingModel: 'RECURRING', durationUnit: 'MONTH', durationValue: '1',
    precio: '', inscripcion: '0', visitsIncluded: '', visitValidityDays: '',
    branchAccessScope: 'HOME_BRANCH', includesClasses: false, includedClassTypeIds: [], soloAlgunas: false, defaultGraceDays: '5',
    allowFreeze: true, minFreezeDays: '7', maxFreezeDaysPerYear: '30', autoRenewDefault: true, isActive: true,
    branchIds: sedes.map((b) => b.id), reason: '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // Clases que se pueden incluir en un plan (2026-10-09). Sin red no es «No hay clases que se puedan incluir» (26-01).
  const cargarClases = useCallback(() => api<{ types: Array<{ id: string; name: string; isActive: boolean; includableInPlans: boolean }> }>('/classes/types')
    .then((r) => r.types.filter((t) => t.isActive && t.includableInPlans)), []);
  const clasesCarga = useCarga(activo('classes') ? cargarClases : null);
  const clases = clasesCarga.datos ?? null;

  // A quién toca el cambio (16-04): se pide al abrir un plan que ya existe.
  const planId = plan?.id ?? null;
  const cargarImpacto = useCallback(() => api<PlanImpact>(`/plans/${planId}/impact`), [planId]);
  const impactoDe = useCarga(planId ? cargarImpacto : null);

  const esPaquete = f.billingModel === 'VISIT_PACK';
  const esVisita = f.billingModel === 'DAY_PASS';
  const porTiempo = !esPaquete && !esVisita;
  const precioNuevo = aCentavos(f.precio);
  const cambiaPrecio = !!plan && precioNuevo !== null && precioNuevo !== plan.priceCents;
  const sedesApagadas = plan ? enVentaAntes.filter((id) => !f.branchIds.includes(id)) : [];
  const seDesactiva = !!plan && plan.isActive && !f.isActive;
  const hayCambioConImpacto = cambiaPrecio || sedesApagadas.length > 0 || seDesactiva;

  const payload = useMemo(() => ({
    ...(plan ? {} : { code: f.code }),
    name: f.name.trim(),
    billingModel: f.billingModel,
    durationUnit: f.durationUnit,
    durationValue: esPaquete ? Number(f.visitsIncluded || 0) : esVisita ? 1 : Number(f.durationValue),
    priceCents: aCentavos(f.precio) ?? 'x',
    signupFeeCents: porTiempo ? aCentavos(f.inscripcion || '0') ?? 'x' : '0',
    visitsIncluded: esPaquete ? Number(f.visitsIncluded || 0) : null,
    visitValidityDays: esPaquete && f.visitValidityDays ? Number(f.visitValidityDays) : null,
    branchAccessScope: f.branchAccessScope,
    includesClasses: f.includesClasses,
    includedClassTypeIds: f.includesClasses && f.soloAlgunas ? f.includedClassTypeIds : [],
    defaultGraceDays: esVisita ? 0 : Number(f.defaultGraceDays),
    allowFreeze: porTiempo && f.allowFreeze,
    minFreezeDays: Number(f.minFreezeDays),
    maxFreezeDaysPerYear: Number(f.maxFreezeDaysPerYear),
    autoRenewDefault: f.billingModel === 'RECURRING' && f.autoRenewDefault,
    isActive: f.isActive,
    branchIds: f.branchIds,
    reason: f.reason.trim(),
  }), [f, plan, esPaquete, esVisita, porTiempo]);

  async function guardar() {
    const locales: Record<string, string> = {};
    if (!plan && !f.code.trim()) locales.code = 'Pon un código corto, por ejemplo MEN';
    if (aCentavos(f.precio) === null) locales.priceCents = 'Escribe el precio en pesos, por ejemplo 650 o 650.50';
    if (porTiempo && aCentavos(f.inscripcion || '0') === null) locales.signupFeeCents = 'Importe inválido';
    if (f.branchIds.length === 0) locales.branchIds = 'Elige al menos una sucursal';
    if (f.includesClasses && f.soloAlgunas && f.includedClassTypeIds.length === 0) locales.includedClassTypeIds = 'Elige al menos una clase, o «Todas las clases»';
    if (f.reason.trim().length < 3) locales.reason = 'Escribe por qué (queda en la bitácora)';
    setErrores(locales);
    setFallo(null);
    if (Object.keys(locales).length > 0) return;

    setEnviando(true);
    try {
      await api(plan ? `/plans/${plan.id}` : '/plans', { method: plan ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      toast('ok', plan ? 'Plan actualizado.' : 'Plan creado. Ya aparece a la venta en las sucursales elegidas.');
      await onDone();
    } catch (e) {
      // Los errores del dominio traen el campo: se marcan en el formulario.
      if (e instanceof ApiError && e.status === 422) {
        try {
          const lista = JSON.parse(e.detail ?? '[]') as Array<{ field: string; message: string }>;
          if (lista.length) { setErrores(Object.fromEntries(lista.map((i) => [i.field, i.message]))); return; }
        } catch { /* sin detalle: se muestra el mensaje */ }
      }
      setFallo(errorText(e, 'No se pudo guardar'));
    } finally {
      setEnviando(false);
    }
  }

  const err = (k: string) => errores[k] ? <span className="hint text-danger">{errores[k]}</span> : null;

  return (
    <Dialog open size="lg" onClose={onClose} error={fallo}
      title={plan ? `Editar ${plan.name}` : 'Nuevo plan'}
      sub={plan ? <>Código <code>{plan.code}</code> · no se puede cambiar</> : 'Queda a la venta en cuanto lo guardes.'}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button loading={enviando} onClick={() => void guardar()}>{plan ? 'Guardar cambios' : 'Crear plan'}</Button></>}>
      <div className="stack">
        <section className="dialog-seccion" aria-label="Qué vendes">
          <p className="eyebrow">Qué vendes</p>
          <div>
            <p className="label mb-8">Tipo</p>
            <Segmented desplazable etiqueta="Tipo de plan" value={f.billingModel} onChange={(m) => setF((x) => ({ ...x, billingModel: m, durationUnit: unidadPara(m, x.durationUnit) }))}
              options={(Object.keys(MODELO) as Array<Plan['billingModel']>).map((m) => ({ value: m, label: MODELO[m].label }))} />
            <p className="hint mt-6">{esVisita ? 'Se vende como pase del día: vale el día que se compra, en la sucursal donde se compra, y se cobra en el momento.' : MODELO[f.billingModel].hint}</p>
          </div>
          <div className={plan ? undefined : 'plan-nombre-codigo'}>
            <Field label="Nombre" htmlFor="nom"><input id="nom" className="input" value={f.name} placeholder="Mensualidad" onChange={(e) => set('name', e.target.value)} />{err('name')}</Field>
            {!plan && <Field label="Código" htmlFor="cod" hint="Corto y único"><input id="cod" className="input mono" value={f.code} placeholder="MEN" maxLength={20}
              onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} />{err('code')}</Field>}
          </div>
        </section>

        <section className="dialog-seccion" aria-label="Cuánto cuesta">
          <p className="eyebrow">Cuánto cuesta</p>
          <div className="grid grid-3 gap-12">
            <Field label={esPaquete ? 'Precio del paquete' : esVisita ? 'Precio de la visita' : 'Precio por periodo'} htmlFor="pre">
              <input id="pre" className="input num" inputMode="decimal" placeholder="650" value={f.precio} onChange={(e) => set('precio', e.target.value)} />{err('priceCents')}
            </Field>
            {esPaquete && (
              <>
                <Field label="Visitas" htmlFor="vis"><input id="vis" className="input num" inputMode="numeric" value={f.visitsIncluded} placeholder="10" onChange={(e) => set('visitsIncluded', e.target.value)} />{err('visitsIncluded')}</Field>
                <Field label="Vigencia (días)" htmlFor="vig" hint={f.visitValidityDays.trim() ? 'Desde el día que se compra' : undefined}>
                  <input id="vig" className="input num" inputMode="numeric" value={f.visitValidityDays} placeholder="90" onChange={(e) => set('visitValidityDays', e.target.value)} />{err('visitValidityDays')}
                </Field>
              </>
            )}
            {porTiempo && (
              <>
                <Field label="Duración" htmlFor="dur">
                  <div className="row gap-6">
                    <input id="dur" className="input num plan-duracion" inputMode="numeric" value={f.durationValue} onChange={(e) => set('durationValue', e.target.value)} />
                    <select className="select" aria-label="Unidad de la duración" value={f.durationUnit} onChange={(e) => set('durationUnit', e.target.value as Plan['durationUnit'])}>
                      <option value="DAY">días</option><option value="WEEK">semanas</option><option value="MONTH">meses</option>
                    </select>
                  </div>{err('durationValue')}{err('durationUnit')}
                </Field>
                <Field label="Inscripción" htmlFor="ins" hint="Se cobra una vez, al vender">
                  <input id="ins" className="input num" inputMode="decimal" value={f.inscripcion} onChange={(e) => set('inscripcion', e.target.value)} />{err('signupFeeCents')}
                </Field>
              </>
            )}
          </div>
          {/* Sin vigencia el paquete se vende sin fecha de caducidad: se dice antes de guardar (16-11). */}
          {esPaquete && !f.visitValidityDays.trim() && <Callout tone="warn">Sin vigencia, el paquete no caduca nunca: quien lo compre conserva sus visitas hasta usarlas.</Callout>}
          {esVisita && <p className="hint">Una visita suelta no lleva inscripción, días de gracia ni duración: es un pase para el día en que se compra.</p>}

          <div>
            <p className="label mb-8" id="plan-sedes">Se vende en</p>
            <div className="row wrap gap-8" role="group" aria-labelledby="plan-sedes">
              {sedes.map((b) => {
                const propio = plan?.availability.find((a) => a.branchId === b.id)?.priceOverrideCents ?? null;
                return (
                  <span key={b.id} className="plan-sede">
                    <Switch checked={f.branchIds.includes(b.id)} onChange={(v) => set('branchIds', v ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id))}>{b.name}</Switch>
                    {/* El precio propio de la sede se ve; todavía no se edita desde aquí (16-03, fase 3). */}
                    {propio !== null && plan && propio !== plan.priceCents && <span className="tiny muted">ahí cuesta {pesos(propio, { decimals: false })}</span>}
                  </span>
                );
              })}
            </div>
            {err('branchIds')}
          </div>
        </section>

        <section className="dialog-seccion" aria-label="Reglas">
          <p className="eyebrow">Reglas</p>
          {!esVisita && (
            <div className="grid grid-2 gap-12">
              <Field label="Acceso" htmlFor="acc">
                <select id="acc" className="select" value={f.branchAccessScope} onChange={(e) => set('branchAccessScope', e.target.value as Plan['branchAccessScope'])}>
                  <option value="HOME_BRANCH">Solo su sucursal</option>
                  <option value="ALL_BRANCHES">Todas las sucursales</option>
                </select>
              </Field>
              {porTiempo && (
                <Field label="Días de gracia" htmlFor="gra" hint="Tras vencer, sigue entrando estos días">
                  <input id="gra" className="input num" inputMode="numeric" value={f.defaultGraceDays} onChange={(e) => set('defaultGraceDays', e.target.value)} />{err('defaultGraceDays')}
                </Field>
              )}
            </div>
          )}

          <div className="stack-sm">
            {activo('classes') && <Switch checked={f.includesClasses} onChange={(v) => set('includesClasses', v)}>Incluye clases con cupo sin costo extra</Switch>}
            {activo('classes') && f.includesClasses && (
              <div className="plan-clases" data-testid="plan-clases">
                <Segmented value={f.soloAlgunas ? 'algunas' : 'todas'} onChange={(v) => set('soloAlgunas', v === 'algunas')}
                  options={[{ value: 'todas', label: 'Todas las clases' }, { value: 'algunas', label: 'Solo algunas' }]} />
                {f.soloAlgunas ? (
                  clasesCarga.error ? <div className="mt-8"><ErrorCarga titulo="No se pudieron cargar las clases" mensaje={clasesCarga.error} onReintentar={() => void clasesCarga.recargar()} /></div>
                  : clases === null ? <p className="hint">…</p> : clases.length === 0 ? <p className="hint">No hay clases que se puedan incluir en un plan. Márcalas así en Clases → Editar.</p> : (
                    <div className="row gap-6 flex-wrap mt-8">
                      {clases.map((c) => {
                        const on = f.includedClassTypeIds.includes(c.id);
                        return <button key={c.id} type="button" className="chip" aria-pressed={on} onClick={() => set('includedClassTypeIds', on ? f.includedClassTypeIds.filter((x) => x !== c.id) : [...f.includedClassTypeIds, c.id])}>{on ? '✓ ' : ''}{c.name}</button>;
                      })}
                    </div>
                  )
                ) : null}
                <p className="hint mt-8">{f.soloAlgunas
                  ? (f.includedClassTypeIds.length === 0 ? 'Elige al menos una clase.' : 'Las demás se pagan como clase suelta.')
                  : 'Incluye todas las clases que se pueden incluir en un plan; las marcadas «solo se paga suelta» se cobran aparte.'}</p>
                {err('includedClassTypeIds')}
              </div>
            )}
            {f.billingModel === 'RECURRING' && <Switch checked={f.autoRenewDefault} onChange={(v) => set('autoRenewDefault', v)}>Se renueva sola por defecto</Switch>}
            {porTiempo && <Switch checked={f.allowFreeze} onChange={(v) => set('allowFreeze', v)}>Permite congelar</Switch>}
          </div>
          {f.allowFreeze && porTiempo && (
            <div className="grid grid-2 gap-12">
              <Field label="Mínimo por solicitud (días)" htmlFor="fmin"><input id="fmin" className="input num" inputMode="numeric" value={f.minFreezeDays} onChange={(e) => set('minFreezeDays', e.target.value)} /></Field>
              <Field label="Máximo al año (días)" htmlFor="fmax"><input id="fmax" className="input num" inputMode="numeric" value={f.maxFreezeDaysPerYear} onChange={(e) => set('maxFreezeDaysPerYear', e.target.value)} />{err('maxFreezeDaysPerYear')}</Field>
            </div>
          )}
          {plan && (
            <Switch checked={f.isActive} onChange={(v) => set('isActive', v)}><strong>A la venta.</strong> Desactivarlo deja de ofrecerlo; quien ya lo tiene lo conserva.</Switch>
          )}
        </section>

        {plan && hayCambioConImpacto && impactoDe && (
          <Impacto plan={plan} carga={impactoDe} precioNuevo={cambiaPrecio ? precioNuevo : null} sedesApagadas={sedesApagadas} seDesactiva={seDesactiva} nombreSede={branchName} />
        )}

        <CampoMotivo id="mot" value={f.reason} onChange={(v) => set('reason', v)} error={errores.reason ?? null}
          motivos={plan ? MOTIVOS_EDITAR : MOTIVOS_NUEVO} placeholder={plan ? 'Ajuste de precio 2027' : 'Nuevo plan de temporada'} />
      </div>
    </Dialog>
  );
}

/**
 * A QUIÉN TOCA EL CAMBIO (16-04), con la regla de hoy: cada socio renueva a su
 * precio pactado; el de lista vale para las ventas nuevas y para quien no
 * tiene pactado. Dejar de vender en una sucursal o desactivar el plan no le
 * quita nada a quien ya lo compró.
 */
function Impacto({ plan, carga, precioNuevo, sedesApagadas, seDesactiva, nombreSede }: {
  plan: Plan & DetalleDePlan; carga: Carga<PlanImpact>;
  precioNuevo: string | null; sedesApagadas: readonly string[]; seDesactiva: boolean; nombreSede: (id: string | null | undefined) => string;
}) {
  const i = carga.datos;
  if (!i) return <div data-testid="plan-impacto"><VistaPrevia cargando={carga.cargando} error={carga.error} onReintentar={() => void carga.recargar()} /></div>;

  const avisos: React.ReactNode[] = [];
  const cifras: CifraPrevia[] = [];
  const total = i.liveMemberships;

  if (precioNuevo !== null) {
    const sube = BigInt(precioNuevo) > BigInt(plan.priceCents);
    cifras.push({ etiqueta: 'Precio de lista', valor: `${pesos(plan.priceCents, { decimals: false })} → ${pesos(precioNuevo, { decimals: false })}`, nota: 'Para las ventas nuevas, desde que guardes' });
    if (total > 0) {
      cifras.push({ etiqueta: 'Siguen pagando lo que pactaron', valor: i.withAgreedPrice.toLocaleString('es-MX'), nota: 'Cada venta guarda su precio y renueva con él' });
      if (i.withoutAgreedPrice > 0) {
        cifras.push({ etiqueta: `Pagan el precio nuevo en su siguiente cuota`, valor: i.withoutAgreedPrice.toLocaleString('es-MX'), nota: 'No tienen precio pactado', tono: sube ? 'warn' : undefined });
      }
    }
    const propias = i.branches.filter((b) => b.hasOwnPrice && b.isOpen);
    if (propias.length > 0) avisos.push(`${frase(propias.map((b) => `${b.name} (${pesos(b.listPriceCents, { decimals: false })})`))} ${propias.length === 1 ? 'tiene su precio propio y no cambia' : 'tienen su precio propio y no cambian'} con este.`);
    if (i.livePacks > 0) avisos.push(`${paquetes(i.livePacks)} ya ${i.livePacks === 1 ? 'está pagado' : 'están pagados'}: no ${i.livePacks === 1 ? 'cambia' : 'cambian'}.`);
  }

  for (const id of sedesApagadas) {
    const b = i.branches.find((x) => x.branchId === id);
    const hay = [b && b.liveMemberships > 0 ? socios(b.liveMemberships) : null, b && b.livePacks > 0 ? paquetes(b.livePacks) : null].filter((x): x is string => !!x);
    avisos.push(hay.length > 0
      ? <>En <strong>{nombreSede(id)}</strong> hay {frase(hay)} con este plan vendido ahí: lo conservan y siguen renovando a su precio. Solo deja de venderse a socios nuevos en esa sucursal.</>
      : <>En <strong>{nombreSede(id)}</strong> nadie lo tiene: solo deja de venderse ahí.</>);
  }

  if (seDesactiva) {
    const hay = [total > 0 ? socios(total) : null, i.livePacks > 0 ? paquetes(i.livePacks) : null].filter((x): x is string => !!x);
    avisos.push(hay.length > 0
      ? `Al desactivarlo deja de ofrecerse en todas las sucursales. ${frase(hay)} lo ${total + i.livePacks === 1 ? 'conserva' : 'conservan'}: quien tiene membresía sigue renovando a su precio hasta que cambie de plan o se dé de baja.`
      : 'Al desactivarlo deja de ofrecerse en todas las sucursales. Nadie lo tiene hoy.');
  }

  const titulo = total > 0 ? `${socios(total)} ${total === 1 ? 'tiene' : 'tienen'} este plan` : i.livePacks > 0 ? `${paquetes(i.livePacks)} de este plan` : 'Nadie tiene este plan todavía';
  return (
    <div data-testid="plan-impacto" className="stack-sm">
      <p className="label">{titulo}</p>
      <VistaPrevia titulo="Lo que cambia y lo que no" cifras={cifras} avisos={avisos} />
      {precioNuevo !== null && total > 0 && <p className="hint">Lo ya cobrado no cambia. Subirle el precio a todos en su siguiente pago todavía no se hace desde aquí.</p>}
    </div>
  );
}
