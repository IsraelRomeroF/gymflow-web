'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { Plus, Users, CalendarDays, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { hace } from '@gymflow/ui/format';
import { NIVELES, OBJETIVOS, type Resumen } from '@/lib/rutinas';
import { Badge, ButtonLink, Card, Empty, PageHeader, Skeleton } from '@/components/ui';
import { EstadoCarga, useCarga } from '@gymflow/ui/carga';

/**
 * RUTINAS del gimnasio. El coach las arma una vez y las asigna a muchos
 * socios; cada socio ve la suya en su teléfono.
 */
export default function RutinasPage() {
  // Sin red no es «Todavía no hay rutinas» (26-01).
  const carga = useCarga(useCallback(() => api<{ routines: Resumen[] }>('/routines').then((r) => r.routines), []));

  return (
    <div className="stack gap-24">
      <PageHeader title="Rutinas" sub="Ármalas con el catálogo —diez ejercicios por bloque muscular— y asígnalas desde aquí o desde la ficha del socio."
        actions={<ButtonLink href="/rutinas/nueva" variant="primary" icon={<Plus />}><span>Nueva rutina</span></ButtonLink>} />
      <EstadoCarga carga={carga} titulo="No se pudieron cargar las rutinas"
        esqueleto={<div className="grid grid-3"><Skeleton h={150} r={16} /><Skeleton h={150} r={16} /><Skeleton h={150} r={16} /></div>}
        vacio={<Card><Empty icon={<ListChecks />} title="Todavía no hay rutinas" text="Crea la primera: se arma por días y los ejercicios salen del catálogo."
          action={<ButtonLink href="/rutinas/nueva" variant="primary" icon={<Plus />}><span>Nueva rutina</span></ButtonLink>} /></Card>}>
        {(rutinas) => (
        <div className="grid grid-3">
          {rutinas.map((r) => (
            <Link key={r.id} href={`/rutinas/${r.id}`} className="card card-pad rt-card">
              <div className="row wrap gap-6">
                {r.goal && <Badge tone="volt">{OBJETIVOS[r.goal] ?? r.goal}</Badge>}
                {r.level && <Badge>{NIVELES[r.level] ?? r.level}</Badge>}
              </div>
              <h3 className="rt-card-nombre">{r.name}</h3>
              <p className="tiny muted ellipsis">{r.dayNames.join(' · ')}</p>
              <div className="row small muted" style={{ gap: 14, marginTop: 'auto' }}>
                <span className="row gap-4"><CalendarDays size={14} />{r.days} {r.days === 1 ? 'día' : 'días'}</span>
                <span className="row gap-4"><ListChecks size={14} />{r.exercises}</span>
                <span className="row gap-4"><Users size={14} />{r.activeMembers} {r.activeMembers === 1 ? 'socio' : 'socios'}</span>
              </div>
              <p className="tiny muted">Editada {hace(r.updatedAt)}</p>
            </Link>
          ))}
        </div>
        )}
      </EstadoCarga>
    </div>
  );
}
