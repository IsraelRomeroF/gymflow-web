'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserCheck, UserX } from 'lucide-react';
import type { ApprovalProxyAppointment, ApprovalProxyState } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { dia, fecha } from '@gymflow/ui/format';
import { useFormulario } from '@gymflow/ui/formulario';
import { errorText, useToast } from '@/components/session';
import { Badge, Button, Callout, CampoFecha, Card, Dialog, Field, Opciones } from '@/components/ui';
import { textoDeErrorDeFirma } from '@/components/autorizacion';

/**
 * APODERADO TEMPORAL (D-02, fase 3, bloque 3.1).
 *
 * Solo la dueña da la segunda firma; si no puede (viaje, sin señal, enferma),
 * nombra desde su teléfono a UNA persona con fecha de fin. Esa persona
 * autoriza lo que pide el personal con la autoridad de la dueña: nunca lo
 * suyo, ni lo que otra persona ya rechazó. Cada firma queda en la bitácora
 * como «firmó como apoderado».
 *
 * `useApoderado` lee `GET /approvals/proxy`; la tarjeta es de quien nombra y
 * el aviso, de quien fue nombrado. A nadie más le sale nada.
 */
export function useApoderado(activo: boolean): { estado: ApprovalProxyState | null; recargar: () => void } {
  const [estado, setEstado] = useState<ApprovalProxyState | null>(null);
  const recargar = useCallback(() => {
    if (!activo) return;
    // Si no se puede leer, la pantalla de firmas sigue igual: aquí solo se deja de ofrecer.
    api<ApprovalProxyState>('/approvals/proxy').then(setEstado).catch(() => undefined);
  }, [activo]);
  useEffect(() => { recargar(); }, [recargar]);
  return { estado, recargar };
}

/** «5 de diciembre»: el último día que vale. `endsAt` es la medianoche con la que ese día termina. */
const ultimoDia = (n: Pick<ApprovalProxyAppointment, 'endsAt'>) => dia(new Date(Date.parse(n.endsAt) - 1000));

const usado = (n: Pick<ApprovalProxyAppointment, 'signedCount' | 'rejectedCount'>) => {
  if (n.signedCount === 0 && n.rejectedCount === 0) return 'No ha firmado nada con este nombramiento.';
  const si = n.signedCount === 1 ? '1 autorización' : `${n.signedCount} autorizaciones`;
  const no = n.rejectedCount === 1 ? '1 rechazo' : `${n.rejectedCount} rechazos`;
  return `Con este nombramiento lleva ${si} y ${no}. Están en la bitácora como «firmó como apoderado».`;
};

const COMO_TERMINO: Record<NonNullable<ApprovalProxyAppointment['endReason']>, string> = {
  REVOKED: 'lo revocaste', EXPIRED: 'llegó su fecha', REPLACED: 'nombraste a otra persona',
};

/** Para quien fue nombrado: con qué autoridad está firmando, hasta cuándo y qué no le toca. */
export function AvisoDeApoderado({ estado }: { estado: ApprovalProxyState | null }) {
  const n = estado?.mine ? estado.current : null;
  if (!n) return null;
  const quien = n.grantedByName ?? 'quien te nombró';
  return (
    <div className="mb-16">
      <Callout tone="info" title={`Autorizas como apoderado de ${quien} hasta el ${ultimoDia(n)}`}>
        <p className="small" data-testid="apoderado-aviso">
          Lo que pide el personal lo puedes autorizar tú, con tu contraseña. Lo que pidas tú, y lo que {quien} ya haya rechazado, solo lo autoriza {quien}.
          Cada firma queda en la bitácora como «firmó como apoderado».
        </p>
      </Callout>
    </div>
  );
}

