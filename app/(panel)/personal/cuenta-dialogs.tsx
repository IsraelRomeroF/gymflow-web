'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Callout, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo, Field } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { WhatsappTemporal } from '@/components/entrega-temporal';
import { TEMPORAL_DIAS, direccionDeEntrada, mensajeDeAcceso } from '@/lib/entrega-temporal';
import type { Persona } from './persona';

/**
 * Nueva contraseña, baja o reactivación, cada una con su confirmación y su
 * motivo (UX 2026-10-08). Reactivar entrega una temporal nueva, como el alta
 * (17-10, D17-06): la de antes pudo quedar compartida.
 */
export function ConfirmarCuenta({ persona, accion, rescate, onClose, onHecho }: {
  persona: Persona; accion: 'clave' | 'baja'; rescate: boolean; onClose: () => void; onHecho: (clave?: string) => void;
}) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const baja = accion === 'baja';
  // Baja de un coach con socios (bloque 2.6, 12-07): se pregunta a quién pasan; sin respuesta no hay baja.
  const bajaDeCoach = baja && persona.isActive && !rescate && persona.role?.key === 'COACH';
  const [cartera, setCartera] = useState<{ socios: number; coaches: Array<{ id: string; fullName: string }> } | null>(null);
  const [destino, setDestino] = useState('');
  useEffect(() => {
    if (!bajaDeCoach) return;
    let vigente = true;
    void Promise.all([
      api<{ count: number }>(`/coaches/${persona.id}/members`),
      api<{ coaches: Array<{ id: string; fullName: string }> }>('/members/coaches').catch(() => ({ coaches: [] })),
    ]).then(([c, l]) => { if (vigente) setCartera({ socios: c.count, coaches: l.coaches.filter((x) => x.id !== persona.id) }); })
      // Si no se pudo preguntar, el servidor lo exige igual: la baja responde que faltó decir a quién pasan.
      .catch(() => { if (vigente) setCartera({ socios: 0, coaches: [] }); });
    return () => { vigente = false; };
  }, [bajaDeCoach, persona.id]);
  const conSocios = bajaDeCoach && (cartera?.socios ?? 0) > 0;
  // Mientras no se sabe si tiene socios, el principal espera; después queda encendido y cada campo dice qué le falta (26-02; adopción 2.12).
  const preguntando = bajaDeCoach && cartera === null;
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO, destino: conSocios && destino === '' && 'Elige a quién pasan, o que se quedan sin coach.' });
  const titulo = baja ? (persona.isActive ? `¿Dar de baja a ${persona.fullName}?` : `¿Reactivar a ${persona.fullName}?`) : `¿Nueva contraseña para ${persona.fullName}?`;
  const sub = baja
    ? (persona.isActive
      ? 'Se cierran sus sesiones y ya no puede entrar. Lo que hizo queda en la bitácora.'
      : 'Vuelve con una contraseña temporal nueva que verás una sola vez: la de antes ya no sirve. La cambia al entrar.')
    : 'Se genera una temporal que verás una sola vez; la cambia al entrar. Sus sesiones abiertas se cierran.';
  async function confirmar() {
    setEnviando(true);
    try {
      const url = rescate ? `/users/${persona.id}/rescue` : baja ? `/users/${persona.id}` : `/users/${persona.id}/reset-password`;
      const body = rescate
        ? { action: baja ? (persona.isActive ? 'deactivate' : 'reactivate') : 'reset_password', reason: motivo.trim() }
        : baja ? { isActive: !persona.isActive, reason: motivo.trim(), ...(conSocios ? { coachHandover: { toUserId: destino === 'nadie' ? null : destino } } : {}) } : { reason: motivo.trim() };
      const r = await api<{ temporaryPassword?: string | null }>(url, { method: rescate || !baja ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      if (baja) toast('ok', persona.isActive ? 'Dada de baja: sus sesiones se cerraron' : 'Reactivada: entrégale su contraseña temporal');
      onHecho(r?.temporaryPassword ?? undefined);
    } catch (e) { toast('error', errorText(e, 'No se pudo')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={() => { if (!enviando) onClose(); }} title={titulo} sub={sub}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant={baja && persona.isActive ? 'danger' : 'primary'} loading={enviando} disabled={preguntando} onClick={() => void f.enviar(confirmar)}>
          {baja ? (persona.isActive ? 'Dar de baja' : 'Reactivar') : 'Generar contraseña'}
        </Button></>}>
      <div className="stack">
      <CampoMotivo id="cc-mot" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')}
        placeholder={baja ? (persona.isActive ? 'Fin de contrato, renuncia…' : 'Regresa a trabajar…') : 'Olvidó su contraseña…'} />
      {conSocios && cartera && (
        <Field label={cartera.socios === 1 ? '¿A quién pasa su socio?' : `¿A quién pasan sus ${cartera.socios} socios?`} htmlFor="cc-cartera" required error={f.error('destino')}
          hint="El coach que elijas los ve desde hoy en «Mis socios». Sus rutinas no cambian.">
          <select id="cc-cartera" className="select" value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Elige…</option>
            {cartera.coaches.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            <option value="nadie">Se quedan sin coach (se asignan después, uno por uno)</option>
          </select>
        </Field>
      )}
      </div>
    </Dialog>
  );
}

/**
 * La temporal de UNA persona, que se le entrega a ella y a nadie más: en
 * mano, copiada o por WhatsApp a su celular (22-03). Solo le sirve para
 * elegir la suya al entrar y vence a los 7 días (A4-N1).
 */
export function ClaveDialog({ nombre, email, telefono, clave, onClose }: { nombre: string; email: string; telefono?: string | null; clave: string; onClose: () => void }) {
  const toast = useToast();
  const { org } = useSession();
  const mensaje = mensajeDeAcceso(org.tradeName, direccionDeEntrada(), { fullName: nombre, email, password: clave });
  return (
    <Dialog open onClose={onClose} title={`Contraseña temporal de ${nombre}`} sub="Se muestra UNA sola vez. Dásela solo a esa persona: en mano o a su celular."
      footer={<Button onClick={onClose}>Ya la entregué</Button>}>
      <div className="stack items-center text-center">
        <div className="mono personal-temporal">{clave}</div>
        <div className="row gap-8 flex-wrap">
          <Button variant="ghost" size="sm" icon={<Copy />} onClick={() => { void navigator.clipboard.writeText(clave).then(() => toast('ok', 'Copiada')).catch(() => toast('error', 'No se pudo copiar: dísela o mándala por WhatsApp')); }}>Copiar</Button>
          <WhatsappTemporal nombre={nombre} telefono={telefono} mensaje={mensaje} />
        </div>
        <Callout tone="info">Entra con <strong>{email}</strong> y esta contraseña: solo le sirve para elegir la suya al entrar y vence en {TEMPORAL_DIAS} días. Durante 24 horas no podrá autorizar operaciones de otros.</Callout>
      </div>
    </Dialog>
  );
}
