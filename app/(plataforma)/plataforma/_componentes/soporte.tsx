'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { hace } from '@gymflow/ui/format';
import { rolDe } from '@/lib/labels';
import { Badge, Card, ErrorCarga, Skeleton } from '@/components/ui';

type Soporte = {
  version: { app: string; gitSha: string | null; node: string };
  lastDailyRun: { at: string; jobs: number; failed: string[]; chain: string } | null;
  activeSessions: Array<{ userId: string; fullName: string | null; roleKeys: string[]; lastSeenAt: string }>;
  staffLastLogin: Array<{ userId: string; fullName: string; roleKeys: string[]; lastLoginAt: string | null }>;
};
type Acto = { id: string; at: string; action: string; phrase: string; reason: string | null; afterState: Record<string, unknown> | null };

/**
 * SOPORTE SIN ABRIR LA BASE (DP-04): quién tiene el panel abierto, si el cierre
 * diario corrió y la bitácora está íntegra, qué versión corre, y lo que la
 * propia plataforma hizo sobre la marca. Solo actos de GymFlow: ni socios ni
 * dinero del gimnasio (ADR-037).
 */
export function Soporte({ id, version }: { id: string; version: string }) {
  const [s, setS] = useState<Soporte | null | 'error'>(null);
  const [actos, setActos] = useState<Acto[] | null | 'error'>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    api<Soporte>(`/platform/organizations/${id}/support`).then(setS).catch(() => setS('error'));
    // Un fallo NO es "todavía nada" (UX 2026-10-08): se dice y se reintenta.
    api<{ entries: Acto[] }>(`/platform/organizations/${id}/audit?limit=15`).then((r) => setActos(r.entries)).catch(() => setActos('error'));
  }, [id, intento, version]);
  // Una persona, una fila: cada pestaña abierta es una sesión y repetía a la misma gente.
  const personas = s && s !== 'error' ? [...new Map(s.activeSessions.map((x) => [x.userId, x])).values()] : [];
  return (
    <div className="grid grid-2 plat-arriba" id="soporte">
      <Card title="Soporte" sub="Lo primero que se revisa cuando llaman: quién está dentro, si el cierre diario corrió y qué versión corre." data-testid="soporte">
        {s === null ? <Skeleton h={120} /> : s === 'error' ? <ErrorCarga mensaje="No se pudo consultar el soporte de esta marca." onReintentar={() => { setS(null); setIntento((x) => x + 1); }} /> : (
          <div className="stack-sm small">
            <div className="row-between"><span className="muted">Cierre diario</span>
              <span>{s.lastDailyRun ? <>{hace(s.lastDailyRun.at)} · {s.lastDailyRun.jobs} tareas{s.lastDailyRun.failed.length ? <span className="danger"> · fallaron {s.lastDailyRun.failed.join(', ')}</span> : ''}</> : <span className="muted">Nunca ha corrido</span>}</span></div>
            <div className="row-between"><span className="muted">Bitácora</span>
              <span>{s.lastDailyRun ? (s.lastDailyRun.chain === 'ok' ? <Badge tone="ok" dot>Íntegra</Badge> : s.lastDailyRun.chain === 'broken' ? <Badge tone="danger" dot>Cadena rota</Badge> : <Badge>Sin verificar</Badge>) : <Badge>Sin verificar</Badge>}</span></div>
            <div className="row-between"><span className="muted">Versión</span><span className="mono">{s.version.app}{s.version.gitSha ? ` · ${s.version.gitSha.slice(0, 7)}` : ''}</span></div>
            <div>
              <p className="muted mb-8">{personas.length === 0 ? 'Nadie tiene el panel abierto ahora.' : `Con el panel abierto ahora (${personas.length} ${personas.length === 1 ? 'persona' : 'personas'})`}</p>
              {personas.length > 0 && (
                <ul className="list lista-acotada">
                  {personas.map((x) => <li key={`${x.userId}-${x.lastSeenAt}`} className="list-item"><span className="flex-1">{x.fullName ?? 'Cuenta'} <span className="tiny muted">{rolDe(x.roleKeys)}</span></span><span className="tiny muted">{hace(x.lastSeenAt)}</span></li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
      <Card title="Lo que GymFlow hizo aquí" sub="Liberar, suspender, contratar, dar cuentas, facturar. Nada de la operación del gimnasio." pad={false} data-testid="actos-plataforma">
        {actos === null ? <div className="card-body"><Skeleton h={120} /></div> : actos === 'error' ? <div className="card-body"><ErrorCarga mensaje="No se pudo cargar lo que GymFlow hizo aquí." onReintentar={() => { setActos(null); setIntento((x) => x + 1); }} /></div> : actos.length === 0 ? <p className="card-body small muted">Todavía nada.</p> : (
          <ul className="list lista-acotada">
            {actos.map((a) => (
              <li key={a.id} className="list-item items-start">
                <div className="flex-1 min-w-0">
                  <p className="small">{a.phrase}</p>
                  {a.reason && <p className="tiny muted">Motivo: {a.reason}</p>}
                </div>
                <span className="tiny muted nowrap">{hace(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