/** Para la dueña: quién firma por ella ahora, nombrar, cambiar y revocar. */
export function TarjetaDeApoderado({ estado, onCambio }: { estado: ApprovalProxyState | null; onCambio: () => void }) {
  const toast = useToast();
  const [nombrando, setNombrando] = useState(false);
  const [revocando, setRevocando] = useState(false);
  if (!estado?.canManage) return null;
  const n = estado.current;
  return (
    <>
      <Card data-testid="apoderado" className="mt-16" title="Apoderado temporal"
        sub={n ? undefined : 'Para cuando no puedas firmar: un viaje, un día sin señal.'}
        actions={n ? <Badge tone="ok" dot>Vigente</Badge> : undefined}>
        {n ? (
          <div className="stack-sm">
            <p className="strong">{n.proxyName ?? 'Una persona del personal'} autoriza por ti hasta el {ultimoDia(n)}</p>
            <p className="small muted">
              Autoriza lo que pide el personal, nunca lo suyo ni lo que tú hayas rechazado. Tú sigues firmando igual. Se apaga solo al terminar ese día.
              {n.note ? <> Nota: {n.note}.</> : null}
            </p>
            <p className="small">{usado(n)}</p>
            <div className="row wrap gap-8">
              <Button variant="secondary" icon={<UserCheck />} onClick={() => setNombrando(true)}>Cambiar</Button>
              <Button variant="secondary" icon={<UserX />} onClick={() => setRevocando(true)}>Revocar</Button>
            </div>
          </div>
        ) : (
          <div className="stack-sm">
            <p className="small">
              Nombra a una persona del personal para que autorice por ti hasta el día que elijas. Autoriza lo que piden los demás, nunca lo suyo ni lo que tú hayas rechazado;
              cada firma queda en la bitácora como «firmó como apoderado», y lo puedes revocar cuando quieras.
            </p>
            {estado.candidates.length === 0
              ? <p className="small muted">No hay a quién nombrar: hace falta otra persona del personal con cuenta activa.</p>
              : <div className="row"><Button variant="secondary" icon={<UserCheck />} onClick={() => setNombrando(true)}>Nombrar apoderado</Button></div>}
          </div>
        )}
        {estado.history.length > 0 && (
          <details className="mt-16">
            <summary className="small muted">Nombramientos anteriores</summary>
            <ul className="stack-sm mt-8" data-testid="apoderado-historia">
              {estado.history.map((h) => (
                <li key={h.id} className="small">
                  <span className="strong">{h.proxyName ?? 'Una persona'}</span> · del {fecha(h.createdAt)} al {fecha(h.endedAt ?? h.endsAt)}
                  {h.endReason ? ` · ${COMO_TERMINO[h.endReason]}` : ''} · {h.signedCount === 1 ? '1 firma' : `${h.signedCount} firmas`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      {nombrando && <Nombrar estado={estado} onClose={() => setNombrando(false)} onListo={(nombre, hasta) => {
        setNombrando(false); toast('ok', `${nombre} autoriza por ti hasta el ${hasta}. Le llega el aviso si tiene los avisos activos en su teléfono.`); onCambio();
      }} />}
      {revocando && n && <Revocar n={n} onClose={() => setRevocando(false)} onListo={() => {
        setRevocando(false); toast('ok', 'Nombramiento revocado. Desde este momento solo tú autorizas.'); onCambio();
      }} />}
    </>
  );
}

function Nombrar({ estado, onClose, onListo }: { estado: ApprovalProxyState; onClose: () => void; onListo: (nombre: string, hasta: string) => void }) {
  const [persona, setPersona] = useState<string | null>(null);
  const [hasta, setHasta] = useState('');
  const [nota, setNota] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fueraDeRango = !!hasta && (hasta < estado.today || hasta > estado.lastDay);
  const f = useFormulario({
    persona: !persona && 'Elige a quién nombras.',
    hasta: (!hasta && 'Elige hasta qué día.') || (fueraDeRango && `Va de hoy a ${estado.maxDays} días: hasta el ${dia(`${estado.lastDay}T12:00:00Z`, { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`),
    password: !password && 'Escribe tu contraseña.',
  }, { obligatorios: ['persona', 'hasta', 'password'] });
  const actual = estado.current;

  async function enviar() {
    setError(null);
    try {
      const r = await api<ApprovalProxyAppointment>('/approvals/proxy', {
        method: 'POST', body: JSON.stringify({ proxyUserId: persona, endsOn: hasta, password, ...(nota.trim() ? { note: nota.trim() } : {}) }),
      });
      onListo(r.proxyName ?? 'Tu apoderado', ultimoDia(r));
    } catch (e) {
      // Con la pausa por intentos fallidos, el mensaje dice hasta qué hora (24-11).
      setError(textoDeErrorDeFirma(e, 'No se pudo nombrar'));
    }
  }

  return (
    <Dialog open onClose={onClose} title="Nombrar apoderado" sub="Autoriza por ti lo que pida el personal, hasta el día que elijas." error={error}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button icon={<UserCheck />} loading={f.enviando} onClick={() => void f.enviar(enviar)}>Nombrar</Button></>}>
      <form className="stack" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void f.enviar(enviar); }}>
        {actual && <Callout tone="warn">Al nombrar a otra persona, el nombramiento de {actual.proxyName ?? 'tu apoderado actual'} termina en ese momento.</Callout>}
        <Field label={<span id="apo-quien">¿A quién?</span>} {...f.campo('persona')}>
          <Opciones forma="tarjetas" etiquetadaPor="apo-quien" value={persona} onChange={setPersona}
            opciones={estado.candidates.map((c) => ({
              value: c.userId, label: c.fullName, disabled: c.cannotSignYet,
              texto: c.cannotSignYet ? 'Tiene una contraseña temporal o recién cambiada: todavía no puede firmar' : c.roleLabel ?? undefined,
            }))} />
        </Field>
        <Field label="Hasta el día" htmlFor="apo-hasta" hint="Vale ese día completo y se apaga solo. Puedes revocarlo antes." {...f.campo('hasta')}>
          <CampoFecha id="apo-hasta" className="campo-corto" min={estado.today} max={estado.lastDay} hoy={estado.today} atajos={[0, 1, 3, 7]} value={hasta} onChange={setHasta} />
        </Field>
        <Field label="Nota" htmlFor="apo-nota" hint="Para la bitácora: por qué lo nombras.">
          <input id="apo-nota" className="input" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Salgo de viaje" />
        </Field>
        <Field label="Tu contraseña" htmlFor="apo-pw" hint="Nombrar a alguien para que firme por ti pide tu contraseña, como una firma." {...f.campo('password')}>
          <input id="apo-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function Revocar({ n, onClose, onListo }: { n: ApprovalProxyAppointment; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario({});
  async function enviar() {
    setError(null);
    try {
      await api('/approvals/proxy/revoke', { method: 'POST', body: JSON.stringify(motivo.trim() ? { reason: motivo.trim() } : {}) });
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo revocar')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} title="Revocar el nombramiento" sub={`${n.proxyName ?? 'Tu apoderado'} deja de autorizar en este momento.`} error={error}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" icon={<UserX />} loading={f.enviando} onClick={() => void f.enviar(enviar)}>Revocar</Button></>}>
      <div className="stack">
        <p className="small">Lo que ya autorizó y se registró no cambia. Una firma suya que todavía nadie haya usado deja de valer.</p>
        <Field label="Motivo" htmlFor="apo-rev" hint="Para la bitácora. Puedes dejarlo vacío.">
          <input id="apo-rev" className="input" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ya regresé" />
        </Field>
      </div>
    </Dialog>
  );
}
