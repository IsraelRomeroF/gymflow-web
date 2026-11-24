'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { COACH_CODE, type CoachClaimed } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { errorText, useSession, useToast } from '@/components/session';
import { Button, Callout, Dialog, Field } from '@/components/ui';

/**
 * «HACERME SU COACH» (D-29, fase 3, bloque 3.8).
 *
 * El coach solo ve a sus socios, así que no puede buscar a uno nuevo. El
 * socio que no tiene coach genera un código en su teléfono (Rutina → «¿Ya
 * tienes coach?») y se lo dicta en persona; el coach lo teclea aquí y el socio
 * pasa a ser suyo. No hay lista ni buscador: sin código no hay socio.
 *
 * El error sale en el pie del diálogo y dice cuántos intentos quedan; con
 * demasiados fallos la API lo deja en espera una hora y lo dice.
 */
export function HacermeSuCoach({ alLigar }: { alLigar?: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ligado, setLigado] = useState<CoachClaimed | null>(null);
  if (!can('members:coach:claim')) return null;

  const completo = codigo.length === COACH_CODE.digits;
  function cerrar() { if (enviando) return; setAbierto(false); setCodigo(''); setError(null); setLigado(null); }
  async function ligar() {
    if (!completo) { setError(`El código son ${COACH_CODE.digits} números.`); return; }
    setEnviando(true); setError(null);
    try {
      const r = await api<CoachClaimed>('/coach/claim', { method: 'POST', body: JSON.stringify({ code: codigo }) });
      setLigado(r);
      toast('ok', `Ya eres coach de ${r.fullName}`);
      alLigar?.();
    } catch (e) { setCodigo(''); setError(errorText(e, 'No se pudo usar el código')); } finally { setEnviando(false); }
  }

  return (
    <>
      <Button size="sm" variant="secondary" icon={<UserPlus />} onClick={() => setAbierto(true)} data-testid="hacerme-su-coach">Hacerme su coach</Button>
      {abierto && (
        <Dialog open onClose={cerrar} title="Hacerme su coach" error={error}
          sub="Para un socio que todavía no tiene coach y está contigo."
          footer={ligado
            ? <><Button variant="secondary" onClick={cerrar}>Cerrar</Button><Link className="btn btn-primary" href={`/socios/${ligado.memberId}`}>Abrir su ficha</Link></>
            : <><Button variant="secondary" disabled={enviando} onClick={cerrar}>Cancelar</Button><Button loading={enviando} disabled={!completo} onClick={() => void ligar()}>Hacerme su coach</Button></>}>
          {ligado ? (
            <Callout tone="ok" title={`Ya eres coach de ${ligado.fullName}`}>
              {ligado.memberCode ? <>Su código de socio es <code>{ligado.memberCode}</code>. </> : null}Ya aparece en «Mis socios» y puedes darle su rutina.
            </Callout>
          ) : (
            <div className="stack">
              <p className="small">Pídele que abra <strong>Rutina</strong> en su teléfono y toque <strong>«Generar código para mi coach»</strong>. Te dicta {COACH_CODE.digits} números; el código sirve una sola vez y dura {COACH_CODE.minutes} minutos.</p>
              <Field label="Código que te dicta el socio" htmlFor="hc-codigo">
                <input id="hc-codigo" className="input num codigo-coach" inputMode="numeric" autoComplete="off" autoFocus maxLength={COACH_CODE.digits}
                  placeholder={'0'.repeat(COACH_CODE.digits)} value={codigo}
                  onChange={(e) => { setCodigo(e.target.value.replace(/\D/g, '').slice(0, COACH_CODE.digits)); setError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void ligar(); }} />
              </Field>
              <p className="tiny muted">Si el socio no usa el portal o ya tiene coach, la gerencia lo asigna desde su ficha.</p>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
