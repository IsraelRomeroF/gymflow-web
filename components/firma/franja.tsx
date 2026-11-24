'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Check, Smartphone, X } from 'lucide-react';
import type { ApprovalRequestState } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { Button, Dialog } from '../ui';
import { Desenlace, preguntaAbierta, reloj, type Firmante } from './desenlace';
import { abrirEspera, ponerEspera, quitarEspera, useEsperas, type Espera } from './espera';

/** Cada cuánto pregunta la franja por una espera que ningún diálogo atiende. */
const SONDEO_MS = 3000;

const minutosDe = (s: ApprovalRequestState) => Math.max(1, Math.round((Date.parse(s.expiresAt) - Date.parse(s.createdAt)) / 60_000));
/** Sin la lista de firmantes a la mano, el desenlace se dice con el nombre que se guardó al pedir. */
const firmantesDe = (e: Espera): Firmante[] => (e.quienes ? [{ userId: e.id, fullName: e.quienes, pausedUntil: null, reach: 'none' }] : []);

function tono(e: Espera): '' | 'franja-firma-danger' | 'franja-firma-warn' | 'franja-firma-ok' {
  switch (e.estado) {
    // Quien firma preguntó (D-03): hay algo que hacer aquí, contestarle.
    case 'PENDING': return e.solicitud && preguntaAbierta(e.solicitud) ? 'franja-firma-warn' : '';
    case 'REJECTED': return 'franja-firma-danger';
    case 'EXPIRED': case 'CANCELED': return 'franja-firma-warn';
    case 'APPROVED': return e.solicitud?.delivery === 'expired' ? 'franja-firma-warn' : 'franja-firma-ok';
    case 'LISTA': return 'franja-firma-ok';
  }
}

function texto(e: Espera, ahora: number): React.ReactNode {
  const quien = e.solicitud?.approverName || e.quienes || 'quien autoriza';
  switch (e.estado) {
    case 'PENDING': {
      const restan = e.limite === null ? null : Math.max(0, Math.round((e.limite - ahora) / 1000));
      if (e.solicitud && preguntaAbierta(e.solicitud)) {
        return <>{e.solicitud.question!.byName ?? e.quienes ?? 'quien autoriza'} te pregunta: «{e.solicitud.question!.text}» · contéstale en «Ver»{restan !== null && <> · <span className="num">{reloj(restan)}</span></>}</>;
      }
      return <>esperando a {e.quienes || 'quien puede autorizar'}{restan !== null && <> · <span className="num">{reloj(restan)}</span></>}</>;
    }
    case 'REJECTED': return <>{quien} no la autorizó</>;
    case 'EXPIRED': return <>sin respuesta: venció</>;
    case 'CANCELED': return <>se canceló</>;
    // La franja sabe que llegó la firma, no si la operación se registró: eso lo dice la pantalla que la pidió
    // (antes decía «la operación siguió» también cuando la caja la rechazaba; 2.14, D1).
    case 'LISTA': return <>listo: {quien} autorizó</>;
    case 'APPROVED':
      // Solo se llega aquí sin diálogo que la atienda: la persona cambió de pantalla.
      if (e.solicitud?.delivery === 'expired') return <>{quien} autorizó, pero su firma venció sin usarse: no se registró nada</>;
      if (e.solicitud?.delivery === 'used') return <>{quien} autorizó y la firma ya se usó</>;
      return <>{quien} ya autorizó: vuelve a la pantalla y repite la operación, la firma ya está dada</>;
  }
}

/**
 * LA FRANJA «SEGUIR ATENDIENDO» (D29-03, bloque 2.10): las firmas pedidas al
 * teléfono que el mostrador sigue esperando, bajo la barra superior del
 * panel. Mientras la pantalla que pidió la firma siga abierta, ella consulta
 * y la operación sigue sola; si la persona se fue a otra pantalla, consulta
 * la franja y dice el desenlace. «Ver» abre el diálogo con el resultado.
 */
