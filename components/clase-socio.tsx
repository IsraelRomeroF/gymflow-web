'use client';

import { useCallback, useState } from 'react';
import { CalendarCheck, CalendarX2, Wallet, X } from 'lucide-react';
import type { ClassSettings, MemberClassBooking, MemberClassBookings } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { dia, fecha, hora } from '@gymflow/ui/format';
import { zonaDe } from '@/lib/zonas';
import { useCarga } from '@gymflow/ui/carga';
import { plazoEnTexto, textoDePago } from '@/lib/clases';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, Empty, ErrorCarga, EsqueletoLista, MenuMas } from '@/components/ui';
import { CobrarClaseDialog } from '@/components/cobro-clase';
import { InscribirClaseDialog } from '@/components/inscribir-clase';

const RECIENTES = 4;

/**
 * LAS CLASES DEL SOCIO, EN SU FICHA (11-04).
 *
 * La ficha es el centro del mostrador y no sabía nada de clases: para ver si
 * alguien tenía lugar el jueves había que ir a Clases, abrir la sesión y
 * buscarlo en la lista. Aquí están lo que viene (con su pago, «Cobrar» y
 * «Quitar reserva»), lo de los últimos 30 días (asistió, faltó, canceló) y,
 * si sus reservas están bloqueadas por faltas, hasta cuándo.
 */
