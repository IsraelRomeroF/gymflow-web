'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast, errorText } from '@/components/session';
import { Button, Callout, Dialog, Field, Switch, irAlPrimerError } from '@/components/ui';
import { usePlataforma, type Puesto } from '../../layout';
import type { CuentaCreada, Detalle } from './tipos';

/** Una cuenta más para la marca, con cualquier puesto del catálogo. Nace con contraseña temporal. */
export function NuevaCuenta({ marca, onClose, onCreada }: { marca: Detalle; onClose: () => void; onCreada: (c: CuentaCreada) => void }) {
  const { roles } = usePlataforma();
  const toast = useToast();
  const [f, setF] = useState({ fullName: '', email: '', phone: '', roleKey: 'RECEPTION', todo: false, reason: '' });
  const [sedes, setSedes] = useState<Set<string>>(() => new Set(marca.branches.filter((b) => b.isActive).slice(0, 1).map((b) => b.id)));
  const [enviando, setEnviando] = useState(false);
  const puesto: Puesto | undefined = roles.find((r) => r.key === f.roleKey);
  // El alcance lo manda el puesto: la dueña y la gerencia general abarcan todo; caja y recepción, sus sedes.
  const alcanceTodo = puesto?.scope === 'org' || (puesto?.scope === 'any' && f.todo);
  const hayGerenteActivo = marca.users.some((u) => u.isActive && u.roleKeys.includes('MANAGER'));
  const errores: Record<string, string> = {
    ...(f.fullName.trim().length < 3 ? { fullName: 'Escribe su nombre completo.' } : {}),
    ...(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) ? { email: 'Escribe un correo válido.' } : {}),
    ...(!alcanceTodo && sedes.size === 0 ? { sedes: 'Elige al menos una sucursal.' } : {}),
    ...(f.reason.trim().length < 3 ? { reason: 'Escribe el motivo: queda en la bitácora.' } : {}),
  };
  const [intentado, setIntentado] = useState(false);
  const e = (k: string) => (intentado ? errores[k] ?? null : null);

  async function crear() {
    setIntentado(true);
    if (Object.keys(errores).length > 0) { irAlPrimerError(); return; }
    setEnviando(true);
    try {
      const r = await api<CuentaCreada>(`/platform/organizations/${marca.id}/users`, {
        method: 'POST',
        body: JSON.stringify({ fullName: f.fullName.trim(), email: f.email.trim(), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), roleKey: f.roleKey, branchIds: alcanceTodo ? null : [...sedes], reason: f.reason.trim() }),
      });
      onCreada(r);
    } catch (e) { toast('error', errorText(e, 'No se pudo crear la cuenta')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Nueva cuenta en ${marca.tradeName}`} sub="Nace con contraseña temporal; la persona elige la suya al entrar. Cada puesto ve y hace lo que su trabajo exige y nada más."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} onClick={() => void crear()}>Crear cuenta</Button></>}>
      <div className="stack">
        <Field label="Puesto" htmlFor="nc-rol" hint={puesto ? `${puesto.description} Ve: ${puesto.sees}` : undefined}>
          <select id="nc-rol" className="select" value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value, todo: false })}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-3">
          <Field label="Nombre" htmlFor="nc-n" required error={e('fullName')}><input id="nc-n" className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Correo" htmlFor="nc-e" required error={e('email')}><input id="nc-e" className="input" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Celular (opcional)" htmlFor="nc-t"><input id="nc-t" className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        {puesto && puesto.scope !== 'org' && (
          <div className="stack-sm">
            <p className="label">Alcance</p>
            {puesto.scope === 'any' && <Switch checked={f.todo} onChange={(v) => setF({ ...f, todo: v })}>Todo el gimnasio (todas las sucursales, también las que se abran después)</Switch>}
            {!alcanceTodo && (
              <div className="row gap-6 flex-wrap" data-error={e('sedes') ? 'true' : undefined}>
                {marca.branches.filter((b) => b.isActive).map((b) => (
                  <button key={b.id} type="button" className="chip" aria-pressed={sedes.has(b.id)} onClick={() => setSedes((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}>{sedes.has(b.id) ? '✓ ' : ''}{b.name}</button>
                ))}
                {e('sedes') && <span className="field-error stack-full-fila" role="alert">{e('sedes')}</span>}
              </div>
            )}
          </div>
        )}
        <Field label="Motivo" htmlFor="nc-m" required error={e('reason')} hint="Queda en la bitácora de la marca."><input id="nc-m" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="El dueño pidió otra recepcionista" /></Field>
        {/* La regla del gerente (22-09), dicha ANTES de crear la cuenta: con la llave solo si la marca no tiene otro gerente activo. */}
        {f.roleKey === 'MANAGER' && (
          <div data-testid="regla-gerente">
            {hayGerenteActivo
              ? <Callout tone="info">{marca.tradeName} ya tiene un gerente activo: esta cuenta nace <strong>sin Dirección ni Cumplimiento</strong>, y el dueño decide qué ve desde Personal. La gerencia puede dar de alta a su propio personal desde el panel.</Callout>
              : <Callout tone="warn">{marca.tradeName} no tiene un gerente activo: esta cuenta nace con <strong>Dirección y Cumplimiento liberados</strong>, para que pueda armar el gimnasio. El dueño se lo puede quitar después, sección por sección.</Callout>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
