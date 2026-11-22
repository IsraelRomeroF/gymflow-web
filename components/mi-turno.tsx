'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, DoorOpen, Inbox, Wallet, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AbrirDialog } from '@/components/caja';
import { fecha, hora } from '@/lib/format';
import { hoyEn, masDias, zonaDe } from '@/lib/zonas';
import { useSession } from './session';
import { Badge, Button, Card, ErrorCarga, Skeleton } from './ui';
import { useCarga } from '@/lib/carga';
import type { Shift as Turno } from '@gymflow/core/contracts';

/**
 * MI TURNO (UX5-M-02, UX5-G-02): lo primero que ve quien atiende. Su caja
 * (abrir turno en un clic), cuánta gente ha entrado hoy, qué clase sigue y
 * qué le toca revisar. De SUS sucursales, sin cifras del negocio.
 */
export function MiTurno({ solo }: {
  /**
   * `caja`: solo «Tu caja», y solo si esta persona tiene un turno propio
   * abierto. Es lo que ve en su inicio el gerente que atiende el mostrador
   * (bloque 2.1, DA-21): quien no atiende no ve nada.
   */
  solo?: 'caja';
} = {}) {
  const { can, activo, branches, org } = useSession();
  // Sin red ya no es un esqueleto eterno (26-01): se dice y se reintenta.
  const carga = useCarga(useCallback(() => api<Turno>('/me/shift'), []));
  const t = carga.datos ?? null;
  const cargar = () => { void carga.recargar(); };

  // Abre con el fondo real, no con $0 (MC-01): el mismo diálogo que Caja.
  const [abriendo, setAbriendo] = useState<{ id: string; name: string } | null>(null);

  // Para el gerente «Tu caja» es un extra: si no carga o no atiende, no ocupa lugar ni asusta.
  if (solo === 'caja' && (carga.error || !t)) return null;
  if (carga.error) return <div className="mb-24"><ErrorCarga titulo="No se pudo cargar tu turno" mensaje={carga.error} onReintentar={cargar} /></div>;
  if (!t) return <div className="grid grid-3 mb-24">{[0, 1, 2].map((i) => <Skeleton key={i} h={132} r={12} />)}</div>;
  const entradas = t.branches.reduce((a, b) => a + (b.entriesToday ?? 0), 0);
  const mias = t.branches.flatMap((b) => b.openSessions.filter((s) => s.mine).map((s) => ({ ...s, branch: b.name })));
  const sinTurno = t.branches.flatMap((b) => b.registers.filter((r) => !b.openSessions.some((s) => s.registerName === r.name)).map((r) => ({ ...r, branch: b.name })));
  const sedes = t.branches.map((b) => b.name).join(' · ');
  // Cajas de otras personas que siguen abiertas (UX7 Mostrador 8): antes solo se veía en "Por resolver".
  // «Hoy» y «ayer» son los de la zona de cada sucursal, no los de la computadora (26-06).
  const ajenas = t.branches.flatMap((b) => b.openSessions.filter((s) => !s.mine).map((s) => ({ ...s, zona: zonaDe(branches.find((x) => x.id === b.id), org) })));
  const desde = (iso: string, zona: string) => {
    const dia = hoyEn(zona, new Date(iso)); const hoy = hoyEn(zona);
    if (dia === hoy) return `desde las ${hora(iso)}`;
    return dia === masDias(hoy, -1) ? 'desde ayer' : `desde el ${fecha(iso)}`;
  };
  const avisoAjenas = ajenas.length > 0 && (
    <ul className="stack-sm lista-limpia" data-testid="cajas-ajenas">
      {ajenas.map((s) => {
        const vieja = hoyEn(s.zona, new Date(s.openedAt)) !== hoyEn(s.zona);
        return (
          <li key={s.id} className="small">
            <Badge tone={vieja ? 'warn' : 'neutral'} dot>{s.registerName}</Badge>{' '}
            sigue abierta {desde(s.openedAt, s.zona)}{s.openedByName ? ` (${s.openedByName})` : ''}{vieja ? ': pide el corte.' : '.'}
          </li>
        );
      })}
    </ul>
  );
  const siguiente = t.classesToday[0];
  if (solo === 'caja') {
    if (!t.canSeeCash || !activo('cash') || mias.length === 0) return null;
    return (
      <div className="mb-24" data-testid="tu-caja">
        <Card title={<span className="row gap-8"><Wallet size={18} />Tu caja</span>}>
          <div className="stack-sm">
            {mias.map((s) => <p key={s.id}><Badge tone="ok" dot>Abierta</Badge> <span className="small">{s.registerName} · {s.branch} · desde {hora(s.openedAt)}</span></p>)}
            {avisoAjenas}
            <Link href="/caja" className="small strong row gap-4">Ir a Caja y hacer el corte <ArrowRight size={14} /></Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-3 mb-24" data-testid="mi-turno">
      {t.canSeeCash && activo('cash') && (
        <Card title={<span className="row gap-8"><Wallet size={18} />Tu caja</span>}>
          {mias.length > 0 ? (
            <div className="stack-sm">
              {mias.map((s) => <p key={s.id}><Badge tone="ok" dot>Abierta</Badge> <span className="small">{s.registerName} · desde {hora(s.openedAt)}</span></p>)}
              {avisoAjenas}
              <Link href="/caja" className="small strong row gap-4">Ir a Caja <ArrowRight size={14} /></Link>
            </div>
          ) : sinTurno.length > 0 && can('cash:session:open') ? (
            <div className="stack-sm">
              <p className="small muted">No tienes turno abierto. Ábrelo para poder cobrar en efectivo.</p>
              {/* Un solo principal (regla de acabado): la primera caja libre; las demás, secundarias. */}
              {sinTurno.map((r, i) => <Button key={r.id} size="sm" variant={i === 0 ? 'primary' : 'secondary'} icon={<Wallet />} onClick={() => setAbriendo({ id: r.id, name: r.name })}>Abrir turno · {r.name}</Button>)}
              {avisoAjenas}
            </div>
          ) : (
            <div className="stack-sm">
              <p className="small muted">No tienes turno abierto y no queda caja libre.</p>
              {avisoAjenas}
              <Link href="/caja" className="small strong row gap-4">Ver Caja <ArrowRight size={14} /></Link>
            </div>
          )}
        </Card>
      )}
      {t.canSeeEntries !== false && (
        <Card title={<span className="row gap-8"><DoorOpen size={18} />Entradas de hoy</span>}>
          <div className="stat-value num">{entradas.toLocaleString('es-MX')}</div>
          <p className="small muted">{sedes}{t.branches.length === 1 && t.branches[0]!.lastEntryAt ? ` · la última a las ${hora(t.branches[0]!.lastEntryAt)}` : ''}</p>
        </Card>
      )}
      {activo('classes') && can('classes:read') ? (
        <Card title={<span className="row gap-8"><CalendarDays size={18} />Siguiente clase</span>}>
          {siguiente ? (
            <div className="stack-sm">
              <p className="strong">{siguiente.name} · {hora(siguiente.startsAt)}</p>
              <p className="small muted">{siguiente.booked} de {siguiente.capacity} lugares reservados{t.classesToday.length > 1 ? ` · ${t.classesToday.length - 1} más hoy` : ''}</p>
              <Link href="/clases" className="small strong row gap-4">Pasar lista <ArrowRight size={14} /></Link>
            </div>
          ) : <p className="small muted">No quedan clases hoy.</p>}
        </Card>
      ) : t.pendingIntakes !== null && activo('intake') ? (
        <Card title={<span className="row gap-8"><Inbox size={18} />Altas por revisar</span>}>
          <div className="stat-value num">{t.pendingIntakes}</div>
          <Link href="/altas" className="small strong row gap-4">Revisar <ArrowRight size={14} /></Link>
        </Card>
      ) : null}
    {abriendo && <AbrirDialog caja={abriendo} onClose={() => setAbriendo(null)} onListo={() => { setAbriendo(null); cargar(); }} />}
    </div>
  );
}
