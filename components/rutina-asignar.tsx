'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ListChecks, Search, UserPlus, Users } from 'lucide-react';
import type { MemberRoutine, RoutineList } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { useBuscarSocios } from '@/lib/buscar-socios';
import { EstadoCarga, useCarga } from '@/lib/carga';
import {
  GRUPO, NIVELES, OBJETIVOS, REVISION_POR_OMISION, SEMANAS_DE_REVISION, descanso, haceSemanas,
  type Rutina, type SemanasDeRevision,
} from '@/lib/rutinas';
import { useSession, useToast, errorText } from './session';
import { Badge, Button, Callout, Dialog, Empty, Field, Opciones, Skeleton } from './ui';

type Socio = { id: string; nombre: string; nombreCompleto: string; codigo?: string };
type Resumen = RoutineList['routines'][number];

/**
 * «ASIGNAR RUTINA», UNO SOLO (auditoría 8, bloque 2.6; 12-09).
 *
 * Antes había dos diálogos: el de la ficha (un `<select>` ciego) y el de la
 * rutina (buscar al socio). Es el mismo acto visto desde dos lados, así que
 * es el mismo diálogo: desde la ficha ya se sabe el socio y se elige la
 * rutina; desde la rutina ya se sabe la rutina y se elige al socio.
 *
 * En los dos se ve qué tiene HOY el socio («Hoy tiene «X» desde hace 6
 * semanas») antes de reemplazársela, la rutina se elige de tarjetas con su
 * vista previa, y se dice cuándo revisarla («Revisar en»).
 */
