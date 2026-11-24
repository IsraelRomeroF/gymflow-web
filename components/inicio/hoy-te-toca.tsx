'use client';

import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';
import { ArrowRight, CalendarX, CircleCheck, DoorOpen, FileSignature, HeartHandshake, Inbox, ScanFace, Sparkles, Stamp, UserRoundPlus, UserX, Wallet } from 'lucide-react';
import type { AsuntoDelInicio, MeHome, RenglonDelInicio } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { hora } from '@/lib/format';
import { CONSENT_TYPE } from '@/lib/labels';
import { useCarga } from '@/lib/carga';
import { menuPara } from '@/modules/registro';
import { useSession } from '@/components/session';
import { Card, ErrorCarga, Skeleton } from '@/components/ui';
import { IconTile } from '@/components/compartido';

const n = (cuantos: number, uno: string, varios: string) => `${cuantos.toLocaleString('es-MX')} ${cuantos === 1 ? uno : varios}`;

type Texto = { icono: ReactNode; titulo: string; texto: string; href: string | null };

/** Las palabras, el icono y el destino de cada asunto. El servidor decide cuáles existen y en qué orden. */
function textoDe(r: RenglonDelInicio): Texto {
  switch (r.key) {
    case 'signatures': return {
      icono: <Stamp />, href: null,
      titulo: r.count === 1 ? 'Una firma que pediste espera al dueño' : `${r.count} firmas que pediste esperan al dueño`,
      texto: `${r.until ? `${r.count === 1 ? 'Vence' : 'La primera vence'} a las ${hora(r.until)}. ` : ''}El dueño la da desde su teléfono, en Autorizaciones.`,
    };
    case 'door': return {
      icono: <DoorOpen />, href: '/socios', titulo: `${n(r.count, 'rechazo', 'rechazos')} en la puerta sin resolver`,
      texto: 'Cóbrale y abre, déjalo pasar con motivo o confirma que no pasa.',
    };
    case 'registers': return {
      icono: <Wallet />, href: '/caja', titulo: r.count === 1 ? 'Una caja sigue abierta desde un día anterior' : `${r.count} cajas siguen abiertas desde un día anterior`,
      texto: `Falta el corte: ${r.detail.join(', ')}${r.count > r.detail.length ? ' y más' : ''}.`,
    };
    case 'biometrics': return {
      icono: <ScanFace />, href: '/biometria', titulo: n(r.count, 'plantilla biométrica vencida', 'plantillas biométricas vencidas'),
      // Solo las de un lector de sucursal: las de la cámara se borran al revocar (ADR-040).
      texto: 'De un lector de sucursal: revocadas hace más de 30 días y sin confirmación de borrado.',
    };
    case 'debts': return {
      icono: <UserX />, href: '/socios?adeudo=1', titulo: `${n(r.count, 'socio suspendido', 'socios suspendidos')} con adeudo por decidir`,
      texto: 'Su periodo ya terminó y siguen suspendidos: cóbrales o decide su adeudo desde su ficha.',
    };
    case 'texts': {
      // Lo que ya se pidió publicar y espera la firma de la dueña no «falta publicar» (3.12, D-25).
      const esperan = new Set(r.waiting ?? []);
      const faltan = r.detail.filter((t) => !esperan.has(t));
      const nombres = (ts: readonly string[]) => ts.map((t) => CONSENT_TYPE[t] ?? t).join(', ');
      if (esperan.size > 0 && faltan.length === 0) return {
        icono: <FileSignature />, href: '/consentimientos', titulo: 'El aviso de privacidad espera la firma de la dueña',
        texto: 'Ya pediste publicarlo: no se publica hasta que ella lo lea y lo firme. Mientras tanto no se puede dar de alta a nadie.',
      };
      return {
        icono: <FileSignature />, href: '/consentimientos', titulo: n(faltan.length, 'texto sin publicar', 'textos sin publicar'),
        texto: `Falta: ${nombres(faltan)}.${esperan.size > 0 ? ` Espera la firma de la dueña: ${nombres([...esperan])}.` : ''} Sin texto publicado no se pueden recoger firmas ni registrar rostros.`,
      };
    }
    case 'classes': return {
      icono: <CalendarX />, href: '/clases', titulo: `${n(r.count, 'clase de hoy', 'clases de hoy')} sin coach`,
      texto: 'Asígnale quién la da o cancélala antes de que llegue la gente.',
    };
    case 'intakes': return {
      icono: <Inbox />, href: '/altas', titulo: `${n(r.count, 'alta digital', 'altas digitales')} por revisar`,
      texto: 'Los socios ya capturaron sus datos; solo falta confirmar.',
    };
    case 'coachless': return {
      // D-29 (3.16): recepción lo elige al alta; lo que quedó sin coach lo pone la gerencia desde la ficha.
      icono: <UserRoundPlus />, href: '/socios', titulo: r.count === 1 ? 'Un socio nuevo sigue sin coach' : `${r.count.toLocaleString('es-MX')} socios nuevos siguen sin coach`,
      texto: `Se ${r.count === 1 ? 'dio' : 'dieron'} de alta esta semana: ${r.detail.join(', ')}${r.count > r.detail.length ? ' y más' : ''}. Ponle su coach desde su ficha.`,
    };
    case 'prospects': return {
      icono: <Sparkles />, href: '/prospectos', titulo: `${n(r.count, 'interesado', 'interesados')} por atender`,
      texto: 'Les toca seguimiento hoy o nadie los ha contactado todavía.',
    };
    case 'retention': return {
      icono: <HeartHandshake />, href: '/retencion', titulo: `${n(r.count, 'socio', 'socios')} en riesgo de irse`,
      texto: 'Dejaron de venir o están aflojando: la lista de a quién llamar está en Retención.',
    };
  }
}

