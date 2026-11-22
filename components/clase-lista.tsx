'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, UserCheck, UserPlus, Search, X, Wallet, Pencil } from 'lucide-react';
import type { ClassSettings, MemberSummary, SessionBooking, SessionBookings } from '@gymflow/core/contracts';
import { ElegirCoach } from '@/components/coach-clase';
import { api } from '@/lib/api';
import { fechaCorta, hora } from '@/lib/format';
import { zonaDe } from '@/lib/zonas';
import { momentoDeClase, plazoEnTexto, textoDePago, type Sesion } from '@/lib/clases';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Dialog, Empty, MenuMas, Skeleton, ErrorCarga } from '@/components/ui';
import { CobrarClaseDialog } from '@/components/cobro-clase';
import { useBuscarSocios } from '@/lib/buscar-socios';

// Siguen saliendo de aquí para quien ya los importaba; viven en `lib/clases.ts`.
export { momentoDeClase, type Sesion };

type Cotizacion = { canBook: boolean; reason: string | null; requiresPayment: boolean; priceLabel: string | null; dropInOnly?: boolean };
type Hallado = Pick<MemberSummary, 'id' | 'firstName' | 'lastName' | 'memberCode'>;
/** A quién se le cobra la clase suelta, y si al cobrar se marca su llegada. */
type Cobro = { memberId: string; nombre: string; chargeId: string; priceCents: string; marcar: string | null; reciente: boolean };

/**
 * LISTA DE LA SESIÓN: quién viene, quién debe la clase y el pase de lista.
 *
 * Arriba, la ocupación y cuántos lugares siguen por pagar; el cuerpo es la
 * lista de socios. La fila de una clase suelta sin pagar dice «Por pagar
 * $150» y, para quien cobra, su botón es «Cobrar y marcar» (11-03): en un
 * gimnasio sin torniquete esta lista es la puerta. El buscador para inscribir
 * vive detrás de «Inscribir a un socio» (antes robaba el foco y empujaba la
 * lista).
 */