export function AsignarRutinaDialog({ socio: socioFijo, rutina: rutinaFija, onClose, onListo }: {
  /** Desde la ficha: a quién. */
  socio?: Socio;
  /** Desde la rutina: cuál. */
  rutina?: { id: string; name: string };
  onClose: () => void;
  onListo?: () => void;
}) {
  const toast = useToast();
  const { me } = useSession();
  const soloCoach = !!me.roleKeys?.length && me.roleKeys.every((k) => k === 'COACH');
  const [socio, setSocio] = useState<Socio | null>(socioFijo ?? null);
  const [rutinaId, setRutinaId] = useState<string | null>(rutinaFija?.id ?? null);
  const [semanas, setSemanas] = useState<SemanasDeRevision>(REVISION_POR_OMISION);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lo que el socio tiene hoy: se enseña antes de reemplazarlo.
  const [tiene, setTiene] = useState<MemberRoutine['assignment'] | undefined>(undefined);
  const socioId = socio?.id ?? null;
  useEffect(() => {
    setTiene(undefined);
    if (!socioId) return;
    let vigente = true;
    api<MemberRoutine>(`/members/${socioId}/routine`).then((r) => { if (vigente) setTiene(r.assignment); }).catch(() => { if (vigente) setTiene(null); });
    return () => { vigente = false; };
  }, [socioId]);

  // Sin red no es «No hay rutinas» (26-01). La lista se pide con `training:assign` (12-20).
  const pedirRutinas = useCallback(() => api<RoutineList>('/routines').then((r) => r.routines), []);
  const rutinas = useCarga(rutinaFija ? null : pedirRutinas);
  const elegida = rutinaFija ?? (rutinas.datos ?? []).find((x) => x.id === rutinaId) ?? null;

  async function asignar() {
    if (!socio || !elegida) return;
    setEnviando(true);
    setError(null);
    try {
      await api(`/members/${socio.id}/routine`, { method: 'POST', body: JSON.stringify({ routineId: elegida.id, notes: nota.trim() || null, reviewWeeks: semanas }) });
      toast('ok', `${socio.nombre} ya ve «${elegida.name}» en su teléfono`);
      onListo?.();
      onClose();
    } catch (e) { setError(errorText(e, 'No se pudo asignar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} error={error}
      title={rutinaFija ? `Asignar «${rutinaFija.name}»` : 'Asignar rutina'}
      sub={socioFijo ? `A ${socioFijo.nombreCompleto}.` : 'Elige al socio: la verá en su teléfono.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={<UserPlus />} loading={enviando} disabled={!socio || !elegida} onClick={() => void asignar()}>Asignar</Button></>}>
      <div className="stack">
        {!socioFijo && <ElegirSocio socio={socio} onElegir={setSocio} soloSuyos={soloCoach} />}

        {socio && tiene?.routine && (
          <Callout tone="info">
            Hoy tiene «{tiene.routine.name}» desde {haceSemanas(tiene.assignedAt)}{tiene.reviewDue ? ' y ya le toca revisión' : ''}: esta la reemplaza.
          </Callout>
        )}

        {!rutinaFija && (
          <EstadoCarga carga={rutinas} titulo="No se pudieron cargar las rutinas" esqueleto={<Skeleton h={120} />}
            vacio={<Empty icon={<ListChecks />} title="No hay rutinas" text="Créalas en Rutinas." action={<Link className="btn btn-secondary btn-sm" href="/rutinas/nueva">Nueva rutina</Link>} />}>
            {(lista) => <ElegirRutina lista={lista} elegida={rutinaId} onElegir={setRutinaId} actual={tiene?.routine?.id ?? null} />}
          </EstadoCarga>
        )}

        <div className="field">
          <span className="label" id="as-revisar">Revisar en</span>
          <Opciones forma="segmentado" etiquetadaPor="as-revisar" value={semanas} onChange={setSemanas}
            opciones={SEMANAS_DE_REVISION.map((n) => ({ value: n, label: `${n} semanas` }))} />
          <p className="hint">Ese día te la recordamos en tu inicio y en su ficha.</p>
        </div>
        <Field label="Nota para el socio (opcional)" htmlFor="as-nota">
          <input id="as-nota" className="input" maxLength={300} value={nota} placeholder="Empieza con poco peso la primera semana" onChange={(e) => setNota(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Buscar al socio. El coach solo encuentra a los suyos: se le dice. */
function ElegirSocio({ socio, onElegir, soloSuyos }: { socio: Socio | null; onElegir: (s: Socio | null) => void; soloSuyos: boolean }) {
  const [q, setQ] = useState('');
  const busqueda = useBuscarSocios(q);
  const hallados = busqueda.hallados ?? [];
  if (socio) {
    return (
      <div className="row-between card card-pad-sm">
        <span><span className="strong">{socio.nombreCompleto}</span> {socio.codigo && <code className="tiny muted">{socio.codigo}</code>}</span>
        <Button size="sm" variant="ghost" onClick={() => onElegir(null)}>Cambiar</Button>
      </div>
    );
  }
  return (
    <div className="stack-sm">
      <div className="input-icon"><Search /><input className="input" autoFocus aria-label="Buscar socio" placeholder="Nombre, código o teléfono" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {soloSuyos && <p className="tiny muted">Solo tus socios: a quien no tengas asignado, pídelo en recepción.</p>}
      {q.trim().length === 1 && <p className="tiny muted">Escribe al menos 2 letras para buscar.</p>}
      {busqueda.fallo && <p className="tiny muted">No se pudo buscar. <button type="button" className="enlace-en-linea" onClick={busqueda.reintentar}>Reintentar</button></p>}
      {busqueda.hallados !== null && hallados.length === 0 && !busqueda.enEspera && <p className="tiny muted">Nadie coincide con «{busqueda.consulta}».</p>}
      <ul className="list">
        {hallados.map((h) => {
          const elegir = () => onElegir({ id: h.id, nombre: h.firstName, nombreCompleto: `${h.firstName} ${h.lastName}`, codigo: h.memberCode });
          return (
            <li key={h.id} className="list-item is-link" onClick={elegir}>
              <button type="button" className="strong small row-link rt-elegir-socio" onClick={(e) => { e.stopPropagation(); elegir(); }}>{h.firstName} {h.lastName}</button> <code className="tiny muted">{h.memberCode}</code>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Las rutinas del gimnasio en tarjetas; la elegida abre su vista previa. */
function ElegirRutina({ lista, elegida, onElegir, actual }: { lista: Resumen[]; elegida: string | null; onElegir: (id: string) => void; actual: string | null }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const visibles = t ? lista.filter((x) => x.name.toLowerCase().includes(t) || x.dayNames.some((d) => d.toLowerCase().includes(t))) : lista;
  return (
    <div className="stack-sm">
      <span className="label" id="as-rutina">Rutina</span>
      {lista.length > 6 && (
        <div className="input-icon"><Search /><input className="input" aria-label="Buscar rutina" placeholder="Nombre de la rutina o de un día" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      )}
      {visibles.length === 0 && <p className="tiny muted">Ninguna rutina coincide con «{q.trim()}».</p>}
      <ul className="rt-opciones" role="radiogroup" aria-labelledby="as-rutina">
        {visibles.map((x) => (
          <li key={x.id}>
            <button type="button" role="radio" aria-checked={x.id === elegida} className="rt-opcion" data-rutina={x.id} onClick={() => onElegir(x.id)}>
              <span className="row-between gap-8">
                <span className="strong">{x.name}</span>
                <span className="row wrap gap-6">
                  {x.id === actual && <Badge tone="info">La tiene hoy</Badge>}
                  {x.goal && <Badge tone="volt">{OBJETIVOS[x.goal] ?? x.goal}</Badge>}
                  {x.level && <Badge>{NIVELES[x.level] ?? x.level}</Badge>}
                </span>
              </span>
              <span className="row wrap tiny muted rt-opcion-meta">
                <span className="row gap-4"><CalendarDays size={13} />{x.days} {x.days === 1 ? 'día' : 'días'}</span>
                <span className="row gap-4"><ListChecks size={13} />{x.exercises} {x.exercises === 1 ? 'ejercicio' : 'ejercicios'}</span>
                <span className="row gap-4"><Users size={13} />{x.activeMembers} {x.activeMembers === 1 ? 'socio' : 'socios'}</span>
              </span>
              <span className="tiny muted ellipsis">{x.dayNames.join(' · ')}</span>
            </button>
            {x.id === elegida && <VistaPreviaDeRutina id={x.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lo que el socio va a ver: los días con sus ejercicios. */
function VistaPreviaDeRutina({ id }: { id: string }) {
  const carga = useCarga(useCallback(() => api<Rutina>(`/routines/${id}`), [id]));
  if (carga.error) return <p className="tiny muted rt-previa">No se pudo cargar la vista previa.</p>;
  if (!carga.datos) return <div className="rt-previa"><Skeleton h={64} /></div>;
  return (
    <details className="rt-previa" open>
      <summary className="tiny strong">Vista previa</summary>
      <div className="rt-previa-dias">
        {carga.datos.days.map((d, i) => (
          <div key={i}>
            <p className="section-label">Día {i + 1} · {d.name}</p>
            <ol className="rt-lista">
              {d.items.map((it, k) => (
                <li key={k}><span className="small">{it.exercise.name}</span><span className="tiny muted"> {it.sets}×{it.reps} · {descanso(it.restSeconds)} · {GRUPO[it.exercise.muscleGroup]}</span></li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </details>
  );
}