/** La bandeja del inicio, para que la página y sus tarjetas la compartan (y la recarguen tras resolver algo). */
export function useBandejaDelInicio() {
  return useCarga(useCallback(() => api<MeHome>('/me/home'), []), { conservar: true });
}

/**
 * «HOY TE TOCA» (auditoría 8, bloque 2.1; 1-01, DA-21): lo que esta persona
 * puede resolver hoy, por urgencia. Lo arma el servidor en una llamada
 * (`GET /me/home`): cada renglón existe solo si su puesto lo resuelve y su
 * módulo está encendido. Antes el panel hacía cinco peticiones y al gerente le
 * salía «Todo al día» con rechazos sin resolver y cajas de ayer.
 *
 * Un renglón lleva a su pantalla solo si esta persona la tiene en su menú.
 */
export function HoyTeToca({ carga, titulo = 'Hoy te toca', sub = 'Lo que puedes resolver hoy, primero lo que detiene al mostrador.', omitir = [] }: {
  carga: ReturnType<typeof useBandejaDelInicio>;
  titulo?: string; sub?: string;
  /** Asuntos que esta pantalla ya muestra de otra forma (la puerta tiene su tarjeta; los textos, la lista de arranque). */
  omitir?: readonly AsuntoDelInicio[];
}) {
  const { mirada } = useSession();
  const rutas = new Set(menuPara(mirada).map((s) => s.href));
  const datos = carga.datos;
  const items = datos?.items.filter((i) => !omitir.includes(i.key)) ?? [];
  const sinRevisar = datos?.unchecked.filter((k) => !omitir.includes(k)) ?? [];

  return (
    <Card title={titulo} sub={sub} pad={false} data-testid="hoy-te-toca">
      {carga.error !== null && <div className="card-body"><ErrorCarga titulo="No se pudo revisar lo pendiente" mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>}
      {carga.error === null && !datos && <div className="card-body stack-sm"><Skeleton h={48} /><Skeleton h={48} /></div>}
      {datos && sinRevisar.length > 0 && (
        <div className="card-body"><ErrorCarga mensaje="No se pudo revisar todo lo pendiente: la lista puede estar incompleta." onReintentar={() => void carga.recargar()} /></div>
      )}
      {datos && items.length === 0 && sinRevisar.length === 0 && (
        <div className="list-item">
          <IconTile tone="ok"><CircleCheck /></IconTile>
          <div>
            <p className="strong">Todo al día</p>
            <p className="small muted">No hay nada pendiente de revisar.</p>
          </div>
        </div>
      )}
      <ul className="list">
        {items.map((r) => {
          const t = textoDe(r);
          const cuerpo = (
            <>
              <IconTile tone={r.tone}>{t.icono}</IconTile>
              <div className="flex-1 min-w-0">
                <p className="strong">{t.titulo}</p>
                <p className="small muted">{t.texto}</p>
              </div>
            </>
          );
          const destino = t.href && rutas.has(t.href.split('?')[0]!) ? t.href : null;
          return (
            <li key={r.key} data-asunto={r.key}>
              {destino
                ? <Link href={destino} className="list-item is-link no-underline">{cuerpo}<ArrowRight size={16} className="muted" /></Link>
                : <div className="list-item">{cuerpo}</div>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
