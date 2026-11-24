'use client';

import { useMemo } from 'react';
import { Ban, CalendarX2, ListChecks, MapPin, UserPlus, UserRound } from 'lucide-react';
import { capital, dia, fechaCorta, hora } from '@/lib/format';
import { masDias } from '@/lib/zonas';
import { momentoDeClase, type Sesion } from '@/lib/clases';
import { Badge, Button, Card, Empty, EsqueletoLista, MenuMas } from '@/components/ui';

/** El día de calendario de un instante en la zona de la sucursal (`AAAA-MM-DD`). */
const diaEn = (iso: string, zona: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: zona });

/**
 * SESIONES: hoy y los próximos días, agrupados por día (11-12).
 *
 * Antes era una lista plana de hasta 56 filas iguales, cada una con su
 * «Cancelar sesión» a la vista. Ahora cada día es un bloque con su resumen,
 * la tira de arriba salta al día que se busca, la fila tiene UNA acción
 * (inscribir o pasar lista) y cancelar vive en «Más». Las horas son las de
 * la sucursal, no las de la computadora.
 */
export function Sesiones({ sesiones, zona, hoy, puede, onAbrir, onCancelar, vacio, sinNada }: {
  sesiones: Sesion[] | null; zona: string;
  /** Hoy en la sucursal (`AAAA-MM-DD`). */
  hoy: string;
  /** `cancelar`: solo la gerencia (D-28). `soloLasDe`: quien es solo coach inscribe en las sesiones que imparte. */
  puede: { verLista: boolean; inscribir: boolean; cancelar: boolean; soloLasDe?: string | null };
  onAbrir: (s: Sesion, inscribir: boolean) => void;
  onCancelar: (s: Sesion) => void;
  /** Lo que se ofrece cuando no hay ninguna sesión en la semana. */
  vacio?: React.ReactNode;
  /** Cómo se dice que la semana está vacía (por omisión, «Sin sesiones en los próximos 7 días»). */
  sinNada?: { titulo: string; texto: string };
}) {
  const vigentes = useMemo(() => (sesiones ?? []).filter((x) => x.status !== 'CANCELED'), [sesiones]);
  const canceladas = useMemo(() => (sesiones ?? []).filter((x) => x.status === 'CANCELED'), [sesiones]);
  const porDia = useMemo(() => {
    const m = new Map<string, Sesion[]>();
    for (const s of vigentes) { const k = diaEn(s.startsAt, zona); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [vigentes, zona]);
  const semana = Array.from({ length: 7 }, (_, i) => masDias(hoy, i));
  const conSesiones = [...porDia.keys()].filter((k) => k !== hoy).sort();
  const siguiente = vigentes.find((s) => diaEn(s.startsAt, zona) > hoy);

  function fila(s: Sesion) {
    const pct = Math.round((s.bookedCount / Math.max(1, s.capacity)) * 100);
    const momento = momentoDeClase(s);
    const cancelada = s.status === 'CANCELED';
    const terminada = s.status === 'CLOSED' || momento === 'TERMINADA';
    const abre = !cancelada && puede.verLista;
    const enLista = !terminada && (momento === 'LISTA' || momento === 'EN_CURSO');
    // D-28: quien es solo coach opera las sesiones que imparte; en las demás ve el cupo.
    const laOpera = !puede.soloLasDe || s.coachUserId === puede.soloLasDe;
    return (
      <li key={s.id} className={`list-item sesion-fila${abre ? ' is-link' : ''}`} data-cancelada={cancelada || undefined}
        onClick={() => { if (abre) onAbrir(s, false); }}
        tabIndex={abre ? 0 : undefined} role={abre ? 'button' : undefined}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && abre) { e.preventDefault(); onAbrir(s, false); } }}>
        <div className="sesion-cuando">
          <div className="sesion-hora num">{hora(s.startsAt, zona)}</div>
          <div className="tiny muted">
            {cancelada ? capital(fechaCorta(s.startsAt, zona))
              : momento === 'EN_CURSO' && !terminada ? <span className="sesion-estado" data-estado="curso">En curso</span>
                : momento === 'LISTA' && !terminada ? <span className="sesion-estado" data-estado="lista">Lista abierta</span>
                  : <span className="num">a {hora(s.endsAt, zona)}</span>}
          </div>
        </div>
        <div className="sesion-que">
          <div className="strong">{s.className}</div>
          <div className="tiny muted row gap-8 flex-wrap">
            {s.coachName && <span className="row gap-4"><UserRound size={11} />{s.coachName}</span>}
            {s.room && <span className="row gap-4"><MapPin size={11} />{s.room}</span>}
            {s.templateId === null && <span>Sesión única</span>}
          </div>
        </div>
        <div className="sesion-cupo">
          <div className="row-between tiny"><span className="muted">Reservados</span><span className="num strong">{s.bookedCount}/{s.capacity}</span></div>
          <div className={`meter${pct >= 90 ? ' is-warn' : ''} mt-4`}><div style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="sesion-accion">
          {cancelada ? <Badge>Cancelada</Badge>
            : terminada ? <Badge>Terminada</Badge>
              : (
                <div className="row gap-6">
                  {enLista && puede.verLista && laOpera ? <Button size="sm" icon={<ListChecks />} onClick={(e) => { e.stopPropagation(); onAbrir(s, false); }}>Pasar lista</Button>
                    : puede.inscribir && laOpera ? (
                      // Recepción inscribe a un socio en un toque (antes había que abrir la lista y descubrir el buscador).
                      s.bookedCount >= s.capacity ? <Badge tone="warn" dot>Llena</Badge>
                        : <Button size="sm" variant="secondary" icon={<UserPlus />} onClick={(e) => { e.stopPropagation(); onAbrir(s, true); }}>Inscribir</Button>
                    ) : <Badge tone="ok" dot>Programada</Badge>}
                  {/* Lo destructivo no se queda a un clic de «Inscribir» en cada fila (11-12): va en «Más». */}
                  {puede.cancelar && (
                    <MenuMas tam="sm" etiqueta={`Más acciones de ${s.className ?? 'la sesión'} de las ${hora(s.startsAt, zona)}`}
                      items={[{ label: 'Cancelar sesión', icon: <Ban />, peligro: true, onClick: () => onCancelar(s) }]} />
                  )}
                </div>
              )}
        </div>
      </li>
    );
  }

  const titulo = (k: string) => (k === hoy ? `Hoy · ${dia(k, { weekday: 'long', day: 'numeric', month: 'long' })}` : capital(dia(k, { weekday: 'long', day: 'numeric', month: 'long' })));
  const resumen = (xs: Sesion[]) => {
    const lugares = xs.reduce((a, s) => a + s.bookedCount, 0);
    return `${xs.length} ${xs.length === 1 ? 'clase' : 'clases'} · ${lugares} ${lugares === 1 ? 'lugar reservado' : 'lugares reservados'}`;
  };
  const irA = (k: string) => document.getElementById(`dia-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (sesiones === null) return <Card pad={false}><EsqueletoLista filas={5} /></Card>;
  const semanaVacia = vigentes.length === 0;
  const deHoy = porDia.get(hoy) ?? [];
  return (
    <>
      <div className="dias-tira" role="group" aria-label="Ir a un día">
        {semana.map((k) => {
          const n = porDia.get(k)?.length ?? 0;
          return (
            <button key={k} type="button" className="dia-ficha" data-hoy={k === hoy || undefined} disabled={n === 0} onClick={() => irA(k)}
              aria-label={`${titulo(k)}: ${n === 0 ? 'sin clases' : `${n} ${n === 1 ? 'clase' : 'clases'}`}`}>
              <span className="dia-ficha-nombre">{k === hoy ? 'Hoy' : dia(k, { weekday: 'short' }).replace('.', '')}</span>
              <span className="dia-ficha-num num">{Number(k.slice(8))}</span>
              <span className="dia-ficha-cuantas">{n === 0 ? '—' : `${n} ${n === 1 ? 'clase' : 'clases'}`}</span>
            </button>
          );
        })}
      </div>

      <section className="mb-20" id={`dia-${hoy}`} data-testid="clases-hoy">
        <div className="dia-cabecera"><h2 className="section-title m-0">{titulo(hoy)}</h2>{deHoy.length > 0 && <span className="small muted">{resumen(deHoy)}</span>}</div>
        <Card pad={false}>
          {semanaVacia
            ? <Empty icon={<CalendarX2 />} title={sinNada?.titulo ?? 'Sin sesiones en los próximos 7 días'} text={sinNada?.texto ?? 'Cuando una clase está en el horario semanal, sus sesiones aparecen aquí solas.'} action={vacio} />
            : deHoy.length === 0
            ? <Empty icon={<CalendarX2 />} title="No hay clases hoy" text={siguiente ? `La siguiente: ${siguiente.className}, ${fechaCorta(siguiente.startsAt, zona)} a las ${hora(siguiente.startsAt, zona)}.` : 'No hay más sesiones esta semana.'} />
            : <ul className="list">{deHoy.map(fila)}</ul>}
        </Card>
      </section>

      {conSesiones.map((k) => (
        <section className="mb-20" key={k} id={`dia-${k}`}>
          <div className="dia-cabecera"><h2 className="section-title m-0">{titulo(k)}</h2><span className="small muted">{resumen(porDia.get(k)!)}</span></div>
          <Card pad={false}><ul className="list">{porDia.get(k)!.map(fila)}</ul></Card>
        </section>
      ))}

      {/* Las canceladas no estorban (UX4-13): se pliegan al final. */}
      {canceladas.length > 0 && (
        <Card pad={false}>
          <details className="canceladas-plegadas">
            <summary className="small strong">{canceladas.length} {canceladas.length === 1 ? 'sesión cancelada' : 'sesiones canceladas'} esta semana</summary>
            <ul className="list">{canceladas.map(fila)}</ul>
          </details>
        </Card>
      )}
    </>
  );
}
