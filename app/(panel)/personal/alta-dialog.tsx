'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession, useToast, errorText, erroresPorCampo } from '@/components/session';
import { Button, Dialog, Field, Switch } from '@/components/ui';
import { frase, seccionesConEfecto, type Rol } from './persona';

/** El celular a 10 dígitos, como lo escribe el mostrador; la API lo guarda con +52 (17-07). */
export const celularParaEditar = (e164: string | null | undefined) => (e164 ?? '').replace(/^\+52/, '');

/**
 * Lo que la persona ve el primer día (17-06): su puesto, y de Dirección y
 * Cumplimiento nada hasta que la dueña se lo libere (D17-03). Al gerente
 * nuevo la dueña lo ve marcado en Personal para decidir qué ve.
 */
function naceViendo(puesto: Rol, decideLaDuena: boolean): string {
  const liberables = seccionesConEfecto(puesto.key).filter((x) => !x.abierta).map((x) => x.name);
  const ve = puesto.sees ? `Nace viendo: ${puesto.sees.replace(/\.$/, '')}.` : '';
  if (liberables.length === 0) return ve;
  if (puesto.key === 'MANAGER') {
    return `${ve} De Dirección y Cumplimiento, nada al principio: ${decideLaDuena ? 'la dueña decide qué ve y le avisamos en Personal.' : 'después de darlo de alta decides qué ve.'}`;
  }
  return `${ve} ${frase(liberables)}, solo si la dueña se ${liberables.length === 1 ? 'la' : 'las'} libera.`;
}

/** Puesto y sucursales: el puesto manda el alcance (ADR-039). */
export function Alcance({ roles, rol, setRol, sedes, setSedes, conPrevia = false }: {
  roles: Rol[]; rol: string; setRol: (r: string) => void; sedes: string[]; setSedes: (s: string[]) => void;
  /** En el alta: qué verá el primer día. */
  conPrevia?: boolean;
}) {
  const { branches, inScope, can } = useSession();
  const disponibles = branches.filter((b) => b.isActive && inScope(b.id));
  const puesto = roles.find((r) => r.key === rol);
  // Dueño y gerente abarcan todo; recepción, sus sedes; coach, lo que se elija.
  const elegir = (key: string) => {
    setRol(key);
    const p = roles.find((r) => r.key === key);
    if (p?.scope === 'org') setSedes([]);
    else if (p?.scope === 'branch' && sedes.length === 0) setSedes(disponibles.slice(0, 1).map((b) => b.id));
  };
  // La dueña que administra (sin gerente que lo haga) decide ella misma qué ve el nuevo.
  const decideLaDuena = !can('staff:unlock');
  return (
    <>
      <Field label="Puesto" htmlFor="st-rol" hint={puesto ? (conPrevia ? naceViendo(puesto, decideLaDuena) : puesto.description ?? '') : 'Cada puesto ve y hace lo que su trabajo exige y nada más.'}>
        <select id="st-rol" className="select" value={rol} onChange={(e) => elegir(e.target.value)}>
          <option value="">Elige un puesto…</option>
          {roles.filter((r) => (r.assignable && r.key !== 'OWNER') || r.key === rol).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </Field>
      {puesto?.scope !== 'org' && (
        <div className="field">
          <span className="label">Sucursales</span>
          {puesto?.scope === 'any' && <Switch checked={sedes.length === 0} onChange={(v) => setSedes(v ? [] : disponibles.slice(0, 1).map((b) => b.id))}>Toda la organización</Switch>}
          {(sedes.length > 0 || puesto?.scope === 'branch') && disponibles.map((b) => (
            <Switch key={b.id} checked={sedes.includes(b.id)} onChange={(v) => setSedes(v ? [...sedes, b.id] : sedes.filter((x) => x !== b.id))}>{b.name}</Switch>
          ))}
          {puesto?.scope === 'branch' && sedes.length === 0 && <p className="hint">Elige al menos una sucursal.</p>}
        </div>
      )}
      {puesto?.scope === 'org' && <p className="hint">{puesto.name} abarca todo el gimnasio, también las sucursales que se abran después.</p>}
    </>
  );
}

/** Dar de alta: recibe una contraseña temporal para su primer acceso. */
export function AltaDialog({ roles, onClose, onCreado }: {
  roles: Rol[]; onClose: () => void;
  onCreado: (r: { nombre: string; email: string; telefono: string | null; clave: string }) => void;
}) {
  const toast = useToast();
  const { branches, inScope } = useSession();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [rol, setRol] = useState('RECEPTION');
  const [sedes, setSedes] = useState<string[]>(branches.filter((b) => b.isActive && inScope(b.id)).slice(0, 1).map((b) => b.id));
  const [motivo, setMotivo] = useState('Contratación');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  async function crear() {
    setEnviando(true);
    try {
      const r = await api<{ temporaryPassword: string; user: { phoneE164: string | null } }>('/users', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), fullName: nombre.trim(), phoneE164: telefono.trim() || null, roleKey: rol, branchIds: sedes, reason: motivo.trim() }),
      });
      onCreado({ nombre: nombre.trim(), email: email.trim(), telefono: r.user?.phoneE164 ?? null, clave: r.temporaryPassword });
    } catch (e) {
      // Correo repetido o mal escrito, celular incompleto: se marca en su campo (UX5-G-03).
      const porCampo = erroresPorCampo(e);
      if (e instanceof ApiError && e.status === 409) porCampo.email = errorText(e, 'Ese correo ya tiene una cuenta');
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo dar de alta'));
    } finally { setEnviando(false); }
  }
  const limpiar = (campo: string) => setErrores(({ [campo]: _, ...r }) => r);
  return (
    <Dialog open onClose={onClose} title="Dar de alta a una persona" sub="Recibirá una contraseña temporal para su primer acceso."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={<UserPlus />} loading={enviando} disabled={nombre.trim().length < 3 || !email.includes('@') || !rol || motivo.trim().length < 3 || (roles.find((r) => r.key === rol)?.scope === 'branch' && sedes.length === 0)} onClick={() => void crear()}>Dar de alta</Button></>}>
      <div className="stack">
        <Field label="Nombre completo" htmlFor="st-nom" required error={errores.fullName}><input id="st-nom" className="input" autoFocus value={nombre} onChange={(e) => { setNombre(e.target.value); limpiar('fullName'); }} /></Field>
        <Field label="Correo" htmlFor="st-em" required hint="Con él entra al panel." error={errores.email}><input id="st-em" className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); limpiar('email'); }} /></Field>
        <Field label="Celular" htmlFor="st-tel" hint="Opcional: para mandarle su contraseña por WhatsApp y pedirle una firma." error={errores.phoneE164}>
          <input id="st-tel" className="input" inputMode="tel" placeholder="10 dígitos" value={telefono} onChange={(e) => { setTelefono(e.target.value); limpiar('phoneE164'); }} />
        </Field>
        <Alcance roles={roles} rol={rol} setRol={setRol} sedes={sedes} setSedes={setSedes} conPrevia />
        <Field label="Motivo" htmlFor="st-mot"><input id="st-mot" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
