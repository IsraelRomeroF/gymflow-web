'use client';

import { useCallback, useState } from 'react';
import { KeyRound, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaHora, hora } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';
import { usePortalUrl } from '@/lib/portal';
import { useToast, errorText } from '@/components/session';
import { Button, Callout, Dialog } from '@/components/ui';
import { Qr } from '@/components/qr';

type Abiertos = { active: number; lastSeenAt: string | null };

/**
 * «PORTAL DE {NOMBRE}» (auditoría 8, bloque 2.2): un solo diálogo donde antes
 * había dos entradas del menú («Dar acceso al portal» y «Cerrar el portal en
 * sus teléfonos»). Arriba se ve en cuántos teléfonos lo tiene abierto, antes
 * de actuar: con eso recepción decide si hace falta otro código o si lo que
 * toca es cerrarlo (teléfono perdido, PS-02). Abajo, el código de un solo uso
 * con su QR, que se genera con el socio delante.
 *
 * Las reglas no cambian: un código nuevo no cierra lo abierto, y cerrar es en
 * todos sus teléfonos a la vez.
 */
export function PortalDelSocioDialog({ memberId, nombre, onClose }: { memberId: string; nombre: string; onClose: () => void }) {
  const portal = usePortalUrl();
  const toast = useToast();
  const abiertos = useCarga(useCallback(() => api<Abiertos>(`/members/${memberId}/portal-sessions`), [memberId]));
  const [inv, setInv] = useState<{ code: string; expiresAt: string } | null>(null);
  const [generando, setGenerando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const n = abiertos.datos?.active ?? null;

  async function generar() {
    setGenerando(true); setFallo(null);
    try {
      setInv(await api<{ code: string; expiresAt: string }>(`/members/${memberId}/portal-invite`, { method: 'POST', body: '{}' }));
    } catch (e) { setFallo(errorText(e, 'No se pudo generar el código')); } finally { setGenerando(false); }
  }

  async function cerrar() {
    setCerrando(true); setFallo(null);
    try {
      const r = await api<{ revoked: number }>(`/members/${memberId}/portal-sessions/revoke`, { method: 'POST', body: '{}' });
      toast('ok', r.revoked === 0 ? 'No tenía el portal abierto en ningún teléfono' : `Portal cerrado en ${r.revoked} ${r.revoked === 1 ? 'teléfono' : 'teléfonos'}`);
      setConfirmar(false);
      await abiertos.recargar();
    } catch (e) { setFallo(errorText(e, 'No se pudo cerrar el portal')); } finally { setCerrando(false); }
  }

  const ocupado = generando || cerrando;
  return (
    <Dialog open onClose={ocupado ? () => undefined : onClose} title={`Portal de ${nombre}`} error={fallo}
      sub="Su portal es la página que abre en su teléfono para ver su membresía, sus pagos y sus clases."
      footer={<Button variant="secondary" onClick={onClose} disabled={ocupado}>Cerrar</Button>}>
      <div className="stack">
        <section className="dialog-seccion" data-testid="portal-telefonos" data-estado={abiertos.cargando ? 'cargando' : 'listo'}>
          <p className="eyebrow row gap-6"><Smartphone size={14} />Sus teléfonos</p>
          <p className="small">
            {abiertos.error ? 'No se pudo consultar en cuántos teléfonos lo tiene abierto; cerrarlo sirve igual.'
              : n === null ? 'Revisando…'
                : n === 0 ? 'Ahora mismo no tiene el portal abierto en ningún teléfono.'
                  : <>Lo tiene abierto en <strong>{n} {n === 1 ? 'teléfono' : 'teléfonos'}</strong>{abiertos.datos?.lastSeenAt ? <>; el último se usó el {fechaHora(abiertos.datos.lastSeenAt)}</> : null}.</>}
          </p>
          {(abiertos.error || (n !== null && n > 0)) && (confirmar ? (
            <Callout tone="warn" title="¿Cerrarlo en todos sus teléfonos?">
              Para cuando perdió el teléfono o se lo robaron. Para volver a entrar necesitará un código nuevo.
              <div className="row wrap gap-8 mt-8">
                <Button size="sm" variant="danger" loading={cerrando} onClick={() => void cerrar()}>Cerrar en todos</Button>
                <Button size="sm" variant="secondary" disabled={cerrando} onClick={() => setConfirmar(false)}>No cerrar</Button>
              </div>
            </Callout>
          ) : (
            <div><Button size="sm" variant="danger-ghost" onClick={() => setConfirmar(true)}>Cerrar el portal en sus teléfonos</Button></div>
          ))}
        </section>

        <section className="dialog-seccion">
          <p className="eyebrow row gap-6"><KeyRound size={14} />Darle acceso</p>
          {!inv ? (
            <>
              <p className="small">
                Un código de un solo uso para activar el portal en su teléfono. Genéralo con el socio delante.
                {n !== null && n > 0 ? ' Ya lo tiene abierto: un código nuevo activa otro teléfono y no cierra los que ya tiene.' : ''}
              </p>
              <div><Button icon={<KeyRound />} loading={generando} onClick={() => void generar()}>Generar código</Button></div>
            </>
          ) : (
            <div className="stack items-center text-center">
              <p className="small muted">Código para {nombre} · sirve una sola vez</p>
              <div className="mono portal-codigo" data-testid="portal-codigo">{inv.code}</div>
              {/* El QR abre el portal con el código ya puesto. Va en el fragmento (#), que nunca llega al servidor ni a sus bitácoras. */}
              <Qr value={`${portal}/activar#${inv.code}`} size={168} />
              <p className="small muted">
                Que el socio escanee el código con la cámara de su teléfono, o que abra{' '}
                <code>{portal.replace(/^https?:\/\//, '')}</code>, toque <strong>Activar</strong> y escriba el código.
                Caduca a las {hora(inv.expiresAt)}. Generar otro invalida este.
              </p>
              <div><Button size="sm" variant="secondary" loading={generando} onClick={() => void generar()}>Generar otro</Button></div>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
