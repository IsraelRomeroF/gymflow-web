'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarX2, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { dia as diaDe, hora, hoyEn } from '@/lib/format';
import { zonaDe } from '@/lib/zonas';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, Dialog, Empty, EsqueletoLista } from '@/components/ui';
import { ApartarPagandoDialog, CobrarClaseDialog, textoDelApartado, type ApartadoCotizado } from '@/components/cobro-clase';
import type { MemberClassBookings } from '@gymflow/core/contracts';
import type { Sesion } from '@/lib/clases';

// `payNow` y `holdUntil`: D-16 (bloque 3.5, edición puntual).
type Cotizacion = { canBook: boolean; reason: string | null; requiresPayment: boolean; priceCents: string; priceLabel: string | null; dropInOnly?: boolean } & ApartadoCotizado;

/**
 * INSCRIBIR A UNA CLASE desde el mostrador: con el socio delante, recepción
 * ve las sesiones de los próximos siete días, cuántos lugares quedan, y si
 * la clase va incluida en su plan o cuánto se le carga, ANTES de confirmar.
 */
export function InscribirClaseDialog({ memberId, nombre, homeBranchId, onClose }: {
  memberId: string; nombre: string; homeBranchId: string | null; onClose: () => void;
}) {
  const toast = useToast();
  const { branches, inScope, activoEn, org } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id) && activoEn('classes', b.id));
  const [sede, setSede] = useState(homeBranchId && sedes.some((b) => b.id === homeBranchId) ? homeBranchId : sedes[0]?.id ?? '');
  // Días y horas, los de la sucursal elegida (puede estar en otra zona que el gimnasio).
  const zona = zonaDe(branches.find((b) => b.id === sede), org);
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<{ s: Sesion; q: Cotizacion } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [inscrito, setInscrito] = useState<Set<string>>(new Set());
  const [cobrarClase, setCobrarClase] = useState<{ s: Sesion; chargeId: string; priceCents: string } | null>(null);
  const [pagarAlApartar, setPagarAlApartar] = useState<{ s: Sesion; priceCents: string; porQue: 'OWES_MEMBERSHIP' | 'HOLD_CLOSED' } | null>(null);
  const puedeCobrar = useSession().can('payments:record');
  // Dónde ya tiene lugar se sabe AL ABRIR (11-04), no al cotizar cada clase.
  useEffect(() => {
    void api<MemberClassBookings>(`/members/${memberId}/bookings`)
      .then((r) => setInscrito((x) => new Set([...x, ...r.upcoming.map((b) => b.classScheduleId)])))
      // Sin esa lectura el diálogo sirve igual: la cotización sigue diciendo «ya tiene lugar».
      .catch(() => undefined);
  }, [memberId]);

  const cargar = useCallback(() => {
    if (!sede) { setSesiones([]); return; }
    setSesiones(null); setFallo(null);
    // Desde el inicio del día (MC-09): la clase que ya empezó sigue aquí hasta
    // que termina, para el socio que llega diez minutos tarde.
    const inicioDelDia = new Date(); inicioDelDia.setHours(0, 0, 0, 0);
    const desde = inicioDelDia.toISOString();
    const hasta = new Date(Date.now() + 7 * 86_400_000).toISOString();
    api<{ schedules: Sesion[] }>(`/classes/schedules?branchId=${sede}&from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`)
      // Las que se imparten: programadas y que no han terminado.
      .then((r) => setSesiones(r.schedules.filter((s) => s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() > Date.now())))
      .catch((e) => setFallo(errorText(e, 'No se pudieron cargar las clases')));
  }, [sede]);
  useEffect(cargar, [cargar]);

  const porDia = useMemo(() => {
    const m = new Map<string, Sesion[]>();
    for (const s of sesiones ?? []) {
      // El día del gimnasio, no el de la computadora (26-06).
      const k = diaDe(s.startsAt, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zona });
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [sesiones, zona]);

  async function cotizar(s: Sesion) {
    setOcupado(s.id);
    try {
      setPropuesta({ s, q: await api<Cotizacion>(`/classes/schedules/${s.id}/quote?memberId=${memberId}`) });
    } catch (e) { toast('error', errorText(e, 'No se pudo consultar')); } finally { setOcupado(null); }
  }

  async function inscribir(s: Sesion) {
    // D-16: quien debe su mensualidad, o con menos de una hora, solo la aparta pagándola en el momento.
    const q = propuesta?.s.id === s.id ? propuesta.q : null;
    if (q?.requiresPayment && q.payNow) {
      if (!puedeCobrar) { toast('error', `${textoDelApartado(q)} Pídeselo a quien cobra en recepción.`); return; }
      setPagarAlApartar({ s, priceCents: q.priceCents, porQue: q.payNow });
      return;
    }
    setOcupado(s.id);
    try {
      const r = await api<{ chargeId: string | null; priceCents: string }>(`/classes/schedules/${s.id}/bookings`, { method: 'POST', body: JSON.stringify({ memberId }) });
      setInscrito((x) => new Set(x).add(s.id));
      setSesiones((xs) => xs?.map((x) => (x.id === s.id ? { ...x, bookedCount: x.bookedCount + 1 } : x)) ?? null);
      setPropuesta(null);
      // Clase suelta: se cobra aquí mismo (MC-02), no en otra pantalla.
      if (r.chargeId && puedeCobrar) setCobrarClase({ s, chargeId: r.chargeId, priceCents: r.priceCents });
      else toast('ok', r.chargeId ? `${nombre} inscrito a ${s.className ?? 'la clase'} · clase suelta cargada a su cuenta` : `${nombre} inscrito a ${s.className ?? 'la clase'}`);
    } catch (e) { toast('error', errorText(e, 'No se pudo inscribir')); } finally { setOcupado(null); }
  }

  const hoy = diaDe(hoyEn(zona), { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
    <Dialog open size="lg" onClose={onClose} title={`Inscribir a ${nombre} a una clase`}
      sub="Las que se imparten en los próximos 7 días. Antes de confirmar ves si va incluida en su plan o cuánto se le carga."
      footer={<Button variant="secondary" onClick={onClose}>Listo</Button>}>
      <div className="stack" data-testid="inscribir-clase">
        {sedes.length > 1 && (
          <select className="select" aria-label="Sucursal" style={{ maxWidth: 240 }} value={sede} onChange={(e) => { setSede(e.target.value); setPropuesta(null); }}>
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {fallo ? <Callout tone="danger">{fallo}</Callout>
          : sesiones === null ? <EsqueletoLista filas={4} />
            : sesiones.length === 0 ? <Empty icon={<CalendarX2 />} title="No hay clases los próximos 7 días" text="Cuando la gerencia las agregue al horario aparecen aquí." />
              : porDia.map(([dia, xs]) => (
                <div key={dia}>
                  <p className="label" style={{ marginBottom: 6 }}>{dia === hoy ? `Hoy · ${dia}` : dia.charAt(0).toUpperCase() + dia.slice(1)}</p>
                  <ul className="list card shadow-none">
                    {xs.map((s) => {
                      const libres = s.capacity - s.bookedCount;
                      const yaEmpezo = new Date(s.startsAt).getTime() <= Date.now();
                      const q = propuesta?.s.id === s.id ? propuesta.q : null;
                      return (
                        <Fragment key={s.id}>
                        <li className="list-item" data-sesion={s.id} aria-current={q ? 'true' : undefined}>
                          <span className="num strong" style={{ width: 52 }}>{hora(s.startsAt, zona)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="strong small">{s.className}</div>
                            <div className="tiny muted row gap-8">
                              {s.room && <span className="row gap-3"><MapPin size={11} />{s.room}</span>}
                              <span>{libres > 0 ? `${libres} ${libres === 1 ? 'lugar libre' : 'lugares libres'}` : 'Llena'}</span>
                              {yaEmpezo && <span>· ya empezó</span>}
                            </div>
                          </div>
                          {inscrito.has(s.id)
                            ? <Badge tone="ok" dot>Inscrito</Badge>
                            : q ? null : <Button size="sm" variant="secondary" icon={<CalendarCheck />} disabled={libres <= 0} loading={ocupado === s.id}
                                onClick={() => void cotizar(s)}>{libres <= 0 ? 'Llena' : 'Inscribir'}</Button>}
                        </li>
                        {/* La cotización se despliega en la fila elegida (UX7 Mostrador 7), con un solo texto. */}
                        {q && (
                          <li className="list-item cotizacion-fila" data-testid="cotizacion" data-tono={!q.canBook ? 'danger' : q.requiresPayment ? 'warn' : 'ok'}>
                            <span className="small flex-1 min-w-0">{
                              !q.canBook ? `No se puede inscribir: ${q.reason}`
                                : q.requiresPayment ? `${q.dropInOnly ? 'No tiene plan vigente para esa fecha: la toma como clase suelta y, pagada, entra solo a esa clase.' : 'No va incluida en su plan.'} Clase suelta ${q.priceLabel}: ${puedeCobrar ? 'se cobra ahora' : 'se carga a su cuenta'}. ${textoDelApartado(q, zona)}`
                                  : 'Incluida en su plan · sin costo'}</span>
                            <div className="row gap-8">
                              <Button size="sm" variant="ghost" onClick={() => setPropuesta(null)}>{q.canBook ? 'Cancelar' : 'Cerrar'}</Button>
                              {q.canBook && (
                                <Button size="sm" loading={ocupado === s.id} onClick={() => void inscribir(s)}>
                                  {q.requiresPayment ? (puedeCobrar ? `Inscribir y cobrar ${q.priceLabel}` : `Inscribir y cargar ${q.priceLabel}`) : 'Confirmar inscripción'}
                                </Button>
                              )}
                            </div>
                          </li>
                        )}
                        </Fragment>
                      );
                    })}
                  </ul>
                </div>
              ))}
      </div>
    </Dialog>
      {pagarAlApartar && sede && (
        <ApartarPagandoDialog memberId={memberId} nombre={nombre} scheduleId={pagarAlApartar.s.id} priceCents={pagarAlApartar.priceCents} porQue={pagarAlApartar.porQue}
          branchId={sede} clase={pagarAlApartar.s.className ?? 'la clase'} onClose={() => setPagarAlApartar(null)}
          onListo={() => {
            const s = pagarAlApartar.s;
            setInscrito((x) => new Set(x).add(s.id));
            setSesiones((xs) => xs?.map((x) => (x.id === s.id ? { ...x, bookedCount: x.bookedCount + 1 } : x)) ?? null);
            setPropuesta(null); setPagarAlApartar(null);
          }} />
      )}
      {cobrarClase && sede && (
        <CobrarClaseDialog memberId={memberId} nombre={nombre} chargeId={cobrarClase.chargeId} priceCents={cobrarClase.priceCents}
          branchId={sede} clase={cobrarClase.s.className ?? 'la clase'} onClose={() => setCobrarClase(null)} />
      )}
    </>
  );
}
