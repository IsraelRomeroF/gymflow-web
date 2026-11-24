'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CircleCheck, DoorOpen, ScanFace, ShieldCheck, X } from 'lucide-react';
import type { AccessGrantResult, AccessResolution } from '@gymflow/core/contracts';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { api, motivoDe } from '@/lib/api';
import { hora } from '@/lib/format';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession, useToast, errorText } from './session';
import { Button, ButtonLink, Callout, CampoMotivo, faltaMotivo } from './ui';
import { AutorizacionDialog, textoDeErrorDeFirma } from './autorizacion';
import type { Rechazo, RechazoResuelto } from './cobro/resolver-rechazo';

/*
 * LA ENTRADA DE QUIEN NO TIENE SU ROSTRO REGISTRADO (fase 3, bloque 3.3; D-06).
 *
 * «Un socio sin rostro registrado nunca entra, salvo que la gerencia lo
 * autorice en cada visita.» Cuando la puerta rechaza por eso
 * (`BIOMETRIC_REQUIRED`), su plan está en orden: lo que falta es el rostro. Las
 * salidas son tres, y ninguna es «déjalo pasar con motivo»:
 *
 *   · Registrar su rostro ahora (lo normal: un minuto, y ya no vuelve a pasar).
 *   · La gerencia autoriza ESTA visita, con motivo: en su propia sesión aquí
 *     mismo, o desde «Por resolver en la puerta» de su inicio (le llega aviso a
 *     su teléfono). Quien espera en el mostrador no tiene que hacer nada: esta
 *     pieza pregunta cada pocos segundos y sigue sola.
 *   · Si la gerencia no está, la firma de la dueña (aquí o desde su teléfono).
 *
 * Es el camino que hace válido el consentimiento biométrico: quien no quiere
 * dar su rostro tiene otra forma de entrar, y queda quién la autorizó y por qué.
 *
 * Se usa desde `useResolverRechazo` (la pieza única que resuelve un rechazo),
 * así sale igual en el diálogo «Entrada», en «Por resolver en la puerta» y en
 * la pantalla de excepción.
 */

const REVISAR_CADA_MS = 4000;

