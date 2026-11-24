'use client';

import { useCallback, useState } from 'react';
import { CalendarOff, Pencil, Scale } from 'lucide-react';
import type { ClassPause, ClassPauseCreated, ClassPauseEnded, ClassPauses, ClassRules, ClassSettings } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, fechaCorta } from '@/lib/format';
import { hoyEn, masDias, zonaDe } from '@/lib/zonas';
import { useCarga } from '@/lib/carga';
import { plazoEnTexto } from '@/lib/clases';
import { useFormulario } from '@/lib/formulario';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Callout, CampoFecha, CampoMotivo, Card, Dialog, ERROR_MOTIVO, ErrorCarga, faltaMotivo, Field, Opciones, Skeleton } from '@/components/ui';

/** Los mismos rangos que `BOOKING_RULE_LIMITS` del núcleo; la API los vuelve a comprobar. */
const LIMITES: Record<Exclude<keyof ClassRules, 'cancelCutoffMinutes'>, { min: number; max: number }> = {
  maxDaysAhead: { min: 1, max: 21 }, noShowWindowDays: { min: 7, max: 90 }, noShowsBeforeBlock: { min: 1, max: 10 }, blockDays: { min: 1, max: 60 },
};
const PLAZOS = [0, 30, 60, 90, 120, 180, 240, 360, 720, 1440, 2880];
const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

/** Las reglas dichas como se le dirían a un socio. */
function enPalabras(r: ClassRules): string[] {
  return [
    `Se reserva con hasta ${dias(r.maxDaysAhead)} de antelación.`,
    r.cancelCutoffMinutes === 0 ? 'Cancelar no cuenta como falta mientras la clase no empiece.' : `Cancelar no cuenta como falta hasta ${plazoEnTexto(r.cancelCutoffMinutes)} antes de la clase.`,
    `${r.noShowsBeforeBlock} ${r.noShowsBeforeBlock === 1 ? 'falta' : 'faltas'} en ${dias(r.noShowWindowDays)} ${r.noShowsBeforeBlock === 1 ? 'bloquea' : 'bloquean'} sus reservas ${dias(r.blockDays)}. El bloqueo nunca es dinero.`,
  ];
}

/**
 * REGLAS DE RESERVA DEL GIMNASIO (11-08). Antes vivían escritas en el código,
 * iguales para todos. Aquí se leen (todo el personal: el mostrador las cita)
 * y las cambia quien arma las clases de todo el gimnasio y maneja precios.
 */
export function ReglasCard() {
  const { canOrg } = useSession();
  const carga = useCarga<ClassSettings>(useCallback(() => api<ClassSettings>('/classes/settings'), []), { conservar: true });
  const [editar, setEditar] = useState(false);
  const cambia = canOrg('classes:manage') && canOrg('catalog:manage');
  const d = carga.datos;
  return (
    <>
      <Card title="Reglas de reserva" data-testid="reglas-de-reserva"
        sub={d ? (d.isDefault ? 'Las que trae GymFlow; este gimnasio no las ha cambiado.' : `Cambiadas el ${fecha(d.updatedAt)}${d.updatedByName ? ` por ${d.updatedByName}` : ''}.`) : undefined}
        actions={cambia && d && <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditar(true)}>Cambiar</Button>}>
        {carga.error ? <ErrorCarga mensaje={carga.error} onReintentar={() => void carga.recargar()} />
          : !d ? <Skeleton h={72} />
            : (
              <ul className="reglas-lista">
                {enPalabras(d.rules).map((t) => <li key={t}><Scale size={14} aria-hidden />{t}</li>)}
              </ul>
            )}
        {d && !cambia && <p className="tiny muted mt-12">Las cambia quien arma las clases de todo el gimnasio y maneja precios y planes.</p>}
      </Card>
      {editar && d && <ReglasDialog actual={d} onClose={() => setEditar(false)} onDone={(nuevas) => { carga.poner(nuevas); setEditar(false); }} />}
    </>
  );
}