export function FranjaDeFirmas() {
  const router = useRouter();
  const pathname = usePathname();
  const esperas = useEsperas();
  const visibles = esperas.filter((e) => e.minimizada || !e.atendida);
  const [ahora, setAhora] = useState(() => Date.now());
  const [viendo, setViendo] = useState<string | null>(null);

  const hayPendientes = visibles.some((e) => e.estado === 'PENDING');
  useEffect(() => {
    if (!hayPendientes) return;
    // El reloj de la franja estaba parado mientras no había nada que contar: se pone en hora antes del primer segundo.
    setAhora(Date.now());
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hayPendientes]);

  // Las que ningún diálogo atiende: la franja pregunta al servidor qué pasó.
  const sueltas = esperas
    .filter((e) => !e.atendida && (e.estado === 'PENDING' || (e.estado === 'APPROVED' && (e.solicitud === null || e.solicitud.delivery === 'ready'))))
    .map((e) => e.id).join(',');
  useEffect(() => {
    if (!sueltas) return;
    const ids = sueltas.split(',');
    const revisar = () => {
      for (const id of ids) {
        api<ApprovalRequestState>(`/approvals/requests/${id}`).then((s) => {
          // La firma que ya se usó es una operación registrada: no queda nada que esperar.
          if (s.status === 'APPROVED' && s.delivery === 'used') { quitarEspera(id); return; }
          ponerEspera({ id, estado: s.status, solicitud: s, limite: s.status === 'PENDING' ? Date.now() + s.secondsLeft * 1000 : null });
        }).catch((e) => {
          // De otra persona o ya no existe (otra cuenta en este navegador): se quita sin decir nada.
          if (e instanceof ApiError && (e.status === 404 || e.status === 401 || e.status === 403)) quitarEspera(id);
        });
      }
    };
    revisar();
    const t = setInterval(revisar, SONDEO_MS);
    return () => clearInterval(t);
  }, [sueltas]);

  if (visibles.length === 0) return null;
  const vista = viendo ? visibles.find((e) => e.id === viendo && e.solicitud) ?? null : null;
  const ver = (e: Espera) => { if (!abrirEspera(e.id)) setViendo(e.id); };
  const cancelar = async (e: Espera) => {
    await api(`/approvals/requests/${e.id}/cancel`, { method: 'POST', body: '{}' }).catch(() => undefined);
    quitarEspera(e.id); setViendo(null);
  };

  return (
    <div className="franja-firmas" role="region" aria-label="Autorizaciones que estás esperando">
      {visibles.map((e) => {
        const terminada = e.estado !== 'PENDING' && e.estado !== 'LISTA' && !(e.estado === 'APPROVED' && e.solicitud?.delivery !== 'expired');
        return (
          <div key={e.id} className={`franja-firma ${tono(e)}`} role="status">
            {e.estado === 'LISTA' ? <Check size={16} aria-hidden /> : <Smartphone size={16} aria-hidden />}
            <p className="franja-firma-texto"><strong>{e.titulo}</strong> · {texto(e, ahora)}</p>
            {e.estado === 'APPROVED' && !e.atendida && e.solicitud?.delivery !== 'expired' && e.ruta !== pathname && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push(e.ruta)}>Volver</button>
            )}
            {e.estado !== 'LISTA' && (e.atendida || e.estado !== 'APPROVED') && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => ver(e)}>Ver</button>
            )}
            {terminada && !e.atendida && (
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Quitar este aviso" onClick={() => quitarEspera(e.id)}><X size={16} /></button>
            )}
          </div>
        );
      })}
      {vista?.solicitud && (
        <Dialog open onClose={() => setViendo(null)} title={vista.titulo}
          footer={<>
            {vista.estado === 'PENDING'
              ? <Button variant="secondary" onClick={() => void cancelar(vista)}>Cancelar solicitud</Button>
              : <Button variant="secondary" onClick={() => { quitarEspera(vista.id); setViendo(null); }}>Entendido</Button>}
            {vista.ruta !== pathname && <Button onClick={() => { setViendo(null); router.push(vista.ruta); }}>Volver a donde se pidió</Button>}
          </>}>
          <div className="stack">
            <Desenlace s={vista.solicitud} firmantes={firmantesDe(vista)} restan={vista.limite === null ? null : Math.max(0, Math.round((vista.limite - ahora) / 1000))}
              minutos={minutosDe(vista.solicitud)} minutosFirma={5}
              onCambio={(s) => ponerEspera({ id: vista.id, estado: s.status, solicitud: s, limite: s.status === 'PENDING' ? Date.now() + s.secondsLeft * 1000 : null })} />
            {vista.estado === 'PENDING' && !preguntaAbierta(vista.solicitud) && (
              <p className="small muted">La pediste en otra pantalla. Cuando la autoricen, vuelve ahí y repite la operación: se usa esta misma firma, sin pedir otra.</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
