'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Search, X, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { DESCANSOS, GRUPO, GRUPOS, NIVELES, OBJETIVOS, descanso, type Ejercicio, type Grupo, type Item, type Rutina } from '@/lib/rutinas';
import { useToast, errorText } from './session';
import { Badge, Button, Callout, Card, Dialog, Empty, ErrorCarga, Field } from './ui';
import { IconButton } from '@gymflow/ui/compartido';
import { useCarga } from '@gymflow/ui/carga';

type Dia = { name: string; items: Item[] };

/**
 * EDITOR DE RUTINAS — lo usa el coach.
 *
 * Se arma por DÍAS (hasta siete) y cada día con sus ejercicios en orden:
 * series, repeticiones, descanso y una nota. Los ejercicios salen del
 * catálogo —diez precargados por bloque muscular, más los del gimnasio—, así
 * que armar una rutina es elegir, no escribir.
 */
export function RutinaEditor({ inicial }: { inicial: Rutina | null }) {
  const router = useRouter();
  const toast = useToast();
  const [nombre, setNombre] = useState(inicial?.name ?? '');
  const [objetivo, setObjetivo] = useState(inicial?.goal ?? 'HIPERTROFIA');
  const [nivel, setNivel] = useState(inicial?.level ?? 'PRINCIPIANTE');
  const [notas, setNotas] = useState(inicial?.notes ?? '');
  const [dias, setDias] = useState<Dia[]>(inicial?.days.length ? inicial.days : [{ name: 'Día 1', items: [] }]);
  const [activo, setActivo] = useState(0);
  const [eligiendo, setEligiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Cambios sin guardar (UX7 Clases 6): se compara con lo que había al abrir.
  const foto = (x: { nombre: string; objetivo: string; nivel: string; notas: string; dias: Dia[] }) => JSON.stringify(x);
  const original = useRef(foto({ nombre, objetivo, nivel, notas, dias }));
  const sucio = !guardando && foto({ nombre, objetivo, nivel, notas, dias }) !== original.current;
  const [salirA, setSalirA] = useState<string | null>(null);
  const [quitarDia, setQuitarDia] = useState(false);
  useEffect(() => {
    if (!sucio) return;
    // Cerrar la pestaña o recargar: el aviso del navegador.
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    // Un enlace del panel (menú, migas): se detiene y se pregunta.
    const clic = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault(); e.stopPropagation();
      setSalirA(url.pathname + url.search);
    };
    window.addEventListener('beforeunload', antes);
    document.addEventListener('click', clic, true);
    return () => { window.removeEventListener('beforeunload', antes); document.removeEventListener('click', clic, true); };
  }, [sucio]);
  const quitarElDia = () => { setDias((ds) => ds.filter((_, i) => i !== activo)); setActivo(Math.max(0, activo - 1)); setQuitarDia(false); };

  const dia = dias[activo]!;
  const cambiarDia = (f: (d: Dia) => Dia) => setDias((ds) => ds.map((d, i) => (i === activo ? f(d) : d)));
  const cambiarItem = (idx: number, patch: Partial<Item>) => cambiarDia((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const mover = (idx: number, delta: number) => cambiarDia((d) => {
    const items = [...d.items];
    const [x] = items.splice(idx, 1);
    items.splice(idx + delta, 0, x!);
    return { ...d, items };
  });

  const vacios = dias.filter((d) => d.items.length === 0).length;
  const listo = nombre.trim().length >= 2 && dias.every((d) => d.name.trim()) && dias.some((d) => d.items.length > 0);

  async function guardar() {
    setGuardando(true);
    try {
      const cuerpo = {
        name: nombre.trim(), goal: objetivo, level: nivel, notes: notas.trim() || null,
        // Un día sin ejercicios no se guarda: en el teléfono del socio sería una pantalla vacía.
        days: dias.filter((d) => d.items.length > 0).map((d) => ({
          name: d.name.trim(),
          items: d.items.map((it) => ({ exerciseId: it.exerciseId, sets: it.sets, reps: it.reps.trim() || '10', restSeconds: it.restSeconds, notes: it.notes?.trim() || null })),
        })),
      };
      const r = inicial
        ? await api<Rutina>(`/routines/${inicial.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
        : await api<Rutina>('/routines', { method: 'POST', body: JSON.stringify(cuerpo) });
      original.current = foto({ nombre, objetivo, nivel, notas, dias });
      toast('ok', inicial ? 'Rutina actualizada' : 'Rutina creada');
      router.push(`/rutinas/${r.id}`);
      router.refresh();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setGuardando(false); }
  }

  return (
    <div className="stack gap-20">
      <Card>
        <div className="grid grid-2 gap-14">
          <Field label="Nombre de la rutina" htmlFor="rt-nombre">
            <input id="rt-nombre" className="input" autoFocus={!inicial} value={nombre} placeholder="Hipertrofia 4 días · torso/pierna" onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <div className="grid grid-2 gap-12">
            <Field label="Objetivo" htmlFor="rt-obj">
              <select id="rt-obj" className="select" value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
                {Object.entries(OBJETIVOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Nivel" htmlFor="rt-niv">
              <select id="rt-niv" className="select" value={nivel} onChange={(e) => setNivel(e.target.value)}>
                {Object.entries(NIVELES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <Field label="Indicaciones generales (opcional)" htmlFor="rt-notas" hint="Las ve el socio arriba de su rutina: calentamiento, progresión, cuidados.">
          <textarea id="rt-notas" className="textarea" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Calienta 10 minutos en caminadora. Sube el peso cuando completes todas las repeticiones." />
        </Field>
      </Card>

      <div className="rt-dias">
        {dias.map((d, i) => (
          <button key={i} type="button" className="rt-dia" aria-pressed={i === activo} onClick={() => setActivo(i)}>
            <span className="rt-dia-num">Día {i + 1}</span>
            <span className="rt-dia-nombre">{d.name || 'Sin nombre'}</span>
            <span className="tiny muted">{d.items.length} {d.items.length === 1 ? 'ejercicio' : 'ejercicios'}</span>
          </button>
        ))}
        {dias.length < 7 && (
          <button type="button" className="rt-dia rt-dia-nuevo" onClick={() => { setDias((ds) => [...ds, { name: `Día ${ds.length + 1}`, items: [] }]); setActivo(dias.length); }}>
            <Plus /> Agregar día
          </button>
        )}
      </div>

      <Card title={
        <input className="input rt-dia-titulo" aria-label="Nombre del día" value={dia.name} placeholder="Pecho y tríceps"
          onChange={(e) => cambiarDia((d) => ({ ...d, name: e.target.value }))} />
      } actions={
        <div className="row gap-8">
          {dias.length > 1 && (
            <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => (dia.items.length > 0 ? setQuitarDia(true) : quitarElDia())}>Quitar día</Button>
          )}
          <Button size="sm" icon={<Plus />} onClick={() => setEligiendo(true)}>Agregar ejercicios</Button>
        </div>
      } pad={false}>
        {dia.items.length === 0 ? (
          <Empty icon={<ListChecks />} title="Este día no tiene ejercicios" text="Agrégalos del catálogo: hay diez por cada bloque muscular."
            action={<Button size="sm" icon={<Plus />} onClick={() => setEligiendo(true)}>Agregar ejercicios</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack rt-tabla">
              <thead><tr><th>#</th><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Descanso</th><th>Nota</th><th /></tr></thead>
              <tbody>
                {dia.items.map((it, i) => (
                  <tr key={`${it.exerciseId}-${i}`}>
                    <td className="muted num stack-hide">{i + 1}</td>
                    <td className="stack-full">
                      <div className="strong small">{it.exercise.name}</div>
                      <div className="tiny muted">{GRUPO[it.exercise.muscleGroup]}{it.exercise.equipment ? ` · ${it.exercise.equipment}` : ''}</div>
                    </td>
                    <td data-label="Series"><input className="input rt-num" type="number" min={1} max={20} aria-label="Series" value={it.sets}
                      onChange={(e) => cambiarItem(i, { sets: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} /></td>
                    <td data-label="Reps"><input className="input rt-reps" aria-label="Repeticiones" value={it.reps} maxLength={20} placeholder="10-12"
                      onChange={(e) => cambiarItem(i, { reps: e.target.value })} /></td>
                    <td data-label="Descanso">
                      <select className="select rt-desc" aria-label="Descanso" value={it.restSeconds ?? ''}
                        onChange={(e) => cambiarItem(i, { restSeconds: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">—</option>
                        {DESCANSOS.map((s) => <option key={s} value={s}>{descanso(s)}</option>)}
                      </select>
                    </td>
                    <td className="stack-full"><input className="input" aria-label="Nota" value={it.notes ?? ''} maxLength={200} placeholder="Opcional"
                      onChange={(e) => cambiarItem(i, { notes: e.target.value })} /></td>
                    <td className="right">
                      <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <IconButton label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp /></IconButton>
                        <IconButton label="Bajar" disabled={i === dia.items.length - 1} onClick={() => mover(i, 1)}><ArrowDown /></IconButton>
                        <IconButton label="Quitar" onClick={() => cambiarDia((d) => ({ ...d, items: d.items.filter((_, k) => k !== i) }))}><X /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {vacios > 0 && dias.some((d) => d.items.length > 0) && (
        <Callout tone="info">{vacios === 1 ? 'Un día no tiene ejercicios y' : `${vacios} días no tienen ejercicios y`} no se guardará{vacios === 1 ? '' : 'n'}.</Callout>
      )}

      <div className="row justify-end gap-8">
        {/* A una dirección fija, no `router.back()`: desde un enlace directo sacaba de la app. */}
        {sucio && <span className="small muted" style={{ alignSelf: 'center', marginRight: 'auto' }} data-testid="sin-guardar">Cambios sin guardar</span>}
        <Button variant="secondary" onClick={() => (sucio ? setSalirA('/rutinas') : router.push('/rutinas'))}>{sucio ? 'Descartar' : 'Volver'}</Button>
        <Button icon={<Save />} loading={guardando} disabled={!listo} onClick={() => void guardar()}>{inicial ? 'Guardar cambios' : 'Crear rutina'}</Button>
      </div>

      {quitarDia && (
        <Dialog open onClose={() => setQuitarDia(false)} title={`¿Quitar «${dia.name || 'este día'}»?`}
          footer={<><Button variant="secondary" onClick={() => setQuitarDia(false)}>Conservarlo</Button><Button variant="danger" icon={<Trash2 />} onClick={quitarElDia}>Quitar día</Button></>}>
          <p>Se quitan sus {dia.items.length} {dia.items.length === 1 ? 'ejercicio' : 'ejercicios'}. Hasta que guardes puedes descartar los cambios.</p>
        </Dialog>
      )}
      {salirA && (
        <Dialog open onClose={() => setSalirA(null)} title="¿Salir sin guardar?"
          footer={<><Button variant="secondary" onClick={() => setSalirA(null)}>Seguir editando</Button><Button variant="danger" onClick={() => { original.current = foto({ nombre, objetivo, nivel, notas, dias }); const a = salirA; setSalirA(null); router.push(a); }}>Salir sin guardar</Button></>}>
          <p>Los cambios a esta rutina se pierden.</p>
        </Dialog>
      )}
      {eligiendo && (
        <SelectorEjercicios diaNombre={dia.name} onClose={() => setEligiendo(false)}
          onAgregar={(ejs) => {
            cambiarDia((d) => ({
              ...d,
              items: [...d.items, ...ejs.map((e) => ({
                exerciseId: e.id, sets: 3, reps: '10-12', restSeconds: 60, notes: null,
                exercise: { name: e.name, muscleGroup: e.muscleGroup, equipment: e.equipment, instructions: e.instructions },
              }))],
            }));
            setEligiendo(false);
          }} />
      )}
    </div>
  );
}

/** El catálogo por bloque muscular: se marcan varios y se agregan de una vez. */
function SelectorEjercicios({ diaNombre, onClose, onAgregar }: { diaNombre: string; onClose: () => void; onAgregar: (e: Ejercicio[]) => void }) {
  const toast = useToast();
  // Sin red no es un catálogo vacío (26-01): se dice y se reintenta.
  const catalogoCarga = useCarga(useCallback(() => api<{ exercises: Ejercicio[] }>('/exercises').then((r) => r.exercises), []));
  const catalogo = catalogoCarga.datos ?? null;
  const setCatalogo = catalogoCarga.poner;
  const [grupo, setGrupo] = useState<Grupo>('CHEST');
  const [q, setQ] = useState('');
  const [marcados, setMarcados] = useState<Ejercicio[]>([]);
  const [nuevo, setNuevo] = useState<{ name: string; equipment: string } | null>(null);


  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (catalogo ?? []).filter((e) => (t ? e.name.toLowerCase().includes(t) : e.muscleGroup === grupo));
  }, [catalogo, grupo, q]);

  async function crear() {
    if (!nuevo?.name.trim()) return;
    try {
      const e = await api<Ejercicio>('/exercises', { method: 'POST', body: JSON.stringify({ name: nuevo.name.trim(), muscleGroup: grupo, equipment: nuevo.equipment.trim() || null }) });
      setCatalogo((c) => [...(c ?? []), e]);
      setMarcados((m) => [...m, e]);
      setNuevo(null);
    } catch (err) { toast('error', errorText(err, 'No se pudo crear')); }
  }

  return (
    <Dialog open size="lg" onClose={onClose} title={`Agregar a «${diaNombre}»`} sub="Elige el bloque muscular y marca los ejercicios. Se agregan en el orden en que los marques."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={<Plus />} disabled={marcados.length === 0} onClick={() => onAgregar(marcados)}>
          {marcados.length === 0 ? 'Agregar' : `Agregar ${marcados.length}`}
        </Button></>}>
      <div className="stack">
        <div className="rt-grupos" role="group" aria-label="Bloque muscular">
          {GRUPOS.map((g) => (
            <button key={g.value} type="button" aria-pressed={!q && g.value === grupo} onClick={() => { setGrupo(g.value); setQ(''); }}>{g.label}</button>
          ))}
        </div>
        <div className="input-icon"><Search /><input className="input" placeholder="Buscar en todo el catálogo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ul className="rt-catalogo">
          {catalogoCarga.error && <li><ErrorCarga titulo="No se pudo cargar el catálogo de ejercicios" mensaje={catalogoCarga.error} onReintentar={() => void catalogoCarga.recargar()} /></li>}
          {catalogo === null && !catalogoCarga.error && <li className="muted small">Cargando catálogo…</li>}
          {visibles.map((e) => {
            const n = marcados.findIndex((m) => m.id === e.id);
            return (
              <li key={e.id}>
                <button type="button" aria-pressed={n >= 0}
                  onClick={() => setMarcados((m) => (n >= 0 ? m.filter((x) => x.id !== e.id) : [...m, e]))}>
                  <span className="rt-check">{n >= 0 ? n + 1 : ''}</span>
                  <span className="flex-1 min-w-0">
                    <span className="strong small">{e.name}</span>{e.custom && <Badge>Del gimnasio</Badge>}
                    <span className="tiny muted block">{q ? `${GRUPO[e.muscleGroup]} · ` : ''}{e.equipment}{e.instructions ? ` · ${e.instructions}` : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {/* Sin el catálogo a la vista no se ofrece crear uno: saldría repetido. */}
        {!q && catalogo !== null && (nuevo ? (
          <div className="row gap-8">
            <input className="input" autoFocus placeholder={`Nuevo ejercicio de ${GRUPO[grupo]?.toLowerCase()}`} value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} />
            <input className="input" style={{ width: 160 }} placeholder="Equipo" value={nuevo.equipment} onChange={(e) => setNuevo({ ...nuevo, equipment: e.target.value })} />
            <Button size="sm" disabled={nuevo.name.trim().length < 2} onClick={() => void crear()}>Crear</Button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNuevo({ name: '', equipment: '' })}>
            <Plus />¿No está? Agrega un ejercicio del gimnasio
          </button>
        ))}
      </div>
    </Dialog>
  );
}
