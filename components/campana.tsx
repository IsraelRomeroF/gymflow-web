'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { OUTBOUND_KINDS, type OutboundSummary } from '@gymflow/core/contracts';
import { MOTIVO_DE_MENSAJE } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { useSession } from './session';
import { useEnNavegador } from './dialogo';

/** Mandar mensajes desde la lista: recepción y gerencia. Ni la dueña ni el coach (D-30). */
export const PERMISO_DE_MENSAJES = 'members:message:send';
/** Lo dispara «Mensajes» al mandar o descartar uno: la campana se pone al día sin esperar su vuelta. */
export const EVENTO_MENSAJES = 'gymflow:mensajes';
/** Cada cuánto vuelve a preguntar con el panel abierto. */
const CADA_MS = 5 * 60_000;

/**
 * LA CAMPANA DEL PANEL (auditoría 8, bloque 2.9).
 *
 * Dice, en cualquier pantalla, cuántos mensajes hay por mandar a los socios y
 * de qué son; el toque lleva a «Mensajes». Solo existe para quien los manda:
 * recepción (sus sedes) y gerencia (todo). La dueña y el coach no la ven: las
 * alertas de la dueña son de la fase 4 (D-05) y entrarán aquí.
 */
export function Campana() {
  const { can } = useSession();
  return can(PERMISO_DE_MENSAJES) ? <CampanaDeMensajes /> : null;
}

function CampanaDeMensajes() {
  const pathname = usePathname();
  const [resumen, setResumen] = useState<OutboundSummary | null>(null);
  const [fallo, setFallo] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const enNavegador = useEnNavegador();

  const cargar = useCallback(() => {
    api<OutboundSummary>('/outbound/summary')
      .then((r) => { setResumen(r); setFallo(false); })
      // Sin red no se inventa un cero: se dice que no se pudo revisar.
      .catch(() => setFallo(true));
  }, []);

  useEffect(() => {
    cargar();
    const cadaTanto = setInterval(() => { if (document.visibilityState === 'visible') cargar(); }, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener(EVENTO_MENSAJES, cargar);
    return () => { clearInterval(cadaTanto); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener(EVENTO_MENSAJES, cargar); };
  }, [cargar]);

  // Navegar la cierra.
  useEffect(() => { setAbierta(false); }, [pathname]);
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => { const t = e.target as Node; if (!caja.current?.contains(t) && !panel.current?.contains(t)) setAbierta(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierta(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierta]);

  // Lo que despliega va en `body`, fijo y por encima de todo lo del marco (la franja de firmas,
  // la barra inferior del teléfono): bajo el botón, pegado a su derecha, sin salirse de la pantalla.
  useLayoutEffect(() => {
    if (!abierta) return;
    const colocar = () => {
      const b = caja.current?.getBoundingClientRect(); const l = panel.current;
      if (!b || !l) return;
      l.style.top = `${b.bottom + 8}px`;
      l.style.left = `${Math.max(8, Math.min(b.right - l.offsetWidth, window.innerWidth - 8 - l.offsetWidth))}px`;
    };
    colocar();
    window.addEventListener('resize', colocar);
    return () => window.removeEventListener('resize', colocar);
  }, [abierta, resumen, fallo]);

  const total = resumen?.total ?? 0;
  const motivos = OUTBOUND_KINDS.filter((k) => (resumen?.counts[k] ?? 0) > 0);
  const etiqueta = total > 0 ? `Mensajes por mandar: ${total}` : 'Sin mensajes por mandar';
  return (
    <div className="campana" ref={caja}>
      <button type="button" className="btn btn-ghost btn-icon campana-boton" data-testid="campana-mensajes"
        aria-label={etiqueta} title={etiqueta} aria-haspopup="dialog" aria-expanded={abierta}
        onClick={() => { if (!abierta) cargar(); setAbierta((v) => !v); }}>
        <Bell />
        {total > 0 && <span className="campana-cuenta" aria-hidden>{total > 99 ? '99+' : total}</span>}
      </button>
      {abierta && enNavegador && createPortal(
        <div className="campana-panel" role="dialog" aria-label="Mensajes por mandar" ref={panel} data-testid="campana-panel">
          <p className="campana-titulo">Mensajes por mandar</p>
          {fallo && resumen === null ? (
            <p className="small muted campana-vacio">No se pudo revisar. <button type="button" className="enlace-en-linea" onClick={cargar}>Reintentar</button></p>
          ) : resumen === null ? (
            <p className="small muted campana-vacio">Revisando…</p>
          ) : total === 0 ? (
            <p className="small muted campana-vacio">Nada por mandar.{resumen.sentToday > 0 ? ` Hoy se ${resumen.sentToday === 1 ? 'mandó 1' : `mandaron ${resumen.sentToday}`}.` : ''}</p>
          ) : (
            <>
              <ul className="campana-lista">
                {motivos.map((k) => (
                  <li key={k}>
                    <Link href={`/mensajes#grupo-${k}`} className="campana-renglon" data-tono={MOTIVO_DE_MENSAJE[k]?.tone}>
                      <span className="campana-renglon-cifra num">{resumen.counts[k]}</span>
                      <span>{resumen.counts[k] === 1 ? MOTIVO_DE_MENSAJE[k]?.label : MOTIVO_DE_MENSAJE[k]?.plural}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {resumen.sentToday > 0 && <p className="tiny muted campana-pie">Hoy se {resumen.sentToday === 1 ? 'mandó 1' : `mandaron ${resumen.sentToday}`}.</p>}
            </>
          )}
          <Link href="/mensajes" className="btn btn-secondary btn-sm btn-block">Ir a Mensajes</Link>
        </div>,
        document.body,
      )}
    </div>
  );
}
