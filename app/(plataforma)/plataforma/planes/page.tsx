'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Package, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { parsePesos } from '@/lib/pesos';
import { pesos } from '@/lib/format';
import { useToast, errorText } from '@/components/session';
import { Badge, Breadcrumb, Button, Callout, Card, Dialog, Empty, ErrorCarga, Field, PageHeader, EsqueletoTabla, Switch } from '@/components/ui';
import { usePlataforma, type PlanPlataforma } from '../../layout';

/**
 * PLANES DE LA PLATAFORMA (ADR-039): los paquetes de módulos que GymFlow
 * vende. Un gimnasio contrata un plan y, encima, módulos sueltos. Los define
 * quien opera la plataforma: aquí no hay planes ni precios inventados.
 */
export default function PlanesPage() {
  const { modules } = usePlataforma();
  const [planes, setPlanes] = useState<PlanPlataforma[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [editar, setEditar] = useState<PlanPlataforma | 'nuevo' | null>(null);
  const cargar = useCallback(() => { setFallo(false); api<{ plans: PlanPlataforma[] }>('/platform/plans').then((r) => setPlanes(r.plans)).catch(() => setFallo(true)); }, []);
  useEffect(cargar, [cargar]);
  const nombre = (k: string) => modules.find((m) => m.key === k)?.name ?? k;

  return (
    <>
      <Breadcrumb items={[{ label: 'Marcas', href: '/plataforma' }, { label: 'Planes' }]} />
      <PageHeader title="Planes" sub="Lo que GymFlow vende como paquete: qué módulos incluye cada plan y cuánto cuesta al mes. Un gimnasio contrata un plan y, encima, módulos sueltos como agregados."
        actions={<Button icon={<Plus />} onClick={() => setEditar('nuevo')}>Nuevo plan</Button>} />
      {fallo && <ErrorCarga mensaje="No se pudieron cargar los planes." onReintentar={cargar} />}
      {!planes && !fallo && <div className="card"><EsqueletoTabla filas={3} columnas={5} /></div>}
      {planes && planes.length === 0 && <Card><Empty icon={<Package />} title="Todavía no hay planes" text="Define el primero: un nombre, los módulos que incluye y su precio mensual. Sin planes, cada marca se contrata módulo por módulo." action={<Button onClick={() => setEditar('nuevo')}>Nuevo plan</Button>} /></Card>}
      {planes && planes.length > 0 && (
        <Card pad={false} data-testid="planes">
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Plan</th><th>Incluye</th><th className="right">Al mes</th><th className="right">Marcas</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {planes.map((p) => (
                  <tr key={p.id} data-plan={p.name}>
                    <td data-label="Plan"><span className="strong">{p.name}</span>{p.description && <div className="tiny muted">{p.description}</div>}</td>
                    <td data-label="Incluye" className="small">Lo básico{p.modules.length > 0 ? ` + ${p.modules.map(nombre).join(', ')}` : ''}</td>
                    <td data-label="Al mes" className="right num">{p.monthlyCents === null ? <span className="muted">Sin precio</span> : pesos(p.monthlyCents)}</td>
                    <td data-label="Marcas" className="right num">{p.organizations ?? 0}</td>
                    <td data-label="Estado">{p.isActive ? <Badge tone="ok" dot>Se ofrece</Badge> : <Badge tone="neutral" dot>Retirado</Badge>}</td>
                    <td className="right"><Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditar(p)}>Editar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Callout tone="info">Un plan sin precio se factura módulo por módulo con los <Link href="/plataforma/precios">precios</Link> sueltos. Un plan retirado no se asigna a marcas nuevas, pero las que lo tienen lo conservan.</Callout>
      {editar && <PlanDialog plan={editar === 'nuevo' ? null : editar} onClose={() => setEditar(null)} onHecho={() => { setEditar(null); cargar(); }} />}
    </>
  );
}

function PlanDialog({ plan, onClose, onHecho }: { plan: PlanPlataforma | null; onClose: () => void; onHecho: () => void }) {
  const { modules } = usePlataforma();
  const toast = useToast();
  const opcionales = modules.filter((m) => m.kind === 'optional');
  const [f, setF] = useState({ name: plan?.name ?? '', description: plan?.description ?? '', precio: plan?.monthlyCents ? (Number(plan.monthlyCents) / 100).toFixed(2) : '', isActive: plan?.isActive ?? true });
  const [incluidos, setIncluidos] = useState<Set<string>>(() => new Set(plan?.modules ?? []));
  const [enviando, setEnviando] = useState(false);
  const aCentavos = (texto: string): string | null | undefined => {
    if (texto.trim() === '') return null;
    const c = parsePesos(texto);
    return c !== null ? c.toString() : undefined;
  };
  const centavos = aCentavos(f.precio);
  const listo = f.name.trim().length >= 2 && centavos !== undefined;

  async function guardar() {
    setEnviando(true);
    try {
      const cuerpo = { name: f.name.trim(), description: f.description.trim() || null, modules: [...incluidos], monthlyCents: centavos ?? null, ...(plan ? { isActive: f.isActive } : {}) };
      if (plan) await api(`/platform/plans/${plan.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
      else await api('/platform/plans', { method: 'POST', body: JSON.stringify(cuerpo) });
      toast('ok', plan ? `Plan ${f.name.trim()} actualizado.` : `Plan ${f.name.trim()} creado.`);
      onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar el plan')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={plan ? `Editar ${plan.name}` : 'Nuevo plan'} size="lg"
      sub="Lo básico (socios, cobros, accesos, reportes) va en todo plan."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} disabled={!listo} onClick={() => void guardar()}>{plan ? 'Guardar' : 'Crear plan'}</Button></>}>
      <div className="stack">
        {/* La factura de cada marca lee el plan VIVO (23-03): precio y módulos de hoy, no los de cuando se le asignó. */}
        {plan && (plan.organizations ?? 0) > 0 && (
          <Callout tone="warn" title={`${plan.organizations} ${plan.organizations === 1 ? 'marca lo tiene' : 'marcas lo tienen'}`}>
            Lo que cambies aquí les llega en su siguiente factura: el precio nuevo se les cobra. Un módulo que quites lo conservan y se les factura aparte, como agregado.
            Uno que agregues entra en el precio del plan, pero solo se enciende a quien ya lo tenía contratado o cuando le vuelvas a asignar el plan desde su ficha.
          </Callout>
        )}
        <div className="grid grid-2">
          <Field label="Nombre" htmlFor="pl-n"><input id="pl-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Básico, Estudio, Completo…" /></Field>
          <Field label="Precio al mes (MXN)" htmlFor="pl-p" hint={centavos === undefined ? 'Escribe un importe en pesos, por ejemplo 1500 o 1500.50' : centavos === null ? 'Sin precio: se factura módulo por módulo.' : `${pesos(centavos)} al mes`}>
            <input id="pl-p" className="input mono" inputMode="decimal" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Descripción (opcional)" htmlFor="pl-d"><input id="pl-d" className="input" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Para quién es este plan" /></Field>
        <div>
          <p className="label">Módulos incluidos</p>
          <p className="hint mb-8">Lo básico va siempre. Marca lo que el plan incluye; lo demás se puede agregar por marca.</p>
          <div className="row gap-6 flex-wrap">
            {opcionales.map((m) => (
              <button key={m.key} type="button" className="chip" aria-pressed={incluidos.has(m.key)} data-incluye={m.key}
                onClick={() => setIncluidos((c) => { const n = new Set(c); if (n.has(m.key)) n.delete(m.key); else n.add(m.key); return n; })}>
                {incluidos.has(m.key) ? '✓ ' : ''}{m.name}
              </button>
            ))}
          </div>
        </div>
        {plan && (
          <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })}>Se ofrece a marcas nuevas{plan.organizations ? ` · ${plan.organizations} ${plan.organizations === 1 ? 'marca lo tiene' : 'marcas lo tienen'}` : ''}</Switch>
        )}
      </div>
    </Dialog>
  );
}
