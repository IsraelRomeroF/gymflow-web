'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Repeat, X, ListChecks, Printer, UserPen } from 'lucide-react';
import type { MemberRoutine, RoutinePersonalized } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha } from '@/lib/format';
import { GRUPO, NIVELES, OBJETIVOS, descanso, haceSemanas } from '@/lib/rutinas';
import { useSession, useToast, errorText } from './session';
import { Badge, Button, ButtonLink, CampoMotivo, Card, Dialog, Empty, ErrorCarga, Skeleton } from './ui';
import { useCarga } from '@/lib/carga';
import { AsignarRutinaDialog } from './rutina-asignar';

/**
 * La rutina del socio en su ficha: la que ve en su teléfono.
 *
 * Quien asigna (coach y gerencia) la cambia, la personaliza y la quita. Quien
 * solo la consulta (recepción, `training:read`) la ve y la imprime: contesta
 * «¿ya me subieron mi rutina?» y se la da en papel a quien no usa el teléfono
 * (12-17). Arriba, lo que el coach necesita saber de un vistazo: desde cuándo
 * la tiene, cuándo toca revisarla y cómo va esta semana (12-02, 12-09).
 */
export function RutinaSocioTab({ memberId, nombre, nombreCompleto = nombre }: { memberId: string; nombre: string; nombreCompleto?: string }) {
  const toast = useToast();
  const router = useRouter();
  const { can } = useSession();
  const asigna = can('training:assign');
  const arma = can('training:template:manage');
  const [eligiendo, setEligiendo] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [personalizando, setPersonalizando] = useState(false);
  // Por qué se quita, si se dice: queda en la bitácora (12-08).
  const [motivoQuitar, setMotivoQuitar] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin red no es «{nombre} no tiene rutina» (26-01): se dice y se reintenta.
  const carga = useCarga(useCallback(() => api<MemberRoutine>(`/members/${memberId}/routine`).then((r) => r.assignment), [memberId]));
  const a = carga.datos;
  const cargar = carga.recargar;
  const socio = { id: memberId, nombre, nombreCompleto };

  async function quitar() {
    setEnviando(true);
    try {
      const motivo = motivoQuitar.trim();
      await api(`/members/${memberId}/routine/end`, { method: 'POST', body: JSON.stringify(motivo ? { reason: motivo } : {}) });
      setQuitando(false);
      setMotivoQuitar('');
      toast('ok', `${nombre} ya no tiene rutina`);
      await cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo quitar la rutina')); } finally { setEnviando(false); }
  }

  async function personalizar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await api<RoutinePersonalized>(`/members/${memberId}/routine/personalize`, { method: 'POST', body: '{}' });
      toast('ok', `Ahora es solo de ${nombre}: lo que cambies no le llega a nadie más`);
      router.push(`/rutinas/${r.routineId}`);
    } catch (e) { setError(errorText(e, 'No se pudo personalizar')); setEnviando(false); }
  }

  if (carga.error) return <ErrorCarga titulo={`No se pudo cargar la rutina de ${nombreCompleto}`} mensaje={carga.error} onReintentar={() => void cargar()} />;
  if (a === undefined) return <Skeleton h={200} r={16} />;
  if (!a?.routine) {
    return (
      <>
        <Card><Empty icon={<ListChecks />} title={`${nombre} no tiene rutina`}
          text={asigna ? 'Asígnale una del catálogo del gimnasio: la verá en su teléfono.' : 'Su coach o la gerencia se la asignan; en cuanto la tenga, aquí se ve y se imprime.'}
          action={asigna ? <Button size="sm" icon={<ListChecks />} onClick={() => setEligiendo(true)}>Asignar rutina</Button> : undefined} /></Card>
        {eligiendo && <AsignarRutinaDialog socio={socio} onClose={() => setEligiendo(false)} onListo={() => void cargar()} />}
      </>
    );
  }

  const r = a.routine;
  const p = a.progress;
  const esPersonal = r.personalFor?.memberId === memberId;
  const otros = r.activeMembers - 1;
  const hoyToca = p ? r.days[p.nextDay - 1] : undefined;
  return (
    <div className="stack">
      <Card title={arma ? <Link href={`/rutinas/${r.id}`}>{r.name}</Link> : r.name}
        sub={`Asignada el ${fecha(a.assignedAt)}${a.assignedBy ? ` por ${a.assignedBy}` : ''}`}
        actions={<div className="row wrap gap-8">
          {asigna && <Button size="sm" variant="secondary" icon={<Repeat />} onClick={() => setEligiendo(true)}>Cambiar</Button>}
          {asigna && arma && !esPersonal && <Button size="sm" variant="secondary" icon={<UserPen />} onClick={() => { setError(null); setPersonalizando(true); }}>Personalizar</Button>}
          <ButtonLink size="sm" href={`/recibo/rutina/${memberId}`} icon={<Printer />}>Imprimir</ButtonLink>
          {asigna && <Button size="sm" variant="ghost" icon={<X />} onClick={() => setQuitando(true)}>Quitar</Button>}
        </div>}>
        <div className="row wrap gap-6 mb-12">
          {esPersonal && <Badge tone="info">Personal de {nombre}</Badge>}
          {r.goal && <Badge tone="volt">{OBJETIVOS[r.goal] ?? r.goal}</Badge>}
          {r.level && <Badge>{NIVELES[r.level] ?? r.level}</Badge>}
        </div>
        <dl className="rt-cifras mb-12" data-testid="rutina-cifras">
          <div><dt>La tiene</dt><dd>desde {haceSemanas(a.assignedAt)}</dd></div>
          <div data-tono={a.reviewDue ? 'warn' : undefined}>
            <dt>Revisión</dt>
            <dd>{a.reviewOn ? (a.reviewDue ? `Tocaba el ${fecha(a.reviewOn)}` : `El ${fecha(a.reviewOn)}`) : 'Sin fecha'}</dd>
          </div>
          {p && (
            <div data-tono={p.doneThisWeek.length > 0 ? 'ok' : undefined}>
              <dt>Esta semana</dt>
              <dd>{p.doneThisWeek.length} de {r.days.length} {r.days.length === 1 ? 'día' : 'días'}</dd>
            </div>
          )}
          {p && hoyToca && (
            <div>
              <dt>{p.doneToday ? 'Hoy hizo' : 'Le toca'}</dt>
              <dd>Día {p.nextDay} · {hoyToca.name}</dd>
            </div>
          )}
        </dl>
        {p && <p className="tiny muted mb-12">{p.lastDone ? `Último día que marcó en su teléfono: día ${p.lastDone.day}, el ${fecha(p.lastDone.on)}.` : 'Todavía no marca ningún día como hecho en su teléfono.'}</p>}
        {a.notes && <p className="small mb-12"><span className="muted">Nota para {nombre}:</span> {a.notes}</p>}
        <div className="grid grid-2">
          {r.days.map((d, i) => (
            <div key={i} className="card card-pad-sm">
              <p className="section-label">Día {i + 1} · {d.name}{p?.doneThisWeek.includes(i + 1) ? ' · hecho esta semana' : ''}</p>
              <ol className="rt-lista">
                {d.items.map((it, k) => (
                  <li key={k}>
                    <span className="small strong">{it.exercise.name}</span>
                    <span className="tiny muted"> {it.sets}×{it.reps} · {descanso(it.restSeconds)} · {GRUPO[it.exercise.muscleGroup] ?? it.exercise.muscleGroup}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>
      {eligiendo && <AsignarRutinaDialog socio={socio} onClose={() => setEligiendo(false)} onListo={() => void cargar()} />}
      {/* Personalizar la separa de los demás: se dice a cuántos deja de llegarles lo que se cambie (12-05). */}
      {personalizando && (
        <Dialog open onClose={() => { if (!enviando) setPersonalizando(false); }} title={`¿Personalizar «${r.name}» para ${nombreCompleto}?`} error={error}
          footer={<><Button variant="secondary" disabled={enviando} onClick={() => setPersonalizando(false)}>Cancelar</Button>
            <Button icon={<UserPen />} loading={enviando} onClick={() => void personalizar()}>Personalizar y editar</Button></>}>
          <div className="stack-sm">
            <p className="small">Se hace una copia solo para {nombre} y se abre para que la ajustes. Conserva su fecha de revisión, su nota y los días que ya marcó.</p>
            <p className="small muted">{otros > 0
              ? `«${r.name}» la ${otros === 1 ? 'sigue teniendo 1 socio más' : `siguen teniendo ${otros} socios más`}: lo que cambies en la copia no les llega.`
              : `La original se queda en el catálogo para asignarla a otros.`}</p>
          </div>
        </Dialog>
      )}
      {/* Quitar no tiene vuelta atrás desde aquí: se confirma nombrando a la persona (12-08). */}
      {quitando && (
        <Dialog open onClose={() => { if (!enviando) { setQuitando(false); setMotivoQuitar(''); } }} title={`¿Quitar la rutina de ${nombreCompleto}?`}
          sub={`«${r.name}», asignada el ${fecha(a.assignedAt)}.`}
          footer={<><Button variant="secondary" disabled={enviando} onClick={() => { setQuitando(false); setMotivoQuitar(''); }}>Cancelar</Button>
            <Button variant="danger" icon={<X />} loading={enviando} onClick={() => void quitar()}>Quitar rutina</Button></>}>
          <div className="stack">
            <p className="small">Se queda sin rutina en su teléfono. Puedes asignarle otra cuando quieras.</p>
            <CampoMotivo id="quitar-rutina-motivo" label="Motivo (opcional)" required={false} value={motivoQuitar} onChange={setMotivoQuitar} placeholder="Terminó su programa" />
          </div>
        </Dialog>
      )}
    </div>
  );
}
