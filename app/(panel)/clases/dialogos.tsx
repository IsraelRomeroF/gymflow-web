'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, Trash2 } from 'lucide-react';
import type { ClassSessionCreated, ClassTemplateUpdated } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, fechaHora, hora12 } from '@/lib/format';
import { hoyEn, masDias, zonaDe } from '@/lib/zonas';
import { DIAS, aHora, deHora, type Plantilla, type Tipo } from '@/lib/clases';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Callout, CampoFecha, CampoHora, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo, Field, Opciones, Switch } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { useCoachesDeClases } from '@/components/coach-clase';

/** Una clase del catálogo: nombre, duración y cupo sugeridos, y el precio de la clase suelta. */
export function TipoDialog({ tipo, onClose, onDone }: { tipo: Tipo | null; onClose: () => void; onDone: (creadoId: string | null) => Promise<void> }) {
  const toast = useToast();
  const { canOrg } = useSession();
  // El precio es dinero: lo fija quien maneja precios, con motivo (SEC2-03).
  const fijaPrecio = canOrg('catalog:manage');
  const [motivo, setMotivo] = useState('');
  const [nombre, setNombre] = useState(tipo?.name ?? '');
  const [descripcion, setDescripcion] = useState(tipo?.description ?? '');
  const [duracion, setDuracion] = useState(String(tipo?.defaultDurationMin ?? 60));
  const [cupo, setCupo] = useState(String(tipo?.defaultCapacity ?? 20));
  const [precio, setPrecio] = useState(tipo ? (Number(BigInt(tipo.dropInPriceCents)) / 100).toString() : '0');
  const [incluible, setIncluible] = useState(tipo?.includableInPlans ?? true);
  const [enviando, setEnviando] = useState(false);

  const centavos = /^\d+(\.\d{1,2})?$/.test(precio.trim()) ? Math.round(Number(precio) * 100) : null;
  const cambiaPrecio = !!tipo && centavos !== null && String(centavos) !== tipo.dropInPriceCents;
  const valido = nombre.trim().length >= 2 && Number(duracion) >= 5 && Number(cupo) >= 1 && centavos !== null
    && (!cambiaPrecio || motivo.trim().length >= 3);

  async function guardar() {
    setEnviando(true);
    try {
      const body = {
        name: nombre.trim(), description: descripcion.trim() || null,
        defaultDurationMin: Number(duracion), defaultCapacity: Number(cupo),
        ...(fijaPrecio && (!tipo || cambiaPrecio) ? { dropInPriceCents: String(centavos) } : {}),
        ...(cambiaPrecio ? { reason: motivo.trim() } : {}),
        ...(fijaPrecio && (!tipo || incluible !== tipo.includableInPlans) ? { includableInPlans: incluible } : {}),
      };
      const r = await api<{ id: string }>(tipo ? `/classes/types/${tipo.id}` : '/classes/types', { method: tipo ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      toast('ok', tipo ? 'Clase actualizada.' : `${body.name} creada. Ahora agrégala al horario.`);
      await onDone(tipo ? null : r.id);
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={tipo ? `Editar ${tipo.name}` : 'Nueva clase'}
      sub={tipo ? 'Duración y cupo son los sugeridos al agregarla al horario; lo ya programado no cambia.' : 'Después la agregas al horario de cada sucursal.'}
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button loading={enviando} disabled={!valido} onClick={() => void guardar()}>{tipo ? 'Guardar' : 'Crear clase'}</Button></>}>
      <div className="stack">
        <Field label="Nombre" htmlFor="tn"><input id="tn" className="input" value={nombre} placeholder="Spinning, Yoga, Funcional…" onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Descripción (la ve el socio)" htmlFor="td"><input id="td" className="input" value={descripcion} placeholder="Opcional" onChange={(e) => setDescripcion(e.target.value)} /></Field>
        <div className="grid grid-3 gap-12">
          <Field label="Duración (min)" htmlFor="tdu"><input id="tdu" className="input num" inputMode="numeric" value={duracion} onChange={(e) => setDuracion(e.target.value)} /></Field>
          <Field label="Cupo" htmlFor="tc"><input id="tc" className="input num" inputMode="numeric" value={cupo} onChange={(e) => setCupo(e.target.value)} /></Field>
          <Field label="Precio clase suelta" htmlFor="tp" hint={fijaPrecio ? 'Con $0 solo la toma quien tiene plan' : 'Lo cambia quien maneja precios'}>
            <input id="tp" className="input num" inputMode="decimal" value={precio} disabled={!fijaPrecio} onChange={(e) => setPrecio(e.target.value)} />
          </Field>
        </div>
        {cambiaPrecio && (
          <Field label="Motivo del cambio de precio" htmlFor="tpm" hint="Queda en la bitácora con tu nombre y el precio anterior.">
            <input id="tpm" className="input" value={motivo} placeholder="Ajuste anual, promoción…" onChange={(e) => setMotivo(e.target.value)} />
          </Field>
        )}
        <Switch checked={incluible} disabled={!fijaPrecio} onChange={setIncluible}>Se puede incluir en planes</Switch>
        <p className="hint">{incluible
          ? 'Incluida en el plan si el plan la trae; si no, se paga suelta. Sin plan también se toma pagándola.'
          : 'Siempre se paga como clase suelta, aunque el plan del socio incluya clases.'}</p>
      </div>
    </Dialog>
  );
}

const enLista = (xs: string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(xs);
const ordenDeSemana = (a: number, b: number) => ((a + 6) % 7) - ((b + 6) % 7);

/**
 * AGREGAR AL HORARIO, EDITAR UN HORARIO O UNA SESIÓN ÚNICA: el mismo
 * formulario (11-05, 11-06).
 *
 *  - Nuevo: «Se repite cada semana» (con «hasta» opcional) o «Solo una vez»
 *    (un taller, una clase de prueba), con su fecha.
 *  - Editar: días, hora, duración, cupo, salón, coach y «hasta» de un horario
 *    que ya existe. Las sesiones vacías se rehacen; las que ya tienen lugares
 *    reservados se quedan en su hora y el diálogo las enlista al guardar.
 */
export function HorarioDialog({ tipos, sede, inicial, onClose, onDone, onQuitar }: {
  tipos: Tipo[]; sede: string;
  inicial: { weekday?: number; tipoId?: string; unica?: boolean; plantilla?: Plantilla };
  onClose: () => void; onDone: () => Promise<void>;
  /** Editando: «Quitar del horario» (lo confirma la página, con su motivo). */
  onQuitar?: (p: Plantilla) => void;
}) {
  const { branches, inScope, org, activoEn } = useSession();
  const toast = useToast();
  const editando = inicial.plantilla ?? null;
  const primero = editando?.slots[0];
  // Un horario armado con horas distintas por día no cabe en este formulario: se dice antes de guardar.
  const disparejo = !!editando && editando.slots.some((s) => s.startMinute !== primero!.startMinute || s.durationMin !== primero!.durationMin || s.capacity !== primero!.capacity);
  const sedes = branches.filter((b) => b.isActive && inScope(b.id) && activoEn('classes', b.id));
  const [modo, setModo] = useState<'semanal' | 'unica'>(inicial.unica ? 'unica' : 'semanal');
  const [tipoId, setTipoId] = useState(editando?.classTypeId ?? inicial.tipoId ?? tipos[0]?.id ?? '');
  const tipo = tipos.find((t) => t.id === tipoId);
  const [branchId, setBranchId] = useState(editando?.branchId ?? sede);
  const zona = zonaDe(branches.find((b) => b.id === branchId), org);
  const hoy = hoyEn(zona);
  // Nada puesto de antemano (UX5-G-05): con lunes, miércoles y viernes a las
  // 07:00 ya marcados, una gerente publicó una clase de cinco días sin querer.
  const [dias, setDias] = useState<number[]>(editando ? [...new Set(editando.slots.map((s) => s.weekday))] : inicial.weekday !== undefined ? [inicial.weekday] : []);
  const [inicio, setInicio] = useState(primero ? aHora(primero.startMinute) : '');
  const [duracion, setDuracion] = useState(String(primero?.durationMin ?? tipo?.defaultDurationMin ?? 60));
  const [cupo, setCupo] = useState(String(primero?.capacity ?? tipo?.defaultCapacity ?? 20));
  const [salon, setSalon] = useState(editando?.room ?? '');
  const [coachId, setCoachId] = useState(editando?.coachUserId ?? '');
  const [hasta, setHasta] = useState(editando?.until ?? '');
  const [fechaUnica, setFechaUnica] = useState('');
  const { coaches, error: falloCoaches, recargar: recargarCoaches } = useCoachesDeClases(branchId);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ClassTemplateUpdated | null>(null);

  useEffect(() => {
    if (!tipo || editando) return;
    setDuracion(String(tipo.defaultDurationMin)); setCupo(String(tipo.defaultCapacity));
  }, [tipo, editando]);

  const horaValida = /^\d{2}:\d{2}$/.test(inicio);
  const numeros = Number(duracion) >= 5 && Number(cupo) >= 1;
  const valido = !!tipoId && horaValida && numeros && (modo === 'unica' ? !!fechaUnica : dias.length > 0 && (!hasta || hasta >= hoy));
  const slots = () => dias.map((weekday) => ({ weekday, startMinute: deHora(inicio), durationMin: Number(duracion), capacity: Number(cupo) }));

  async function guardar() {
    setEnviando(true);
    try {
      if (editando) {
        const r = await api<ClassTemplateUpdated>(`/classes/templates/${editando.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ slots: slots(), room: salon.trim() || null, coachUserId: coachId || null, until: hasta || null }),
        });
        if (r.kept.length > 0) { setResultado(r); return; }
        toast('ok', `Horario actualizado.${r.generated + r.updated + r.removed > 0 ? ` ${[r.generated ? `${r.generated} sesiones nuevas` : null, r.updated ? `${r.updated} ajustadas` : null, r.removed ? `${r.removed} quitadas (nadie las había reservado)` : null].filter(Boolean).join(', ')}.` : ''}`);
      } else if (modo === 'unica') {
        const r = await api<ClassSessionCreated>('/classes/schedules', {
          method: 'POST',
          body: JSON.stringify({ branchId, classTypeId: tipoId, date: fechaUnica, startMinute: deHora(inicio), durationMin: Number(duracion), capacity: Number(cupo), room: salon.trim() || null, coachUserId: coachId || null }),
        });
        toast('ok', `Sesión agregada: ${tipo?.name ?? 'la clase'}, ${fechaHora(r.startsAt, zona)}. Ya se puede reservar${r.timeShifted ? ' (el cambio de hora movió la hora pedida: revísala)' : ''}.`);
      } else {
        const r = await api<{ generated: number }>('/classes/templates', {
          method: 'POST',
          body: JSON.stringify({
            branchId, classTypeId: tipoId, room: salon.trim() || null, coachUserId: coachId || null,
            // Desde hoy en la zona de la sucursal, no en la de la computadora (26-06).
            effectiveFrom: hoy, ...(hasta ? { until: hasta } : {}),
            slots: slots(),
          }),
        });
        toast('ok', `Agregada al horario. Se generaron ${r.generated} sesiones y ya aparecen en el portal.`);
      }
      await onDone();
    } catch (e) { toast('error', errorText(e, editando ? 'No se pudo guardar el horario' : 'No se pudo agregar')); } finally { setEnviando(false); }
  }

  if (resultado) {
    return (
      <Dialog open onClose={() => void onDone()} title="Horario actualizado"
        footer={<Button onClick={() => void onDone()}>Entendido</Button>}>
        <div className="stack">
          <Callout tone="warn" title={`${resultado.kept.length} ${resultado.kept.length === 1 ? 'sesión ya tenía lugares reservados y se queda' : 'sesiones ya tenían lugares reservados y se quedan'} como estaba${resultado.kept.length === 1 ? '' : 'n'}`}>
            Nadie perdió su lugar. Si el cambio también va para {resultado.kept.length === 1 ? 'esa sesión' : 'esas sesiones'}, avísales a los socios y cancélala{resultado.kept.length === 1 ? '' : 's'} desde «Sesiones», o déjala{resultado.kept.length === 1 ? '' : 's'} a su hora de siempre.
          </Callout>
          <ul className="list card shadow-none">
            {resultado.kept.map((k) => (
              <li key={k.scheduleId} className="list-item">
                <span className="flex-1 small strong">{fechaHora(k.startsAt, zona)}</span>
                <span className="small muted">{k.bookedCount} {k.bookedCount === 1 ? 'lugar reservado' : 'lugares reservados'}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">Lo demás ya cambió: {[resultado.generated ? `${resultado.generated} sesiones nuevas` : null, resultado.updated ? `${resultado.updated} ajustadas` : null, resultado.removed ? `${resultado.removed} quitadas (nadie las había reservado)` : null].filter(Boolean).join(', ') || 'no había otras sesiones que mover'}.</p>
        </div>
      </Dialog>
    );
  }

  const titulo = editando ? `Editar ${editando.className ?? 'la clase'}` : modo === 'unica' ? 'Agregar una sesión' : 'Agregar al horario';
  const boton = editando ? 'Guardar cambios'
    : modo === 'unica' ? (!fechaUnica ? 'Elige la fecha' : !inicio ? 'Elige la hora' : 'Agregar la sesión')
      : dias.length === 0 ? 'Elige los días' : !inicio ? 'Elige la hora' : `Agregar ${dias.length} ${dias.length === 1 ? 'día' : 'días'} por semana`;
  return (
    <Dialog open onClose={onClose} title={titulo}
      sub={editando ? 'Las sesiones que nadie ha reservado cambian con el horario. Las que ya tienen lugares reservados no se mueven solas: al guardar te digo cuáles son.'
        : modo === 'unica' ? 'Una sola vez: un taller, una clase de prueba, una masterclass. Se reserva como cualquier otra.'
          : 'Se repite cada semana. Las sesiones de las próximas 3 semanas se generan al guardar.'}
      footer={<>
        {editando && onQuitar && <Button variant="ghost" icon={<Trash2 />} disabled={enviando} onClick={() => onQuitar(editando)}>Quitar del horario</Button>}
        {editando && onQuitar && <span className="flex-1" />}
        <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button icon={<CalendarPlus />} loading={enviando} disabled={!valido} onClick={() => void guardar()}>{boton}</Button></>}>
      <div className="stack">
        {!editando && (
          <Opciones forma="segmentado" etiqueta="Cuándo se da" value={modo} onChange={setModo}
            opciones={[{ value: 'semanal', label: 'Se repite cada semana' }, { value: 'unica', label: 'Solo una vez' }]} />
        )}
        {disparejo && <Callout tone="warn">Este horario tiene horas, duraciones o cupos distintos según el día. Al guardar, todos sus días quedan con la hora, la duración y el cupo que pongas aquí.</Callout>}
        <div className="grid grid-2 gap-12">
          <Field label="Clase" htmlFor="hc">
            <select id="hc" className="select" value={tipoId} disabled={!!editando} onChange={(e) => setTipoId(e.target.value)}>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Sucursal" htmlFor="hs">
            <select id="hs" className="select" value={branchId} disabled={!!editando} onChange={(e) => setBranchId(e.target.value)}>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        {modo === 'unica' ? (
          <Field label="Fecha" htmlFor="hf"><CampoFecha id="hf" value={fechaUnica} onChange={setFechaUnica} min={hoy} max={masDias(hoy, 180)} hoy={hoy} atajos={[0, 1, 7]} /></Field>
        ) : (
          <div>
            <p className="label mb-8">Días</p>
            <div className="row wrap gap-6">
              {DIAS.map((d) => (
                <button key={d.w} type="button" className="day-chip" aria-pressed={dias.includes(d.w)}
                  onClick={() => setDias(dias.includes(d.w) ? dias.filter((x) => x !== d.w) : [...dias, d.w])}>{d.corto}</button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-3 gap-12">
          <Field label="Hora" htmlFor="hh"><CampoHora id="hh" value={inicio} onChange={setInicio} /></Field>
          <Field label="Duración (min)" htmlFor="hd"><input id="hd" className="input num" inputMode="numeric" value={duracion} onChange={(e) => setDuracion(e.target.value)} /></Field>
          <Field label="Cupo" htmlFor="hcu"><input id="hcu" className="input num" inputMode="numeric" value={cupo} onChange={(e) => setCupo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-2 gap-12">
          <Field label="Quién la imparte" htmlFor="hco"
            hint={falloCoaches ? <>No se pudo cargar la lista de coaches. <button type="button" className="enlace-en-linea" onClick={() => void recargarCoaches()}>Reintentar</button></> : 'El socio lo ve en su portal.'}>
            <select id="hco" className="select" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
              <option value="">{falloCoaches ? 'Sin coach asignado (no se pudo cargar la lista)' : coaches?.length === 0 ? 'No hay coaches dados de alta' : 'Sin coach asignado'}</option>
              {(coaches ?? []).map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          </Field>
          <Field label="Salón (opcional)" htmlFor="hsa"><input id="hsa" className="input" value={salon} placeholder="Salón 1" onChange={(e) => setSalon(e.target.value)} /></Field>
        </div>
        {modo === 'semanal' && (
          <Field label="Se da hasta (opcional)" htmlFor="hha" error={hasta && hasta < hoy ? 'Esa fecha ya pasó: para terminarlo hoy, quita el horario.' : null}
            hint="El último día en que se da. Vacío: sigue hasta que lo quites.">
            <CampoFecha id="hha" value={hasta} onChange={setHasta} min={hoy} hoy={hoy} />
          </Field>
        )}
        {valido && tipo && !editando && (
          <Callout tone="info">
            {modo === 'unica'
              ? <><strong>{tipo.name}</strong> el {fecha(fechaUnica)} a las {inicio} ({hora12(inicio)}), {duracion} min, {cupo} lugares, en {sedes.find((b) => b.id === branchId)?.name}. Una sola vez.</>
              : <><strong>{tipo.name}</strong> cada {enLista([...dias].sort(ordenDeSemana).map((w) => DIAS.find((d) => d.w === w)?.largo ?? ''))} a las {inicio} ({hora12(inicio)}), {duracion} min, {cupo} lugares, en {sedes.find((b) => b.id === branchId)?.name}{hasta ? `, hasta el ${fecha(hasta)}` : ''}. Los socios la verán en su teléfono en cuanto la agregues.</>}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}

/** Cancelar una sesión, quitar un horario o dejar de dar una clase: siempre con su motivo. */
export function RetirarDialog({ kind, id, titulo, detalle, onClose, onDone }: {
  kind: 'tipo' | 'horario' | 'sesion'; id: string; titulo: string; detalle: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  // El botón queda encendido: si falta el motivo, el campo lo dice (26-02).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  const url = kind === 'tipo' ? `/classes/types/${id}/retire` : kind === 'horario' ? `/classes/templates/${id}/retire` : `/classes/schedules/${id}/cancel`;

  async function confirmar() {
    try {
      const r = await api<{ canceledClasses?: number; canceledBookings: number }>(url, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      const partes = [
        r.canceledClasses !== undefined ? `${r.canceledClasses} sesiones canceladas` : 'Sesión cancelada',
        r.canceledBookings > 0 ? `${r.canceledBookings} reservas liberadas` : null,
      ].filter(Boolean);
      toast('ok', `${partes.join(' · ')}.`);
      await onDone();
    } catch (e) { toast('error', errorText(e, 'No se pudo')); }
  }

  return (
    // «Volver» se queda: el título ya dice «Cancelar …» y un «Cancelar» al lado confundiría.
    <Dialog open size="sm" onClose={onClose} title={titulo}
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Volver</Button>
        <Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(confirmar)}>Confirmar</Button></>}>
      <div className="stack">
        <Callout tone="warn">{detalle}</Callout>
        <CampoMotivo id="rm" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} placeholder="El instructor ya no está, poca asistencia…" />
      </div>
    </Dialog>
  );
}