export function ListaDialog({ sesion, branchId, onClose, inscribiendo = false }: {
  sesion: Sesion; branchId: string; onClose: () => void;
  /** Abre con el buscador de inscripción ya desplegado (se llegó con «Inscribir»). */
  inscribiendo?: boolean;
}) {
  const toast = useToast();
  // La dueña ve la lista sin poder reservar ni pasar lista.
  const { can, branches, org } = useSession();
  const zona = zonaDe(branches.find((b) => b.id === branchId), org);
  const opera = can('classes:book_for_member');
  const puedeCobrar = can('payments:record');
  const gestiona = can('classes:manage');
  const [reservas, setReservas] = useState<SessionBooking[] | null>(null);
  const [falloLista, setFalloLista] = useState<string | null>(null);
  const [cobrar, setCobrar] = useState<Cobro | null>(null);
  const [buscando, setBuscando] = useState(inscribiendo);
  const [q, setQ] = useState('');
  const busqueda = useBuscarSocios(q, { delay: 180 });
  const hallados = busqueda.hallados ?? [];
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Antes de cargarle nada al socio, recepción ve si va incluida o cuánto cuesta.
  const [propuesta, setPropuesta] = useState<{ h: Hallado; q: Cotizacion } | null>(null);
  const [coach, setCoach] = useState<string | null>(sesion.coachUserId ?? null);
  // Quitar una reserva libera el lugar: se confirma nombrando a la persona (11-16).
  const [quitando, setQuitando] = useState<SessionBooking | null>(null);
  // Por qué se quita, si se dice: queda en la bitácora (11-02).
  const [motivoQuitar, setMotivoQuitar] = useState('');
  const [cupo, setCupo] = useState(sesion.capacity);
  const [cupoNuevo, setCupoNuevo] = useState<string | null>(null);
  // El plazo para cancelar sin falta lo fija cada gimnasio (11-08): el aviso lo cita.
  const [plazo, setPlazo] = useState<number | null>(null);
  useEffect(() => { void api<ClassSettings>('/classes/settings').then((r) => setPlazo(r.rules.cancelCutoffMinutes)).catch(() => undefined); }, []);

  const cargar = useCallback(async () => {
    setFalloLista(null);
    const r = await api<SessionBookings>(`/classes/schedules/${sesion.id}/bookings`);
    setReservas(r.bookings.filter((b) => b.status !== 'CANCELED'));
  }, [sesion.id]);
  // Un fallo de red no es "nadie ha reservado" (MC-16): se dice y se reintenta.
  useEffect(() => { void cargar().catch((e) => setFalloLista(errorText(e, 'No se pudo cargar la lista'))); }, [cargar]);

  async function cotizar(h: Hallado) {
    setOcupado(h.id);
    try {
      const c = await api<Cotizacion>(`/classes/schedules/${sesion.id}/quote?memberId=${h.id}`);
      setPropuesta({ h, q: c });
    } catch (e) { toast('error', errorText(e, 'No se pudo consultar')); } finally { setOcupado(null); }
  }

  async function reservar(h: Hallado) {
    setOcupado(h.id);
    try {
      const r = await api<{ chargeId: string | null; priceCents: string }>(`/classes/schedules/${sesion.id}/bookings`, { method: 'POST', body: JSON.stringify({ memberId: h.id }) });
      // Clase suelta: se cobra aquí mismo (MC-02).
      if (r.chargeId && puedeCobrar) setCobrar({ memberId: h.id, nombre: h.firstName, chargeId: r.chargeId, priceCents: r.priceCents, marcar: null, reciente: true });
      else toast('ok', r.chargeId ? `${h.firstName} inscrito · clase suelta cargada a su cuenta` : `${h.firstName} inscrito`);
      setQ(''); setPropuesta(null); await cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo reservar')); } finally { setOcupado(null); }
  }

  async function quitar(b: SessionBooking) {
    setOcupado(b.id);
    try {
      const motivo = motivoQuitar.trim();
      const r = await api<{ chargeVoided: boolean; paidChargeKept: boolean; lateChargeKept?: boolean }>(`/classes/bookings/${b.id}/cancel`, {
        method: 'POST', body: JSON.stringify(motivo ? { reason: motivo } : {}),
      });
      // Lo que pasó con el cargo, dicho como es (11-02): pasado el plazo, la clase suelta no se anula.
      toast('ok', r.chargeVoided ? 'Reserva quitada · se anuló el cargo de la clase suelta'
        : r.paidChargeKept ? 'Reserva quitada · la clase ya estaba pagada: si corresponde, devuélvela desde su ficha'
          : r.lateChargeKept ? `Reserva quitada · ya había pasado el plazo${plazo ? ` (${plazoEnTexto(plazo)} antes)` : ''}: el cargo de la clase suelta no se anula (si no la pagó, la sigue debiendo)`
            : 'Reserva quitada · el lugar quedó libre');
      setQuitando(null);
      setMotivoQuitar('');
      await cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo quitar la reserva')); } finally { setOcupado(null); }
  }

  async function llego(bookingId: string) {
    setOcupado(bookingId);
    try {
      await api(`/classes/bookings/${bookingId}/checkin`, { method: 'POST', body: '{}' });
      await cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo registrar su llegada')); } finally { setOcupado(null); }
  }

  async function guardarCupo() {
    const n = Number(cupoNuevo);
    if (!Number.isInteger(n) || n < 1) { toast('error', 'El cupo es un número de lugares, de 1 en adelante'); return; }
    setOcupado('cupo');
    try {
      await api(`/classes/schedules/${sesion.id}/capacity`, { method: 'PATCH', body: JSON.stringify({ capacity: n }) });
      setCupo(n); setCupoNuevo(null);
      toast('ok', `Cupo de esta sesión: ${n} lugares`);
    } catch (e) { toast('error', errorText(e, 'No se pudo cambiar el cupo')); } finally { setOcupado(null); }
  }

  const momento = momentoDeClase(sesion);
  const programada = sesion.status === 'SCHEDULED' && momento !== 'TERMINADA';
  const listaAbierta = momento === 'LISTA' || momento === 'EN_CURSO';
  const ocupados = reservas?.length ?? sesion.bookedCount;
  const llenos = ocupados >= cupo;
  const porPagar = (reservas ?? []).filter((b) => b.payment === 'PENDING').length;
  const llegaron = (reservas ?? []).filter((b) => b.checkedInAt || b.status === 'ATTENDED').length;
  const faltaron = (reservas ?? []).filter((b) => b.status === 'NO_SHOW').length;
  const cuando = `${fechaCorta(sesion.startsAt, zona)} ${hora(sesion.startsAt, zona)}`;

  /** Lo que se puede hacer con una fila, según el momento y el puesto. */
  function acciones(b: SessionBooking) {
    const nombre = b.fullName ?? 'este socio';
    const debe = b.payment === 'PENDING' && puedeCobrar && b.chargeId && b.memberId;
    const cobro = (marcar: boolean): Cobro => ({
      memberId: b.memberId!, nombre: b.fullName?.split(' ')[0] ?? 'el socio', chargeId: b.chargeId!, priceCents: b.pendingCents, marcar: marcar ? b.id : null, reciente: false,
    });
    if (b.status === 'NO_SHOW') return <Badge tone="danger" dot>Faltó</Badge>;
    if (b.checkedInAt || b.status === 'ATTENDED') {
      return (
        <div className="row gap-6">
          <Badge tone="ok" dot>Llegó</Badge>
          {debe && sesion.status === 'SCHEDULED' && <Button size="sm" variant="secondary" icon={<Wallet />} onClick={() => setCobrar(cobro(false))}>Cobrar {b.pendingLabel}</Button>}
        </div>
      );
    }
    if (!opera || !programada || b.hidden) return <Badge>Reservado</Badge>;
    const quitarItem = momento === 'PROXIMA' || momento === 'LISTA'
      ? { label: 'Quitar reserva', icon: <X />, peligro: true, onClick: () => setQuitando(b) } : null;
    if (listaAbierta) {
      return (
        <div className="row gap-6 lista-acciones">
          {debe
            ? <Button size="sm" icon={<Wallet />} loading={ocupado === b.id} onClick={() => setCobrar(cobro(true))}>Cobrar y marcar</Button>
            : <Button size="sm" icon={<UserCheck />} loading={ocupado === b.id} onClick={() => void llego(b.id)}>Llegó</Button>}
          {(debe || quitarItem) && (
            <MenuMas tam="sm" etiqueta={`Más acciones de ${nombre}`} items={[
              debe ? { label: 'Marcar su llegada sin cobrar', icon: <UserCheck />, onClick: () => void llego(b.id) } : null,
              quitarItem,
            ]} />
          )}
        </div>
      );
    }
    return (
      <div className="row gap-6 lista-acciones">
        {debe ? <Button size="sm" variant="secondary" icon={<Wallet />} onClick={() => setCobrar(cobro(false))}>Cobrar {b.pendingLabel}</Button> : <Badge>Reservado</Badge>}
        {quitarItem && <MenuMas tam="sm" etiqueta={`Más acciones de ${nombre}`} items={[quitarItem]} />}
      </div>
    );
  }

  return (
    <>
    <Dialog open size="lg" onClose={onClose} title={`${sesion.className} · ${cuando}`}
      sub={[sesion.room, sesion.templateId === null ? 'Sesión única' : null].filter(Boolean).join(' · ') || undefined}>
      <div className="stack" data-testid="lista-sesion">
        <div className="lista-cabecera">
          <div>
            <p className="lista-ocupacion num">{ocupados}<span className="muted"> / {cupo}</span></p>
            <p className="small muted">
              {ocupados === 1 ? 'lugar reservado' : 'lugares reservados'}
              {porPagar > 0 && <> · <strong className="lista-por-pagar">{porPagar} por pagar</strong></>}
              {(sesion.status === 'CLOSED' || momento === 'TERMINADA') && reservas && reservas.length > 0 && <> · {llegaron} {llegaron === 1 ? 'asistió' : 'asistieron'} · {faltaron} {faltaron === 1 ? 'faltó' : 'faltaron'}</>}
            </p>
          </div>
          <div className="lista-cabecera-fin">
            {/* Quién la imparte: un suplente se pone aquí, solo para esta clase. */}
            {gestiona && programada
              ? <ElegirCoach id={`coach-${sesion.id}`} url={`/classes/schedules/${sesion.id}/coach`} valor={coach} branchId={branchId} etiqueta="Imparte" onCambio={(c) => setCoach(c)} />
              : <p className="small"><span className="muted">Imparte:</span> {sesion.coachName ?? 'sin coach asignado'}</p>}
            {gestiona && programada && (cupoNuevo === null
              ? <button type="button" className="row-link small" onClick={() => setCupoNuevo(String(cupo))}><Pencil size={12} /> Cambiar el cupo</button>
              : (
                <div className="row gap-6">
                  <input className="input num lista-cupo" inputMode="numeric" aria-label="Cupo de esta sesión" autoFocus value={cupoNuevo} onChange={(e) => setCupoNuevo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void guardarCupo(); }} />
                  <Button size="sm" loading={ocupado === 'cupo'} onClick={() => void guardarCupo()}>Guardar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCupoNuevo(null)}>Cancelar</Button>
                </div>
              ))}
          </div>
        </div>

        {opera && programada && (llenos
          ? <p className="small muted">La clase está llena. Para inscribir a alguien más, {gestiona ? 'sube el cupo o quita una reserva' : 'hay que quitar una reserva o pedir a la gerencia que suba el cupo'}.</p>
          : buscando ? (
            <div className="input-icon">
              <Search />
              <input className="input" autoFocus aria-label="Inscribir a un socio" placeholder="Inscribir a un socio: nombre, código o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          ) : <div><Button variant="secondary" icon={<UserPlus />} onClick={() => setBuscando(true)}>Inscribir a un socio</Button></div>)}
        {buscando && q.trim().length === 1 && <p className="tiny muted">Escribe al menos 2 letras para buscar.</p>}
        {propuesta && (
          <Callout tone={!propuesta.q.canBook ? 'danger' : propuesta.q.requiresPayment ? 'warn' : 'ok'}>
            <div className="stack-sm">
              <span><strong>{propuesta.h.firstName} {propuesta.h.lastName}</strong> · {
                !propuesta.q.canBook ? `No se puede inscribir: ${propuesta.q.reason}`
                  : propuesta.q.requiresPayment ? `${propuesta.q.dropInOnly ? 'Sin plan vigente: ' : 'No va en su plan: '}clase suelta ${propuesta.q.priceLabel} · ${puedeCobrar ? 'se cobra ahora' : 'se carga a su cuenta'}`
                    : 'Incluida en su plan · sin costo'}</span>
              <div className="row gap-8">
                {propuesta.q.canBook && (
                  <Button size="sm" loading={ocupado === propuesta.h.id} onClick={() => void reservar(propuesta.h)}>
                    {propuesta.q.requiresPayment ? (puedeCobrar ? `Inscribir y cobrar ${propuesta.q.priceLabel}` : `Inscribir y cargar ${propuesta.q.priceLabel}`) : 'Confirmar inscripción'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setPropuesta(null)}>{propuesta.q.canBook ? 'Cancelar' : 'Cerrar'}</Button>
              </div>
            </div>
          </Callout>
        )}
        {buscando && hallados.length > 0 && !propuesta && (
          <ul className="list card shadow-none">
            {hallados.map((h) => (
              <li key={h.id} className="list-item">
                <div className="flex-1"><span className="strong small">{h.firstName} {h.lastName}</span> <code className="tiny muted">{h.memberCode}</code></div>
                <Button size="sm" icon={<UserPlus />} loading={ocupado === h.id} disabled={reservas?.some((r) => r.memberId === h.id)}
                  onClick={() => void cotizar(h)}>{reservas?.some((r) => r.memberId === h.id) ? 'Ya inscrito' : 'Inscribir'}</Button>
              </li>
            ))}
          </ul>
        )}

        {falloLista ? <ErrorCarga mensaje={falloLista} onReintentar={() => { setReservas(null); void cargar().catch((e) => setFalloLista(errorText(e, 'No se pudo cargar la lista'))); }} />
          : reservas === null ? <Skeleton h={120} /> : reservas.length === 0 ? (
          <Empty icon={<Users />} title="Nadie ha reservado" text={opera ? 'Los socios reservan desde su teléfono; también puedes inscribirlos aquí.' : 'Los socios reservan desde su teléfono o en recepción.'} />
        ) : (
          <ul className="list lista-socios">
            {reservas.map((b) => (
              // En el teléfono, el nombre arriba y sus botones abajo, dentro de su renglón.
              <li key={b.id} className="list-item se-apila" data-pago={b.payment}>
                <div className="flex-1 min-w-0 fila-titulo">
                  <div className="strong small">{b.fullName ?? 'Socio'}</div>
                  <div className="tiny muted row gap-8 flex-wrap">
                    {b.memberCode && <span>{b.memberCode}</span>}
                    {!b.hidden && b.payment !== 'PENDING' && <span>{textoDePago(b.payment, null)}</span>}
                  </div>
                </div>
                {!b.hidden && b.payment === 'PENDING' && <Badge tone="warn" dot>{textoDePago('PENDING', b.pendingLabel)}{!puedeCobrar ? ' · recepción' : ''}</Badge>}
                {acciones(b)}
              </li>
            ))}
          </ul>
        )}
        {momento === 'PROXIMA' && (reservas?.length ?? 0) > 0 && <p className="tiny muted">El pase de lista se abre una hora antes de la clase.</p>}
        {momento === 'EN_CURSO' && <p className="tiny muted">Puedes pasar lista hasta 30 minutos después de que termine; luego, quien no llegó cuenta como falta.</p>}
        {momento === 'TERMINADA' && <p className="tiny muted">El pase de lista ya se cerró.</p>}
      </div>
    </Dialog>
    {cobrar && (
      <CobrarClaseDialog memberId={cobrar.memberId} nombre={cobrar.nombre} chargeId={cobrar.chargeId} priceCents={cobrar.priceCents}
        branchId={branchId} clase={sesion.className ?? 'la clase'}
        sub={cobrar.reciente ? undefined : cobrar.marcar ? 'Al cobrar se marca su llegada.' : 'Tiene su lugar apartado y todavía no la paga.'}
        despues={cobrar.reciente ? 'Cobrar después' : 'Volver'}
        onCobrado={async () => { if (cobrar.marcar) await llego(cobrar.marcar); else await cargar(); }}
        onClose={() => setCobrar(null)} />
    )}
    {quitando && (
      <Dialog open onClose={() => { if (ocupado !== quitando.id) { setQuitando(null); setMotivoQuitar(''); } }}
        title={`¿Quitar la reserva de ${quitando.fullName ?? 'este socio'}?`}
        sub={`${sesion.className ?? 'Clase'} · ${cuando}${quitando.memberCode ? ` · ${quitando.memberCode}` : ''}`}
        footer={<><Button variant="secondary" disabled={ocupado === quitando.id} onClick={() => { setQuitando(null); setMotivoQuitar(''); }}>Cancelar</Button>
          <Button variant="danger" icon={<X />} loading={ocupado === quitando.id} onClick={() => void quitar(quitando)}>Quitar reserva</Button></>}>
        <div className="stack">
          <p className="small">Su lugar queda libre para alguien más y no le cuenta como falta. {
            quitando.payment === 'PAID' ? 'Ya pagó la clase: quitarla no le devuelve el dinero; si corresponde, se devuelve desde su ficha.'
              : quitando.payment === 'PENDING' ? (plazo === 0 ? `Su cargo de ${quitando.pendingLabel ?? 'la clase suelta'} se anula.`
                : `Su cargo de ${quitando.pendingLabel ?? 'la clase suelta'} se anula si todavía falta más de ${plazo ? plazoEnTexto(plazo) : 'el plazo de cancelación'} para la clase; después de eso, lo sigue debiendo.`)
                : ''}</p>
          <CampoMotivo id="quitar-motivo" label="Motivo (opcional)" required={false} value={motivoQuitar} onChange={setMotivoQuitar} placeholder="Se equivocó de horario" />
        </div>
      </Dialog>
    )}
    </>
  );
}
