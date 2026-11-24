'use client';

import { useCallback, useState } from 'react';
import { DEFINICION_DE_PLAZOS, erroresDePlazos, frasesDePlazos, plazoEnPalabras, plazosDelGrupo, type GrupoDePlazo, type PlazoKey } from '@gymflow/core/plazos';
import type { MemberTerms } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fechaHora } from '@/lib/format';
import { useCarga } from '@/lib/carga';
import { errorText, useSession, useToast } from '@/components/session';
import { AutorizacionDialog } from '@/components/autorizacion';
import { Button, Callout, CampoMotivo, Card, Dialog, ErrorCarga, Field } from '@/components/ui';

/**
 * LOS PLAZOS DEL GIMNASIO (fase 4, bloque 4.4 · D-18): cuándo «dejó de venir»,
 * cuándo es baja, cuándo se da por perdido, cuánto se le busca en «Recuperar»,
 * cuándo se cancela una venta sin cobrar y cuándo la deuda de una suspendida
 * sale de «Por cobrar». Los números vienen de la API (`GET /member-terms`) y
 * las frases, del núcleo: esta pantalla no escribe ninguno.
 *
 * Los de retención los cambia la gerencia, con motivo. Los de la deuda,
 * SIEMPRE con la autorización de quien da la segunda firma.
 */
export function PlazosDelGimnasio({ onCambio }: { onCambio: () => void }) {
  const { can } = useSession();
  const carga = useCarga(useCallback(() => api<MemberTerms>('/member-terms'), []));
  const [editando, setEditando] = useState<GrupoDePlazo | null>(null);
  const p = carga.datos ?? null;
  if (carga.error && !p) return <ErrorCarga titulo="No se pudieron cargar los plazos del gimnasio" mensaje={carga.error} onReintentar={() => void carga.recargar()} />;
  if (!p) return null;

  const frases = frasesDePlazos(p.terms);
  const ajustado = (k: PlazoKey) => p.customized.includes(k);
  const renglon = (k: PlazoKey) => (
    <li key={k} className="small" data-testid={`plazo-${k}`}>
      {frases[k]}{ajustado(k) ? <span className="muted"> (de fábrica: {plazoEnPalabras(k, p.defaults[k])})</span> : null}
    </li>
  );
  const puedeRetencion = can('retention:terms:set');
  const puedeDeuda = can('billing:debt-terms:set');

  return (
    <>
      <details className="explica" data-testid="plazos-del-gimnasio" id="plazos">
        <summary className="tiny strong">Los plazos de este gimnasio{p.customized.length > 0 ? ' (ajustados)' : ''}</summary>
        <Card title="Plazos" sub={p.updatedAt ? `Último cambio: ${fechaHora(p.updatedAt)}${p.updatedByName ? ` · ${p.updatedByName}` : ''}.` : 'Son los de GymFlow: nadie los ha cambiado.'}>
          <div className="stack">
            <div className="stack-sm">
              <div className="row-between wrap gap-8">
                <span className="small strong">Del socio que se va</span>
                {puedeRetencion && <Button size="sm" variant="secondary" onClick={() => setEditando('retention')}>Cambiar…</Button>}
              </div>
              <ul className="stack-sm">{plazosDelGrupo('retention').map((d) => renglon(d.key))}</ul>
            </div>
            <div className="stack-sm">
              <div className="row-between wrap gap-8">
                <span className="small strong">De la deuda que ya no se cobra</span>
                {puedeDeuda && <Button size="sm" variant="secondary" onClick={() => setEditando('debt')}>Cambiar con autorización…</Button>}
              </div>
              <ul className="stack-sm">{plazosDelGrupo('debt').map((d) => renglon(d.key))}</ul>
            </div>
          </div>
        </Card>
      </details>
      {editando && (
        <CambiarPlazos grupo={editando} plazos={p} onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); void carga.recargar(); onCambio(); }} />
      )}
    </>
  );
}

const MOTIVOS: Record<GrupoDePlazo, readonly string[]> = {
  retention: ['Así viene la gente de este gimnasio', 'Lo pidió la dueña'],
  debt: ['Lo pidió la dueña', 'Lo pidió el contador'],
};