function ReglasDialog({ actual, onClose, onDone }: { actual: ClassSettings; onClose: () => void; onDone: (s: ClassSettings) => void }) {
  const toast = useToast();
  const [v, setV] = useState<Record<keyof ClassRules, string>>({
    maxDaysAhead: String(actual.rules.maxDaysAhead), cancelCutoffMinutes: String(actual.rules.cancelCutoffMinutes),
    noShowWindowDays: String(actual.rules.noShowWindowDays), noShowsBeforeBlock: String(actual.rules.noShowsBeforeBlock), blockDays: String(actual.rules.blockDays),
  });
  const poner = (k: keyof ClassRules) => (texto: string) => setV((x) => ({ ...x, [k]: texto }));
  const fuera = (k: keyof typeof LIMITES) => {
    const n = Number(v[k]);
    return (!/^\d+$/.test(v[k].trim()) || n < LIMITES[k].min || n > LIMITES[k].max) && `Un número entre ${LIMITES[k].min} y ${LIMITES[k].max}.`;
  };
  const f = useFormulario({ maxDaysAhead: fuera('maxDaysAhead'), noShowWindowDays: fuera('noShowWindowDays'), noShowsBeforeBlock: fuera('noShowsBeforeBlock'), blockDays: fuera('blockDays') });
  const nuevas: ClassRules = {
    maxDaysAhead: Number(v.maxDaysAhead), cancelCutoffMinutes: Number(v.cancelCutoffMinutes),
    noShowWindowDays: Number(v.noShowWindowDays), noShowsBeforeBlock: Number(v.noShowsBeforeBlock), blockDays: Number(v.blockDays),
  };
  const deFabrica = (Object.keys(actual.defaults) as Array<keyof ClassRules>).every((k) => String(actual.defaults[k]) === v[k]);
  const plazos = PLAZOS.includes(actual.rules.cancelCutoffMinutes) ? PLAZOS : [...PLAZOS, actual.rules.cancelCutoffMinutes].sort((a, b) => a - b);

  async function guardar() {
    try {
      const r = await api<ClassSettings>('/classes/settings', { method: 'PUT', body: JSON.stringify(nuevas) });
      toast('ok', 'Reglas de reserva guardadas. Valen desde ahora para todas las sucursales.');
      onDone(r);
    } catch (e) { toast('error', errorText(e, 'No se pudieron guardar las reglas')); }
  }

  const numero = (k: keyof typeof LIMITES, label: string, hint: string) => (
    <Field label={label} htmlFor={`rg-${k}`} hint={hint} error={f.error(k)}>
      <input id={`rg-${k}`} className="input num" inputMode="numeric" value={v[k]} onChange={(e) => poner(k)(e.target.value)} />
    </Field>
  );
  return (
    <Dialog open onClose={onClose} title="Reglas de reserva"
      sub="Valen para todas las sucursales, en el teléfono del socio y en el mostrador, desde que las guardas. Un bloqueo que ya está puesto no se acorta ni se alarga."
      footer={<>
        {!deFabrica && <Button variant="ghost" disabled={f.enviando} onClick={() => setV(Object.fromEntries(Object.entries(actual.defaults).map(([k, n]) => [k, String(n)])) as Record<keyof ClassRules, string>)}>Volver a las de GymFlow</Button>}
        {!deFabrica && <span className="flex-1" />}
        <Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button>
        <Button loading={f.enviando} onClick={() => void f.enviar(guardar)}>Guardar reglas</Button></>}>
      <div className="stack">
        <div className="grid grid-2 gap-12">
          {numero('maxDaysAhead', 'Días de antelación para reservar', 'De 1 a 21: las sesiones se generan con tres semanas.')}
          <Field label="Cancelar sin que cuente como falta" htmlFor="rg-plazo" hint="Después de ese momento, cancelar cuenta como falta y la clase suelta no se anula.">
            <select id="rg-plazo" className="select" value={v.cancelCutoffMinutes} onChange={(e) => poner('cancelCutoffMinutes')(e.target.value)}>
              {plazos.map((m) => <option key={m} value={m}>{m === 0 ? 'Hasta que empiece la clase' : `Hasta ${plazoEnTexto(m)} antes`}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-3 gap-12">
          {numero('noShowsBeforeBlock', 'Faltas que bloquean', 'De 1 a 10.')}
          {numero('noShowWindowDays', 'Contadas en (días)', 'De 7 a 90.')}
          {numero('blockDays', 'Días de bloqueo', 'De 1 a 60.')}
        </div>
        {!f.hayErrores && (
          <Callout tone="info" title="Así se le dirá al socio">
            <ul className="reglas-lista">{enPalabras(nuevas).map((t) => <li key={t}>{t}</li>)}</ul>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}

/**
 * PAUSAS DEL HORARIO POR FECHAS (11-05): vacaciones, mantenimiento, un día
 * festivo. Mientras una pausa vive, esos días no hay sesiones; al quitarla
 * vuelven las que todavía no empiezan.
 */
export function PausasCard({ sede, alCambiar }: { sede: string; alCambiar: () => void }) {
  const toast = useToast();
  const { can, canOrg, branches, org } = useSession();
  const gestiona = can('classes:manage');
  // Una pausa cancela las sesiones de esas fechas: ponerla es de la gerencia (D-28). Quitarla, de quien arma el horario.
  const pausa = can('classes:session:cancel');
  const carga = useCarga<ClassPauses>(useCallback(() => api<ClassPauses>(`/classes/pauses?branchId=${sede}`), [sede]), { conservar: true });
  const [nueva, setNueva] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);
  const nombreSede = branches.find((b) => b.id === sede)?.name ?? 'esta sucursal';
  const rango = (p: ClassPause) => (p.fromDate === p.toDate ? fecha(p.fromDate) : `${fechaCorta(p.fromDate)} – ${fecha(p.toDate)}`);

  async function quitar(p: ClassPause) {
    setQuitando(p.id);
    try {
      const r = await api<ClassPauseEnded>('/classes/pauses/end', { method: 'POST', body: JSON.stringify({ pauseId: p.id }) });
      const vuelven = r.restored + r.generated;
      toast('ok', `Pausa quitada.${vuelven > 0 ? ` ${vuelven} ${vuelven === 1 ? 'sesión vuelve' : 'sesiones vuelven'} al calendario (vacías: quien tenía lugar tiene que apartar otra vez).` : ''}`);
      await carga.recargar(); alCambiar();
    } catch (e) { toast('error', errorText(e, 'No se pudo quitar la pausa')); } finally { setQuitando(null); }
  }

  const pausas = carga.datos?.pauses ?? [];
  // Sin pausas y sin poder crearlas no hay nada que decir.
  if (!gestiona && !carga.error && pausas.length === 0) return null;
  return (
    <>
      <Card title="Pausas por fechas" sub="Vacaciones, mantenimiento o un día festivo: esos días no hay clases." pad={false} data-testid="pausas-de-clases"
        actions={pausa && <Button size="sm" variant="secondary" icon={<CalendarOff />} onClick={() => setNueva(true)}>Pausar por fechas</Button>}>
        {carga.error ? <div className="card-body"><ErrorCarga mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>
          : !carga.datos ? <div className="card-body"><Skeleton h={40} /></div>
            : pausas.length === 0 ? <p className="card-body small muted">No hay pausas programadas en {nombreSede}.</p>
              : (
                <ul className="list">
                  {pausas.map((p) => (
                    <li key={p.id} className="list-item se-apila">
                      <div className="flex-1 min-w-0 fila-titulo">
                        <div className="strong small">{rango(p)} · {p.branchId ? p.branchName ?? 'Una sucursal' : 'Todas las sucursales'}</div>
                        <div className="tiny muted">{p.reason}{p.createdByName ? ` · la puso ${p.createdByName}` : ''}</div>
                      </div>
                      {gestiona && (p.branchId !== null || canOrg('classes:manage')) && <Button size="sm" variant="ghost" loading={quitando === p.id} onClick={() => void quitar(p)}>Quitar pausa</Button>}
                    </li>
                  ))}
                </ul>
              )}
      </Card>
      {nueva && <PausaDialog sede={sede} nombreSede={nombreSede} hoy={hoyEn(zonaDe(branches.find((b) => b.id === sede), org))} puedeTodas={canOrg('classes:session:cancel') && branches.filter((b) => b.isActive).length > 1}
        onClose={() => setNueva(false)} onDone={async () => { setNueva(false); await carga.recargar(); alCambiar(); }} />}
    </>
  );
}

function PausaDialog({ sede, nombreSede, hoy, puedeTodas, onClose, onDone }: { sede: string; nombreSede: string; hoy: string; puedeTodas: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [alcance, setAlcance] = useState<'sede' | 'todas'>('sede');
  const [motivo, setMotivo] = useState('');
  const f = useFormulario({
    desde: !desde && 'Elige desde qué día.',
    hasta: (!hasta && 'Elige hasta qué día.') || (!!desde && hasta < desde && 'Tiene que ser el mismo día o uno posterior.') || (hasta < hoy && 'Esa fecha ya pasó.'),
    motivo: faltaMotivo(motivo) && ERROR_MOTIVO,
  }, { obligatorios: ['desde', 'hasta', 'motivo'] });

  async function pausar() {
    try {
      const r = await api<ClassPauseCreated>('/classes/pauses', {
        method: 'POST', body: JSON.stringify({ branchId: alcance === 'todas' ? null : sede, fromDate: desde, toDate: hasta, reason: motivo.trim() }),
      });
      toast('ok', `Pausa puesta. ${r.canceledClasses === 0 ? 'No había sesiones generadas en esas fechas.' : `${r.canceledClasses} ${r.canceledClasses === 1 ? 'sesión cancelada' : 'sesiones canceladas'}${r.canceledBookings > 0 ? ` · ${r.canceledBookings} ${r.canceledBookings === 1 ? 'reserva liberada' : 'reservas liberadas'}` : ''}.`}`);
      await onDone();
    } catch (e) { toast('error', errorText(e, 'No se pudo poner la pausa')); }
  }

  return (
    <Dialog open onClose={onClose} title="Pausar las clases por fechas"
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button>
        <Button variant="danger" icon={<CalendarOff />} loading={f.enviando} onClick={() => void f.enviar(pausar)}>Pausar esas fechas</Button></>}>
      <div className="stack">
        <Callout tone="warn">
          Se cancelan las sesiones de esos días que todavía no empiezan. Quien tenía lugar lo pierde sin que cuente como falta, y si no había pagado la clase suelta, su cargo se anula; una clase ya pagada se devuelve desde la ficha del socio.
        </Callout>
        <div className="grid grid-2 gap-12">
          <Field label="Desde" htmlFor="pa-desde" {...f.campo('desde')}><CampoFecha id="pa-desde" value={desde} onChange={(v) => { setDesde(v); if (!hasta || hasta < v) setHasta(v); }} min={hoy} hoy={hoy} /></Field>
          <Field label="Hasta (incluido)" htmlFor="pa-hasta" {...f.campo('hasta')}><CampoFecha id="pa-hasta" value={hasta} onChange={setHasta} min={desde || hoy} max={masDias(desde || hoy, 92)} hoy={hoy} /></Field>
        </div>
        {puedeTodas && (
          <Opciones forma="segmentado" etiqueta="Dónde" value={alcance} onChange={setAlcance}
            opciones={[{ value: 'sede', label: `Solo ${nombreSede}` }, { value: 'todas', label: 'Todas las sucursales' }]} />
        )}
        <CampoMotivo id="pa-motivo" value={motivo} onChange={setMotivo} error={f.error('motivo')} motivos={['Vacaciones', 'Día festivo', 'Mantenimiento']} placeholder="Vacaciones de diciembre" />
      </div>
    </Dialog>
  );
}
