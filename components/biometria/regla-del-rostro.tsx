'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ScanFace, ShieldCheck } from 'lucide-react';
import type { FaceRule, FaceRulePending } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';
import { useSession, errorText } from '../session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, ErrorCarga, Skeleton, faltaMotivo } from '../ui';

/**
 * «ENTRAR SOLO CON ROSTRO» (fase 3, bloque 3.3; D-06).
 *
 * La regla de Israel: un socio sin rostro registrado NUNCA entra, salvo que la
 * gerencia lo autorice en cada visita. Es del gimnasio y nace apagada: se
 * enciende aquí cuando ya se pueden registrar rostros en recepción. Antes de
 * encenderla, esta tarjeta dice a cuántos socios que hoy entran les falta el
 * rostro (y a quiénes): son los que al día siguiente necesitarán a la gerencia
 * en la puerta.
 *
 * La enciende y la apaga quien configura el gimnasio (`settings:org`), con
 * motivo; queda en la bitácora. La dueña la consulta.
 */
export function ReglaDelRostro() {
  const { can } = useSession();
  const regla = useCarga(useCallback(() => api<FaceRule>('/access/face-rule'), []));
  const [cambiando, setCambiando] = useState(false);
  const [viendo, setViendo] = useState<{ branchId: string; name: string } | null>(null);
  const r = regla.datos;
  const sinRostro = r?.branches.reduce((a, b) => a + b.withoutFace, 0) ?? 0;

  return (
    <Card title="Entrar solo con rostro" data-testid="bio-regla"
      sub="Quien no tiene su rostro registrado no entra, salvo que la gerencia autorice esa visita.">
      {regla.error ? <ErrorCarga titulo="No se pudo consultar la regla" mensaje={regla.error} onReintentar={() => void regla.recargar()} />
        : !r ? <Skeleton h={120} r={12} />
          : (
            <div className="stack-sm">
              <div className="row gap-8 flex-wrap">
                {r.enabled ? <Badge tone="ok" dot>Encendida</Badge> : <Badge tone="warn" dot>Apagada</Badge>}
                {r.changedAt && <span className="small muted">desde el {fecha(r.changedAt)}{r.changedByName ? ` · ${r.changedByName}` : ''}</span>}
              </div>
              <p className="small">
                {r.enabled
                  ? 'Recepción ya no deja pasar con un motivo a quien no tiene rostro: la puerta lo detiene y la gerencia autoriza cada visita, desde «Por resolver en la puerta» o en el mostrador. Si la gerencia no está, firma la dueña.'
                  : 'Hoy, quien no tiene su rostro entra por recepción con un motivo. Enciéndela cuando ya puedas registrar rostros en recepción: desde ese momento cada visita sin rostro la autoriza la gerencia.'}
              </p>
              {r.branches.length === 0
                ? <p className="small muted">Ninguna de tus sucursales usa Biometría: la regla no pesa en ninguna.</p>
                : (
                  <dl className="bio-cifras" data-testid="bio-regla-sedes">
                    {r.branches.map((b) => (
                      <div key={b.branchId}>
                        <dt>{b.name}: sin rostro</dt>
                        <dd>
                          {b.withoutFace} de {b.canEnter}
                          {b.withoutFace > 0 && can('members:read') && <> · <button type="button" className="enlace-en-linea" onClick={() => setViendo({ branchId: b.branchId, name: b.name })}>ver quiénes</button></>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              <p className="tiny muted">Se cuentan los socios que hoy pueden entrar con su plan o su paquete, en su sucursal de casa. El pase del día, el de prueba y la clase suelta no piden rostro.</p>
              {can('settings:org') && (
                <div>
                  <Button variant="secondary" size="sm" icon={<ShieldCheck />} onClick={() => setCambiando(true)} data-testid="bio-regla-cambiar">
                    {r.enabled ? 'Apagar la regla' : 'Encender la regla'}
                  </Button>
                </div>
              )}
            </div>
          )}
      {cambiando && r && <CambiarRegla encender={!r.enabled} sinRostro={sinRostro} onClose={() => setCambiando(false)} onListo={() => { setCambiando(false); void regla.recargar(); }} />}
      {viendo && <QuienesFaltan sede={viendo} onClose={() => setViendo(null)} />}
    </Card>
  );
}

function CambiarRegla({ encender, sinRostro, onClose, onListo }: { encender: boolean; sinRostro: number; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [falta, setFalta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  async function guardar() {
    if (faltaMotivo(motivo)) { setFalta(true); return; }
    setEnCurso(true);
    setError(null);
    try {
      await api<FaceRule>('/access/face-rule', { method: 'PUT', body: JSON.stringify({ enabled: encender, reason: motivo.trim() }) });
      onListo();
    } catch (e) {
      setError(errorText(e, 'No se pudo cambiar la regla'));
    } finally { setEnCurso(false); }
  }

  return (
    <Dialog open onClose={onClose} error={error}
      title={encender ? 'Encender «entrar solo con rostro»' : 'Apagar «entrar solo con rostro»'}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={enCurso}>Cancelar</Button>
        <Button loading={enCurso} onClick={() => void guardar()} data-testid="bio-regla-confirmar">{encender ? 'Encender' : 'Apagar'}</Button>
      </>}>
      <div className="stack">
        {encender ? (
          <Callout tone="warn" title={sinRostro === 0 ? 'Todos los que hoy entran ya tienen su rostro' : `${sinRostro} ${sinRostro === 1 ? 'socio que hoy entra no tiene' : 'socios que hoy entran no tienen'} su rostro`}>
            Desde que la enciendas, quien no tenga su rostro registrado no entra por recepción con un motivo: en cada visita lo autoriza la gerencia (o la dueña con su firma), hasta que lo registre. Antes de encenderla, comprueba que en recepción ya se pueden registrar rostros.
          </Callout>
        ) : (
          <Callout tone="info">Al apagarla, quien no tiene su rostro vuelve a entrar por recepción con un motivo, sin pasar por la gerencia.</Callout>
        )}
        <CampoMotivo id="mot-regla-rostro" autoFocus value={motivo} label="Motivo del cambio" hint="Queda en la bitácora con tu nombre."
          onChange={(m) => { setMotivo(m); setFalta(false); }}
          motivos={encender ? ['Ya se registran rostros en recepción'] : ['La cámara o el motor no funcionan', 'Todavía no se pueden registrar rostros']}
          error={falta ? 'Escribe el motivo del cambio.' : null} />
      </div>
    </Dialog>
  );
}

function QuienesFaltan({ sede, onClose }: { sede: { branchId: string; name: string }; onClose: () => void }) {
  const carga = useCarga(useCallback(() => api<FaceRulePending>(`/access/face-rule/pending?branchId=${sede.branchId}&limit=100`), [sede.branchId]));
  const d = carga.datos;
  return (
    <Dialog open onClose={onClose} title={`Sin rostro · ${sede.name}`}
      sub="Socios que hoy pueden entrar y no tienen su rostro registrado en esta sucursal. Primero, quienes vinieron más recientemente."
      footer={<Button onClick={onClose}>Cerrar</Button>}>
      {carga.error ? <ErrorCarga titulo="No se pudo consultar la lista" mensaje={carga.error} onReintentar={() => void carga.recargar()} />
        : !d ? <Skeleton h={160} r={12} />
          : d.members.length === 0 ? <p className="small muted">Nadie: todos los que hoy entran aquí ya tienen su rostro.</p>
            : (
              <>
                <ul className="list bio-faltan" data-testid="bio-regla-faltan">
                  {d.members.map((m) => (
                    <li key={m.memberId} className="list-item">
                      <span className="flex-1 min-w-0">
                        <span className="strong block">{m.fullName}</span>
                        <span className="tiny muted block">{m.memberCode} · {m.lastVisitOn ? `última visita el ${fecha(m.lastVisitOn)}` : 'sin visitas registradas'}</span>
                      </span>
                      <Link href={`/socios/${m.memberId}?tab=biometria&registrar=rostro`} className="btn btn-secondary btn-sm"><ScanFace />Registrar</Link>
                    </li>
                  ))}
                </ul>
                {d.total > d.members.length && <p className="tiny muted mt-6">Se muestran {d.members.length} de {d.total}.</p>}
              </>
            )}
    </Dialog>
  );
}