function CambiarPlazos({ grupo, plazos, onClose, onGuardado }: { grupo: GrupoDePlazo; plazos: MemberTerms; onClose: () => void; onGuardado: () => void }) {
  const toast = useToast();
  const { org } = useSession();
  const campos = plazosDelGrupo(grupo);
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((d) => [d.key, String(plazos.terms[d.key])])));
  const [motivo, setMotivo] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  // Solo se manda lo que cambia; los cruces se comprueban contra lo que rige.
  const propuesto: Partial<Record<PlazoKey, number>> = {};
  for (const d of campos) {
    const n = Number(valores[d.key]);
    if (valores[d.key]!.trim() === '' || n !== plazos.terms[d.key]) propuesto[d.key] = valores[d.key]!.trim() === '' ? Number.NaN : n;
  }
  const errores = erroresDePlazos(propuesto, plazos.terms);
  const sinCambios = Object.keys(propuesto).length === 0;
  const faltaMotivo = motivo.trim().length < 3;
  const valido = errores.length === 0 && !sinCambios && !faltaMotivo;
  const conFirma = grupo === 'debt';

  async function guardar(token?: string) {
    setEnviando(true); setFallo(null);
    try {
      await api<MemberTerms>(`/member-terms/${grupo === 'debt' ? 'debt' : 'retention'}`, {
        method: 'PUT', body: JSON.stringify({ ...propuesto, reason: motivo.trim(), ...(token ? { approvalToken: token } : {}) }),
      });
      toast('ok', conFirma ? 'Plazos de la deuda actualizados' : 'Plazos de retención actualizados');
      onGuardado();
    } catch (e) { setFallo(errorText(e, 'No se pudieron cambiar los plazos')); } finally { setEnviando(false); }
  }

  function seguir() {
    setIntentado(true);
    if (!valido) return;
    if (conFirma) setAutorizando(true); else void guardar();
  }

  if (autorizando) {
    return (
      <AutorizacionDialog permission="billing:debt-terms:set" branchId={null} operacion={{ resourceType: 'MemberTerms', resourceId: org.id }} motivo={motivo.trim()}
        titulo="Autorizar el cambio de los plazos de la deuda"
        onClose={() => setAutorizando(false)}
        onAutorizado={(token) => { setAutorizando(false); void guardar(token); }} />
    );
  }

  return (
    <Dialog open onClose={onClose} title={conFirma ? 'Plazos de la deuda' : 'Plazos de retención'}
      error={fallo ?? (intentado && errores.length > 0 ? errores.join(' ') : intentado && sinCambios ? 'No cambiaste ningún plazo.' : null)}
      sub={conFirma
        ? 'Valen para todas las sucursales. Cambiarlos siempre lo autoriza otra persona, con su contraseña.'
        : 'Valen para todas las sucursales y para todas las pantallas: Retención, Recuperar, el Inicio y la ficha del socio.'}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button loading={enviando} onClick={seguir}>{conFirma ? 'Pedir autorización' : 'Guardar'}</Button></>}>
      <div className="stack">
        {campos.map((d) => {
          const def = DEFINICION_DE_PLAZOS.find((x) => x.key === d.key)!;
          const unidad = def.unit === 'months' ? 'meses' : 'días';
          const n = Number(valores[d.key]);
          const fuera = valores[d.key]!.trim() === '' || !Number.isInteger(n) || n < def.min || n > def.max;
          return (
            <Field key={d.key} label={`${def.label} (${unidad})`} htmlFor={`pl-${d.key}`} required
              hint={`${def.hint} De ${def.min} a ${def.max} ${unidad}; el de GymFlow es ${plazoEnPalabras(d.key, plazos.defaults[d.key])}.`}
              error={intentado && fuera ? `Va de ${def.min} a ${def.max} ${unidad}.` : null}>
              <input id={`pl-${d.key}`} className="input num" inputMode="numeric" value={valores[d.key]}
                onChange={(e) => setValores((v) => ({ ...v, [d.key]: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
            </Field>
          );
        })}
        {conFirma && (
          <Callout tone="info">
            El cambio rige desde el siguiente cierre del día. La deuda que ya se dio por perdida no regresa a «Por cobrar», y ninguna deuda se borra: sigue en el estado de cuenta del socio y se puede cobrar.
          </Callout>
        )}
        <CampoMotivo id="pl-motivo" value={motivo} onChange={setMotivo} motivos={MOTIVOS[grupo]} error={intentado && faltaMotivo ? 'Escribe el motivo del cambio.' : null} />
      </div>
    </Dialog>
  );
}