export function useAutorizarSinRostro(rechazo: Rechazo | null, opciones: { onNoPasa: () => void }): {
  /** Este rechazo es por falta de rostro: esta pieza se encarga. */
  activo: boolean;
  cuerpo: ReactNode; pie: ReactNode;
  resuelto: RechazoResuelto | null;
  yaResuelto: string | null;
} {
  const { can } = useSession();
  const toast = useToast();
  const activo = rechazo?.reason === 'BIOMETRIC_REQUIRED';
  const [modo, setModo] = useState<'veredicto' | 'motivo'>('veredicto');
  const [motivo, setMotivo] = useState('');
  const [faltaElMotivo, setFaltaElMotivo] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [enCurso, setEnCurso] = useState(false);
  const [resuelto, setResuelto] = useState<RechazoResuelto | null>(null);
  const [yaResuelto, setYaResuelto] = useState<string | null>(null);
  // Autorizada, pero la puerta dijo que no por otra cosa: nada quedó resuelto.
  const [otraNegativa, setOtraNegativa] = useState<string | null>(null);

  const puedeAutorizar = can('access:entry:authorize');
  const puedeRegistrar = can('access:biometric:enroll');
  // Quien registra el paso con la firma de la dueña es quien concede pasos en el mostrador.
  const puedePedirFirma = !puedeAutorizar && can('access:manual_grant');
  const decisionId = rechazo?.decisionId ?? null;

  // Quien no puede autorizar espera: en cuanto la gerencia lo hace desde su sesión, aquí se sabe.
  const esperando = activo && !puedeAutorizar && !resuelto && !yaResuelto && !firmando && !enCurso;
  useEffect(() => {
    if (!esperando || !decisionId) return;
    let vigente = true;
    const t = setInterval(() => {
      if (document.hidden) return;
      api<AccessResolution>(`/access/decisions/${decisionId}/resolution`).then((r) => {
        if (!vigente || !r.resolved) return;
        setResuelto({
          titulo: `${r.byName ?? 'La gerencia'} autorizó la entrada${r.at ? ` a las ${hora(r.at)}` : ''}. Puede pasar.`,
          detalle: 'La entrada ya quedó registrada.', veredicto: null, paymentId: null,
        });
      }).catch(() => undefined);
    }, REVISAR_CADA_MS);
    return () => { vigente = false; clearInterval(t); };
  }, [esperando, decisionId]);

  if (!rechazo || !activo) return { activo: false, cuerpo: null, pie: null, resuelto: null, yaResuelto: null };
  const r = rechazo;

  async function autorizar(approvalToken?: string, quienFirmo?: string) {
    setEnCurso(true);
    try {
      const g = await api<AccessGrantResult>(`/access/decisions/${r.decisionId}/grant`, {
        method: 'POST', body: JSON.stringify({ reason: motivo.trim(), ...(approvalToken ? { approvalToken } : {}) }),
      });
      if (g.outcome === 'GRANTED') {
        const quien = g.authorizedByName ?? quienFirmo ?? null;
        setResuelto({
          titulo: `Entrada autorizada${quien ? ` por ${quien}` : ''}. Puede pasar.`,
          detalle: [
            'Queda en la bitácora quién la autorizó y por qué.',
            g.consumedVisit ? 'Se descontó una visita de su paquete.' : null,
            g.reentry ? 'Ya había entrado hoy: no cuenta otra visita.' : null,
          ].filter(Boolean).join(' '),
          veredicto: null, paymentId: null,
        });
      } else {
        setModo('veredicto');
        setOtraNegativa(`La entrada se autorizó, pero la puerta dice que no: ${(DENIAL_REASON[g.reason ?? ''] ?? 'revisa su ficha').toLowerCase()}. No se registró ninguna entrada: cierra y vuelve a registrarla para resolver eso primero.`);
      }
    } catch (e) {
      if (motivoDe(e) === 'ALREADY_RESOLVED') setYaResuelto(errorText(e));
      else toast('error', approvalToken ? textoDeErrorDeFirma(e, 'No se pudo registrar la entrada') : errorText(e, 'No se pudo autorizar la entrada'));
    } finally { setEnCurso(false); }
  }

  const seguir = () => {
    if (faltaMotivo(motivo)) { setFaltaElMotivo(true); return; }
    if (puedeAutorizar) void autorizar(); else setFirmando(true);
  };

  let cuerpo: ReactNode;
  if (yaResuelto) {
    cuerpo = (
      <div className="entrada-veredicto" data-estado="neutro" aria-live="polite" data-testid="entrada-ya-resuelta">
        <CircleCheck />
        <div>
          <p className="entrada-titulo">Esta entrada ya se había resuelto</p>
          <p className="small muted">{yaResuelto}</p>
        </div>
      </div>
    );
  } else if (resuelto) {
    cuerpo = (
      <div className="entrada-veredicto" data-ok="true" aria-live="polite" data-testid="sin-rostro-autorizada">
        <CircleCheck />
        <div className="flex-1">
          <p className="entrada-titulo">{resuelto.titulo}</p>
          {resuelto.detalle && <p className="small">{resuelto.detalle}</p>}
        </div>
      </div>
    );
  } else if (modo === 'motivo') {
    cuerpo = (
      <div className="stack" data-testid="sin-rostro-motivo">
        <CampoMotivo id="mot-sin-rostro" autoFocus hint={null} value={motivo}
          label={puedeAutorizar ? 'Por qué entra hoy sin su rostro (queda con tu nombre)' : 'Por qué entra hoy sin su rostro (lo lee quien firma)'}
          onChange={(m) => { setMotivo(m); setFaltaElMotivo(false); }} motivos={textosDeMotivo('entradaSinRostro')}
          error={faltaElMotivo ? 'Elige o escribe el motivo: queda en la bitácora.' : null} />
        <p className="tiny muted">La autorización vale para su visita de hoy en esta sucursal. La próxima vez se vuelve a pedir, hasta que registre su rostro.</p>
      </div>
    );
  } else {
    cuerpo = (
      <div className="stack" data-testid="entrada-sin-rostro">
        <div className="entrada-veredicto" data-ok="false">
          <X />
          <div>
            <p className="entrada-titulo">No puede pasar: falta su rostro</p>
            <p className="small">Su plan está en orden, pero en esta sucursal se entra con el rostro. Regístralo ahora (un minuto) o que la gerencia autorice esta visita.</p>
          </div>
        </div>
        {otraNegativa && <Callout tone="warn">{otraNegativa}</Callout>}
        {!puedeAutorizar && !otraNegativa && (
          <Callout tone="info" title="Esta entrada solo la autoriza la gerencia">
            Ya le aparece en «Por resolver en la puerta», en su inicio, y se le avisó a su teléfono. En cuanto la autorice, esta pantalla sigue sola.
            {puedePedirFirma && ' Si la gerencia no está, la dueña puede firmar aquí o desde su teléfono.'}
          </Callout>
        )}
      </div>
    );
  }

  let pie: ReactNode = null;
  if (!resuelto && !yaResuelto) {
    if (modo === 'motivo') {
      pie = <>
        <Button variant="secondary" onClick={() => setModo('veredicto')} disabled={enCurso}>Atrás</Button>
        <Button icon={puedeAutorizar ? <DoorOpen /> : <ShieldCheck />} loading={enCurso} onClick={seguir} data-testid="sin-rostro-confirmar">
          {puedeAutorizar ? 'Autorizar y registrar la entrada' : 'Pedir la firma'}
        </Button>
      </>;
    } else {
      const principal = puedeRegistrar ? 'registrar' : 'autorizar';
      const tres = puedeRegistrar && (puedeAutorizar || puedePedirFirma) && !otraNegativa;
      const botones = <>
        <Button variant="ghost" onClick={opciones.onNoPasa} disabled={enCurso}>No pasa</Button>
        {(puedeAutorizar || puedePedirFirma) && !otraNegativa && (
          <Button variant={principal === 'autorizar' ? 'primary' : 'secondary'} icon={<ShieldCheck />} disabled={enCurso} onClick={() => setModo('motivo')} data-testid="sin-rostro-autorizar">
            {puedeAutorizar ? 'Autorizar esta visita' : 'Pedir la firma de la dueña'}
          </Button>
        )}
        {puedeRegistrar && <ButtonLink href={`/socios/${r.memberId}?tab=biometria&registrar=rostro`} variant="primary" icon={<ScanFace />}>Registrar su rostro</ButtonLink>}
      </>;
      // Tres botones no caben en un renglón del diálogo y el principal bajaba solo (3.13 D3; bloque 4.11):
      // el principal a todo lo ancho y los otros dos a la mitad, debajo. Con uno o dos, como siempre.
      pie = tres ? <div className="pie-tres">{botones}</div> : botones;
    }
  }

  // La firma de la dueña va en su propio diálogo, encima: aquí o desde su teléfono.
  if (firmando && !resuelto && !yaResuelto) {
    cuerpo = <>{cuerpo}
      <AutorizacionDialog permission="access:entry:authorize" branchId={r.branchId}
        operacion={{ resourceType: 'Member', resourceId: r.memberId }} motivo={motivo.trim()}
        titulo="Autorizar la entrada sin rostro" detalle={<>{r.memberName} no tiene su rostro registrado. Motivo: «{motivo.trim()}».</>}
        onClose={() => setFirmando(false)}
        onAutorizado={(token, quien) => { setFirmando(false); void autorizar(token, quien); }} /></>;
  }

  return { activo: true, cuerpo, pie, resuelto, yaResuelto };
}