export function ClasesSocioCard({ memberId, nombre, homeBranchId, archivado = false, version = 0, onDinero }: {
  memberId: string; nombre: string; homeBranchId: string | null; archivado?: boolean;
  /** Algo de aquí movió su cuenta (se cobró una clase, se anuló un cargo, se le cargó una): la ficha vuelve a pedir su saldo. */
  onDinero?: () => void;
  /** Cambia cuando la ficha hizo algo que puede mover sus clases (se inscribió desde arriba, se cobró). */
  version?: number;
}) {
  const toast = useToast();
  const { can, mirada, branches, org } = useSession();
  const ve = can('classes:read') && mirada.activo('classes');
  const inscribe = can('classes:book_for_member') && !archivado;
  const cobra = can('payments:record');
  const carga = useCarga<MemberClassBookings>(useCallback(
    () => api<MemberClassBookings>(`/members/${memberId}/bookings`),
    // `version` no entra en la consulta: solo la vuelve a pedir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memberId, version],
  ), { conservar: true });
  const [inscribiendo, setInscribiendo] = useState(false);
  const [cobrar, setCobrar] = useState<MemberClassBooking | null>(null);
  const [quitando, setQuitando] = useState<MemberClassBooking | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [todas, setTodas] = useState(false);
  const [plazo, setPlazo] = useState<number | null>(null);

  if (!ve) return null;
  const zonaDeSede = (branchId: string) => zonaDe(branches.find((b) => b.id === branchId), org);
  const cuando = (b: MemberClassBooking) => `${dia(b.startsAt, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zonaDeSede(b.branchId) })} · ${hora(b.startsAt, zonaDeSede(b.branchId))}`;

  function pedirQuitar(b: MemberClassBooking) {
    setQuitando(b); setMotivo('');
    if (plazo === null) void api<ClassSettings>('/classes/settings').then((r) => setPlazo(r.rules.cancelCutoffMinutes)).catch(() => undefined);
  }

  async function quitar(b: MemberClassBooking) {
    setEnviando(true);
    try {
      const r = await api<{ chargeVoided: boolean; paidChargeKept: boolean; lateChargeKept?: boolean }>(`/classes/bookings/${b.id}/cancel`, {
        method: 'POST', body: JSON.stringify(motivo.trim() ? { reason: motivo.trim() } : {}),
      });
      toast('ok', r.chargeVoided ? 'Reserva quitada · se anuló el cargo de la clase suelta'
        : r.paidChargeKept ? 'Reserva quitada · la clase ya estaba pagada: si corresponde, devuélvela desde «Estado de cuenta»'
          : r.lateChargeKept ? 'Reserva quitada · ya había pasado el plazo: el cargo de la clase suelta no se anula (si no la pagó, la sigue debiendo)'
            : 'Reserva quitada · el lugar quedó libre');
      setQuitando(null);
      if (r.chargeVoided) onDinero?.();
      await carga.recargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo quitar la reserva')); } finally { setEnviando(false); }
  }

  const d = carga.datos;
  const recientes = d ? (todas ? d.recent : d.recent.slice(0, RECIENTES)) : [];
  const estado = (b: MemberClassBooking) => (b.status === 'ATTENDED' ? <Badge tone="ok" dot>Asistió</Badge>
    : b.status === 'NO_SHOW' ? <Badge tone="danger" dot>Faltó</Badge>
      : b.status === 'CANCELED' ? <Badge tone={b.lateCancel ? 'warn' : 'neutral'}>{b.lateCancel ? 'Canceló tarde' : 'Cancelada'}</Badge>
        : <Badge>Sin cerrar</Badge>);

  return (
    <>
      <Card title="Clases" data-testid="ficha-clases" pad={false}
        actions={inscribe && <Button size="sm" variant="secondary" icon={<CalendarCheck />} onClick={() => setInscribiendo(true)}>Inscribir a clase</Button>}>
        {carga.error ? <div className="card-body"><ErrorCarga mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>
          : !d ? <EsqueletoLista filas={2} />
            : (
              <>
                {d.block && (
                  <div className="ficha-clases-aviso">
                    <Callout tone="warn" title={`Sin reservar hasta el ${fecha(d.block.until)}`}>
                      Sus reservas están bloqueadas por {d.block.noShowCount} {d.block.noShowCount === 1 ? 'falta' : 'faltas'}. No es un cargo: después de esa fecha vuelve a reservar.
                    </Callout>
                  </div>
                )}
                {d.upcoming.length === 0 && d.recent.length === 0 ? (
                  <Empty icon={<CalendarX2 />} title="Sin clases" text={`${nombre} no tiene lugar en ninguna clase ni tomó alguna en los últimos 30 días.`} />
                ) : (
                  <>
                    <p className="label ficha-clases-titulo">Lo que viene</p>
                    {d.upcoming.length === 0 ? <p className="small muted ficha-clases-vacio">No tiene lugar apartado en ninguna clase.</p> : (
                      <ul className="list">
                        {d.upcoming.map((b) => (
                          <li key={b.id} className="list-item se-apila" data-reserva={b.id}>
                            <div className="flex-1 min-w-0 fila-titulo">
                              <div className="strong small">{b.className ?? 'Clase'}</div>
                              <div className="tiny muted ficha-clases-cuando">{cuando(b)}{b.branchId !== homeBranchId && b.branchName ? ` · ${b.branchName}` : ''}{b.coachName ? ` · ${b.coachName}` : ''}</div>
                            </div>
                            <Badge tone={b.payment === 'PENDING' ? 'warn' : 'neutral'} dot={b.payment === 'PENDING'}>{textoDePago(b.payment, b.pendingLabel)}</Badge>
                            {b.payment === 'PENDING' && cobra && b.chargeId && <Button size="sm" icon={<Wallet />} onClick={() => setCobrar(b)}>Cobrar</Button>}
                            {b.checkedInAt && <Badge tone="ok" dot>Llegó</Badge>}
                            {inscribe && !b.checkedInAt && new Date(b.startsAt).getTime() > Date.now() && (
                              <MenuMas tam="sm" etiqueta={`Más acciones de ${b.className ?? 'la clase'}`} items={[{ label: 'Quitar reserva', icon: <X />, peligro: true, onClick: () => pedirQuitar(b) }]} />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {d.recent.length > 0 && (
                      <>
                        <p className="label ficha-clases-titulo">Últimos 30 días</p>
                        <ul className="list">
                          {recientes.map((b) => (
                            <li key={b.id} className="list-item">
                              <div className="flex-1 min-w-0">
                                <div className="small">{b.className ?? 'Clase'}</div>
                                <div className="tiny muted ficha-clases-cuando">{cuando(b)}</div>
                              </div>
                              {b.payment === 'PENDING' && b.status !== 'CANCELED' && <Badge tone="warn">{textoDePago('PENDING', b.pendingLabel)}</Badge>}
                              {estado(b)}
                            </li>
                          ))}
                        </ul>
                        {d.recent.length > RECIENTES && (
                          <div className="ficha-clases-mas"><button type="button" className="row-link small" onClick={() => setTodas(!todas)}>{todas ? 'Ver menos' : `Ver las ${d.recent.length}`}</button></div>
                        )}
                      </>
                    )}
                  </>
                )}
                {!d.block && d.noShows.count > 0 && (
                  <p className="tiny muted ficha-clases-pie">{d.noShows.count} {d.noShows.count === 1 ? 'falta' : 'faltas'} en {d.noShows.windowDays} días (cuentan las cancelaciones fuera de plazo). Con {d.noShows.blockAt} se bloquean sus reservas.</p>
                )}
              </>
            )}
      </Card>

      {inscribiendo && <InscribirClaseDialog memberId={memberId} nombre={nombre} homeBranchId={homeBranchId} onClose={() => { setInscribiendo(false); onDinero?.(); void carga.recargar(); }} />}
      {cobrar && cobrar.chargeId && (
        <CobrarClaseDialog memberId={memberId} nombre={nombre} chargeId={cobrar.chargeId} priceCents={cobrar.pendingCents} branchId={cobrar.branchId}
          clase={cobrar.className ?? 'la clase'} sub="Tiene su lugar apartado y todavía no la paga." despues="Volver"
          onCobrado={() => { onDinero?.(); return carga.recargar(); }} onClose={() => setCobrar(null)} />
      )}
      {quitando && (
        <Dialog open size="sm" onClose={() => { if (!enviando) setQuitando(null); }}
          title={`¿Quitar la reserva de ${nombre}?`} sub={`${quitando.className ?? 'Clase'} · ${cuando(quitando)}`}
          footer={<><Button variant="secondary" disabled={enviando} onClick={() => setQuitando(null)}>Cancelar</Button>
            <Button variant="danger" icon={<X />} loading={enviando} onClick={() => void quitar(quitando)}>Quitar reserva</Button></>}>
          <div className="stack">
            <p className="small">Su lugar queda libre para alguien más y no le cuenta como falta. {
              quitando.payment === 'PAID' ? 'Ya pagó la clase: quitarla no le devuelve el dinero; si corresponde, se devuelve desde «Estado de cuenta».'
                : quitando.payment === 'PENDING' ? (plazo === 0 ? `Su cargo de ${quitando.pendingLabel ?? 'la clase suelta'} se anula.`
                  : `Su cargo de ${quitando.pendingLabel ?? 'la clase suelta'} se anula si todavía falta más de ${plazo ? plazoEnTexto(plazo) : 'el plazo de cancelación'} para la clase; después de eso, lo sigue debiendo.`)
                  : ''}</p>
            <CampoMotivo id="ficha-quitar-motivo" label="Motivo (opcional)" required={false} value={motivo} onChange={setMotivo} placeholder="Se equivocó de horario" />
          </div>
        </Dialog>
      )}
    </>
  );
}
