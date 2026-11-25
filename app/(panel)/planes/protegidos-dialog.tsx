'use client';

import { useCallback, useState } from 'react';
import { Search, Tags } from 'lucide-react';
import type { MemberMemberships, PriceProtectionResult, ProtectedPrices } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { pesos } from '@gymflow/ui/format';
import { useBuscarSocios, type SocioHallado } from '@/lib/buscar-socios';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, CampoMotivo, Dialog, Empty, ERROR_MOTIVO, ErrorCarga, faltaMotivo } from '@/components/ui';
import { useCarga } from '@gymflow/ui/carga';
import { useFormulario } from '@gymflow/ui/formulario';
import type { Plan } from '@/lib/plans';

const VIVAS = new Set(['PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'FROZEN', 'SUSPENDED']);
const MOTIVOS_PONER = ['Convenio con su empresa', 'Acuerdo con el socio', 'Socio fundador'];
const MOTIVOS_QUITAR = ['Terminó el convenio', 'Se marcó por error', 'Acuerdo con el socio'];

/**
 * QUIÉNES CONSERVAN SU PRECIO EN UN PLAN (D-19, bloque 3.6). Cambiar el
 * precio del plan le cambia a todos en su siguiente pago, salvo a quienes
 * están aquí: a ellos no les cambia solo, y cada cambio de precio pregunta
 * qué se decide. Poner o quitar la marca pide motivo y queda en la bitácora;
 * ninguna de las dos cosas le cambia hoy el precio a nadie.
 */
export function ProtegidosDialog({ plan, onClose, onCambio }: { plan: Plan; onClose: () => void; onCambio: () => void }) {
  const toast = useToast();
  const { branchName } = useSession();
  const cargar = useCallback(() => api<ProtectedPrices>(`/plans/${plan.id}/protected-prices`), [plan.id]);
  const lista = useCarga(cargar);
  // A quién se le va a poner o quitar la marca: el motivo se pide en el mismo diálogo.
  const [accion, setAccion] = useState<{ membershipId: string; nombre: string; poner: boolean } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });

  const [q, setQ] = useState('');
  const { hallados, fallo: sinRed, buscando } = useBuscarSocios(q);
  const [buscandoPlan, setBuscandoPlan] = useState(false);

  /** El socio elegido debe tener ESTE plan vivo: la marca es de su membresía. */
  async function elegir(s: SocioHallado) {
    setFallo(null); setBuscandoPlan(true);
    try {
      const ms = await api<MemberMemberships>(`/members/${s.id}/memberships`);
      const viva = ms.find((m) => VIVAS.has(m.status) && m.planId === plan.id);
      const nombre = `${s.firstName} ${s.lastName}`.trim();
      if (!viva) { setFallo(`${nombre} no tiene ${plan.name} vigente.`); return; }
      if (lista.datos?.items.some((x) => x.membershipId === viva.id)) { setFallo(`${nombre} ya conserva su precio.`); return; }
      setQ(''); setMotivo(''); setAccion({ membershipId: viva.id, nombre, poner: true });
    } catch (e) { setFallo(errorText(e, 'No se pudo consultar su membresía')); } finally { setBuscandoPlan(false); }
  }

  async function confirmar() {
    if (!accion) return;
    setFallo(null);
    try {
      const r = await api<PriceProtectionResult>(`/memberships/${accion.membershipId}/price-protection`, { method: 'PUT', body: JSON.stringify({ protected: accion.poner, reason: motivo.trim() }) });
      toast('ok', accion.poner
        ? `${accion.nombre} conserva su precio${r.agreedPriceCents ? ` de ${pesos(r.agreedPriceCents, { decimals: false })}` : ''}.`
        : `${accion.nombre} ya no conserva su precio: el siguiente cambio de precio del plan también le toca.`);
      setAccion(null); setMotivo('');
      await lista.recargar(); onCambio();
    } catch (e) { setFallo(errorText(e, 'No se pudo guardar')); }
  }

  if (accion) {
    return (
      <Dialog open size="sm" onClose={() => { setAccion(null); setFallo(null); }} error={fallo}
        title={accion.poner ? `¿${accion.nombre} conserva su precio?` : `¿Quitar la marca a ${accion.nombre}?`}
        sub={accion.poner
          ? 'Seguirá pagando lo que paga hoy aunque cambie el precio del plan, hasta que alguien decida otra cosa.'
          : 'Hoy sigue pagando lo mismo. El siguiente cambio de precio del plan también le tocará.'}
        footer={<><Button variant="secondary" onClick={() => { setAccion(null); setFallo(null); }} disabled={f.enviando}>Volver</Button>
          <Button loading={f.enviando} onClick={() => void f.enviar(confirmar)}>{accion.poner ? 'Conserva su precio' : 'Quitar la marca'}</Button></>}>
        <CampoMotivo id="pp-motivo" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} motivos={accion.poner ? MOTIVOS_PONER : MOTIVOS_QUITAR}
          placeholder={accion.poner ? 'Convenio con su empresa' : 'Terminó el convenio'} hint="Queda en la bitácora con tu nombre." />
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} error={fallo} title={`Conservan su precio · ${plan.name}`}
      sub="Un cambio de precio del plan no les cambia solo: al cambiarlo se te pregunta qué pasa con ellos."
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      <div className="stack" data-testid="precios-protegidos">
        {lista.error ? <ErrorCarga titulo="No se pudo cargar la lista" mensaje={lista.error} onReintentar={() => void lista.recargar()} />
          : !lista.datos ? <p className="hint">…</p>
            : lista.datos.items.length === 0 ? <Empty icon={<Tags />} title="Nadie conserva su precio en este plan" text="Todos pagan el precio del plan y les toca cada cambio de precio en su siguiente pago." />
              : (
                <ul className="precio-protegidos">
                  {lista.datos.items.map((x) => (
                    <li key={x.membershipId}>
                      <span className="min-w-0">
                        <span className="strong">{x.memberName}</span> <span className="tiny muted">{x.memberCode}{x.branchId ? ` · ${branchName(x.branchId)}` : ''}</span>
                        {x.reason && <span className="tiny muted block">{x.reason}</span>}
                      </span>
                      <span className="num nowrap">{pesos(x.agreedPriceCents, { decimals: false })}{x.agreedPriceCents !== x.listPriceCents && <span className="tiny muted"> · lista {pesos(x.listPriceCents, { decimals: false })}</span>}</span>
                      <Button size="sm" variant="ghost" onClick={() => { setFallo(null); setMotivo(''); setAccion({ membershipId: x.membershipId, nombre: x.memberName, poner: false }); }}>Quitar</Button>
                    </li>
                  ))}
                  {lista.datos.total > lista.datos.items.length && <li className="tiny muted">y {(lista.datos.total - lista.datos.items.length).toLocaleString('es-MX')} más</li>}
                </ul>
              )}

        <div className="stack-sm">
          <p className="label" id="pp-agregar">Agregar a un socio</p>
          <div className="input-icon"><Search /><input className="input" aria-labelledby="pp-agregar" placeholder="Nombre o código del socio" value={q} onChange={(e) => { setQ(e.target.value); setFallo(null); }} /></div>
          {sinRed ? <p className="hint text-danger">No se pudo buscar. Revisa la conexión.</p>
            : q.trim().length >= 2 && hallados !== null && (hallados.length === 0 ? <p className="hint">{buscando ? 'Buscando…' : 'Nadie coincide.'}</p> : (
              <ul className="precio-protegidos">
                {hallados.filter((s) => s.status !== 'ARCHIVED').map((s) => (
                  <li key={s.id}>
                    <span className="min-w-0"><span className="strong">{s.firstName} {s.lastName}</span> <span className="tiny muted">{s.memberCode}</span></span>
                    <Button size="sm" variant="secondary" disabled={buscandoPlan} onClick={() => void elegir(s)}>Elegir</Button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </Dialog>
  );
}
