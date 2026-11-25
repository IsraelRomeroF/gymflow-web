'use client';

import { use, useCallback } from 'react';
import { ListChecks, Printer } from 'lucide-react';
import type { MemberRoutine } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, hoyEn } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';
import { GRUPO, NIVELES, OBJETIVOS, descanso } from '@/lib/rutinas';
import { useSession } from '@/components/session';
import { Button, Empty, ErrorCarga, Skeleton } from '@/components/ui';

type Socio = { id: string; memberCode: string; firstName: string; lastName: string; homeBranchId: string | null };

/**
 * LA RUTINA DEL SOCIO EN PAPEL (auditoría 8, bloque 2.6; 12-17, D12-06).
 *
 * Para el socio sin teléfono o sin portal: recepción, el coach o la gerencia
 * la imprimen (o la guardan como PDF) desde la pestaña Rutina de su ficha. Lo
 * mismo que ve en su teléfono: por día, series × repeticiones, descanso, la
 * técnica en una frase y la nota de su coach. En blanco y negro.
 */
export default function RutinaParaElSocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, branchName } = useSession();
  const carga = useCarga(useCallback(async () => {
    const [socio, rutina] = await Promise.all([api<Socio>(`/members/${id}`), api<MemberRoutine>(`/members/${id}/routine`)]);
    return { socio, a: rutina.assignment };
  }, [id]));

  if (carga.error) return <ErrorCarga titulo="No se pudo armar la hoja de la rutina" mensaje={carga.error} onReintentar={() => void carga.recargar()} />;
  const d = carga.datos;
  if (!d) return <div className="estado-doc"><Skeleton h={520} r={12} /></div>;
  const r = d.a?.routine;
  if (!d.a || !r) return <Empty icon={<ListChecks />} title={`${d.socio.firstName} no tiene rutina`} text="En cuanto su coach le asigne una, aquí se imprime." />;

  return (
    <div className="stack items-center">
      <div className="no-print row wrap gap-12">
        <Button icon={<Printer />} onClick={() => window.print()}>Imprimir o guardar como PDF</Button>
      </div>
      <article className="estado-doc rutina-doc" data-testid="rutina-para-el-socio">
        <header>
          <div>
            <p className="estado-doc-org">{org.tradeName}</p>
            {d.socio.homeBranchId && <p>{branchName(d.socio.homeBranchId)}</p>}
          </div>
          <div className="estado-doc-titulo">
            <h1>{r.name}</h1>
            <p>{[r.goal ? OBJETIVOS[r.goal] ?? r.goal : null, r.level ? NIVELES[r.level] ?? r.level : null].filter(Boolean).join(' · ') || 'Rutina de entrenamiento'}</p>
          </div>
        </header>
        <p className="estado-doc-socio">{d.socio.firstName} {d.socio.lastName} <span>· {d.socio.memberCode}</span></p>
        <p className="estado-doc-nota">
          Asignada el {fecha(d.a.assignedAt)}{d.a.assignedBy ? ` por ${d.a.assignedBy}` : ''}{d.a.reviewOn ? ` · Se revisa el ${fecha(d.a.reviewOn)}` : ''}
        </p>
        {d.a.notes && <p className="rutina-doc-nota"><strong>Para ti:</strong> {d.a.notes}</p>}
        {r.notes && <p className="rutina-doc-nota"><strong>Indicaciones:</strong> {r.notes}</p>}

        {r.days.map((dia, i) => (
          <section key={i} className="rutina-doc-dia">
            <h2>Día {i + 1} · {dia.name}</h2>
            <table>
              <thead><tr><th>#</th><th>Ejercicio</th><th className="num">Series × reps</th><th className="num">Descanso</th></tr></thead>
              <tbody>
                {dia.items.map((it, k) => (
                  <tr key={k}>
                    <td>{k + 1}</td>
                    <td>
                      <strong>{it.exercise.name}</strong>
                      <span className="estado-doc-nota"> · {GRUPO[it.exercise.muscleGroup] ?? it.exercise.muscleGroup}{it.exercise.equipment ? ` · ${it.exercise.equipment}` : ''}</span>
                      {it.exercise.instructions && <p className="estado-doc-nota">{it.exercise.instructions}</p>}
                      {it.notes && <p>Nota de tu coach: {it.notes}</p>}
                    </td>
                    <td className="num">{it.sets} × {it.reps}</td>
                    <td className="num">{descanso(it.restSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <footer>Impresa el {fecha(hoyEn(org.timezone))}. Tu rutina también está en tu teléfono, en el portal del gimnasio: pide tu código en recepción.</footer>
      </article>
    </div>
  );
}
