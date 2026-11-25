'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarDays, ClipboardCheck, ListChecks, Plus, Search, Users } from 'lucide-react';
import type { CoachMember, CoachToday } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, hace, hora, hoyEn } from '@gymflow/ui/format';
import { zonaDe } from '@/lib/zonas';
import { useCarga } from '@gymflow/ui/carga';
import { NIVELES, OBJETIVOS } from '@/lib/rutinas';
import { useSession } from '@/components/session';
import { Badge, ButtonLink, Card, Empty, ErrorCarga, PageHeader, Skeleton } from '@/components/ui';
import { HacermeSuCoach } from '@/components/hacerme-su-coach';

type Sesion = {
  id: string; branchId: string; className: string | null; coachUserId: string | null;
  startsAt: string; endsAt: string; capacity: number; bookedCount: number; status: string;
};
type Grupo = 'sinRutina' | 'sinVenir' | 'porRevisar';

function saludo(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/**
 * EL INICIO DEL COACH (auditoría 8, bloque 2.6; 12-04, 1-05).
 *
 * Antes era el de recepción sin dinero: las entradas de todo el gimnasio, la
 * siguiente clase de cualquiera y «Todo al día». Ahora contesta lo suyo en
 * tres bloques:
 *
 *  · «Hoy: tus clases»: las sesiones que imparte hoy, con «Pasar lista».
 *  · «Tus socios»: cuántos tiene y, de ellos, quién no tiene rutina, quién
 *    no ha venido en 7 días y a quién toca revisarle la rutina. Cada cifra
 *    abre su lista aquí mismo.
 *  · «Tus rutinas»: las que armó, y «Nueva rutina».
 *
 * No trae la afluencia del gimnasio ni «Por resolver» (no hay nada del
 * mostrador que él resuelva), ni teléfonos (D-30).
 */
export function InicioCoach() {
  const router = useRouter();
  const { me, org, branches, can, activo, branchName, inScope } = useSession();
  const conClases = activo('classes') && can('classes:read');
  const conRutinas = activo('training');
  const armaRutinas = conRutinas && can('training:template:manage');
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [q, setQ] = useState('');

  const dia = useCarga(useCallback(() => api<CoachToday>('/coach/today'), []));
  const pedirClases = useCallback(async () => {
    // De hace unas horas (una clase que ya empezó también se pasa lista) a mañana; «hoy» lo decide la zona de cada sede.
    const desde = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const hasta = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const r = await api<{ schedules: Sesion[] }>(`/classes/schedules?mine=1&from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`);
    return r.schedules;
  }, []);
  const clases = useCarga(conClases ? pedirClases : null);

  const nombre = (me.fullName ?? '').split(' ')[0];
  const hoyLargo = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: org.timezone });
  const zonaDeSede = (id: string) => zonaDe(branches.find((b) => b.id === id), org);
  const misClases = (clases.datos ?? []).filter((s) => s.coachUserId === me.userId && s.status === 'SCHEDULED'
    && hoyEn(zonaDeSede(s.branchId), new Date(s.startsAt)) === hoyEn(zonaDeSede(s.branchId)));

  const d = dia.datos;
  const listas: Record<Grupo, { titulo: string; vacio: string; socios: CoachMember[] }> = {
    sinRutina: { titulo: 'Sin rutina', vacio: 'Todos tus socios tienen rutina.', socios: d?.members.withoutRoutine ?? [] },
    sinVenir: { titulo: 'Sin venir 7 días o más', vacio: 'Todos han venido esta semana.', socios: d?.members.away ?? [] },
    porRevisar: { titulo: 'Rutina por revisar', vacio: 'Ninguna rutina tiene la revisión vencida.', socios: d?.members.toReview ?? [] },
  };
  const visibles: Grupo[] = conRutinas ? ['sinRutina', 'sinVenir', 'porRevisar'] : ['sinVenir'];
  // Sin elegir, se abre el primer grupo que tenga a alguien: lo que hay que atender.
  const abierto = grupo ?? visibles.find((g) => listas[g].socios.length > 0) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={hoyLargo.charAt(0).toUpperCase() + hoyLargo.slice(1)}
        title={`${saludo()}${nombre ? `, ${nombre}` : ''}`}
        sub={`${org.tradeName} · ${branches.filter((b) => b.isActive && inScope(b.id)).map((b) => b.name).join(', ')}`}
      />

      <div className="stack gap-24" data-testid="inicio-coach">
        {conClases && (
          <Card title={<span className="row gap-8"><CalendarDays size={18} />Hoy: tus clases</span>} pad={false}
            actions={<Link href="/clases?mine=1" className="small strong row gap-4">Mis clases <ArrowRight size={14} /></Link>}>
            {clases.error ? <div className="card-pad"><ErrorCarga titulo="No se pudieron cargar tus clases" mensaje={clases.error} onReintentar={() => void clases.recargar()} /></div>
              : !clases.datos ? <div className="card-pad"><Skeleton h={56} /></div>
                : misClases.length === 0 ? <p className="small muted grupo-vacio">Hoy no impartes ninguna clase.</p> : (
                  <ul className="list">
                    {misClases.map((s) => (
                      <li key={s.id} className="list-item row-between gap-12">
                        <span className="coach-clase">
                          <span className="strong">{hora(s.startsAt, zonaDeSede(s.branchId))} · {s.className ?? 'Clase'}</span>
                          <span className="tiny muted">{branchName(s.branchId)} · {s.bookedCount} de {s.capacity} lugares reservados</span>
                        </span>
                        <ButtonLink size="sm" href="/clases?mine=1" icon={<ClipboardCheck />}>Pasar lista</ButtonLink>
                      </li>
                    ))}
                  </ul>
                )}
          </Card>
        )}

        <Card title={<span className="row gap-8"><Users size={18} />Tus socios</span>}
          sub="Los que tienes asignados. Toca una cifra para ver quiénes son."
          actions={<div className="row gap-8 flex-wrap">
            <form role="search" className="row gap-8" data-testid="buscar-inicio"
              onSubmit={(e) => { e.preventDefault(); router.push(q.trim() ? `/socios?q=${encodeURIComponent(q.trim())}` : '/socios'); }}>
              <div className="input-icon coach-buscar"><Search /><input className="input" aria-label="Buscar en mis socios" placeholder="Nombre o código" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            </form>
            {/* D-29: se suma a un socio sin coach con el código que el socio le dicta. */}
            <HacermeSuCoach alLigar={() => void dia.recargar()} />
          </div>}>
          {dia.error ? <ErrorCarga titulo="No se pudieron cargar tus socios" mensaje={dia.error} onReintentar={() => void dia.recargar()} />
            : !d ? <div className="grid grid-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={84} r={12} />)}</div>
              : d.members.total === 0 ? (
                <Empty icon={<Users />} title="Aún no tienes socios asignados" text="Recepción elige el coach al dar de alta a cada socio y la gerencia lo cambia después. Si un socio sin coach está contigo, usa «Hacerme su coach» con el código que genera en su teléfono." />
              ) : (
                <div className="stack">
                  <div className={`grid ${conRutinas ? 'grid-4' : 'grid-2'}`}>
                    <Link href="/socios" className="coach-cifra" aria-label={`${d.members.total} socios asignados: ver Mis socios`}>
                      <span className="coach-cifra-num">{d.members.total}</span>
                      <span className="coach-cifra-que">{d.members.total === 1 ? 'Socio asignado' : 'Socios asignados'}</span>
                    </Link>
                    {visibles.map((g) => (
                      <button key={g} type="button" className="coach-cifra" aria-pressed={abierto === g} data-grupo={g}
                        data-tono={listas[g].socios.length === 0 ? undefined : g === 'sinVenir' ? 'danger' : 'warn'} onClick={() => setGrupo(g)}>
                        <span className="coach-cifra-num">{listas[g].socios.length}</span>
                        <span className="coach-cifra-que">{listas[g].titulo}</span>
                      </button>
                    ))}
                  </div>
                  {abierto && (
                    <div className="coach-lista" data-testid="coach-lista">
                      <p className="section-label">{listas[abierto].titulo} · {listas[abierto].socios.length}</p>
                      {listas[abierto].socios.length === 0 ? <p className="small muted">{listas[abierto].vacio}</p> : (
                        <ul className="list">
                          {listas[abierto].socios.map((s) => (
                            <li key={s.id} className="list-item row-between gap-12">
                              <span className="coach-clase">
                                <Link href={`/socios/${s.id}${conRutinas ? '?tab=rutina' : ''}`} className="strong small row-link">{s.name}</Link>
                                <span className="tiny muted">
                                  <code>{s.memberCode}</code>
                                  {conRutinas && <> · {s.routine ? `«${s.routine}»` : 'Sin rutina'}</>}
                                  {abierto === 'porRevisar' && s.reviewOn && <> · tocaba el {fecha(s.reviewOn)}</>}
                                  {abierto !== 'porRevisar' && <> · {s.lastVisitOn ? `última visita el ${fecha(s.lastVisitOn)}` : 'nunca ha entrado'}</>}
                                </span>
                              </span>
                              {conRutinas && can('training:assign') && (
                                <ButtonLink size="sm" href={`/socios/${s.id}?tab=rutina`}>{s.routine ? 'Ver rutina' : 'Dar rutina'}</ButtonLink>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
        </Card>

        {armaRutinas && (
          <Card title={<span className="row gap-8"><ListChecks size={18} />Tus rutinas</span>}
            actions={<div className="row gap-12">
              <Link href="/rutinas" className="small strong row gap-4">Todas <ArrowRight size={14} /></Link>
              <ButtonLink size="sm" href="/rutinas/nueva" variant="primary" icon={<Plus />}><span>Nueva rutina</span></ButtonLink>
            </div>}>
            {!d ? (dia.error ? <p className="small muted">No se pudieron cargar.</p> : <Skeleton h={96} r={12} />)
              : d.routines.length === 0 ? <p className="small muted">Todavía no has armado ninguna. Las del gimnasio están en Rutinas.</p> : (
                <div className="grid grid-3">
                  {d.routines.slice(0, 3).map((r) => (
                    <Link key={r.id} href={`/rutinas/${r.id}`} className="card card-pad rt-card coach-rutina">
                      <div className="row wrap gap-6">
                        {r.goal && <Badge tone="volt">{OBJETIVOS[r.goal] ?? r.goal}</Badge>}
                        {r.level && <Badge>{NIVELES[r.level] ?? r.level}</Badge>}
                      </div>
                      <h3 className="rt-card-nombre">{r.name}</h3>
                      <p className="tiny muted">{r.days} {r.days === 1 ? 'día' : 'días'} · {r.activeMembers} {r.activeMembers === 1 ? 'socio' : 'socios'} · editada {hace(r.updatedAt)}</p>
                    </Link>
                  ))}
                </div>
              )}
          </Card>
        )}
      </div>
    </>
  );
}
